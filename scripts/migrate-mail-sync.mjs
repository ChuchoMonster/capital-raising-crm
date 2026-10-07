#!/usr/bin/env node
/**
 * The tables the mailbox sync writes into.
 *
 *   node scripts/migrate-mail-sync.mjs            # show what would change
 *   node scripts/migrate-mail-sync.mjs --apply
 *
 * Four pieces, and the shape of them is the whole design:
 *
 * `mail_events` is a LEDGER, one row per (message, person, direction). It is
 * not a counter. A counter has to be incremented exactly once, which means the
 * sync may never re-read a message — and a sync that may never repeat itself
 * is one dropped run away from a permanent hole. Every window this job reads
 * deliberately OVERLAPS the last one, so re-reading has to be free. Inserting
 * the same row twice is free; adding one to a number twice is not.
 *
 * `contact_activity` is a VIEW over that ledger, never a stored copy. A stored
 * "last emailed" drifts from the messages it claims to summarise the first
 * time a write fails halfway; a view cannot.
 *
 * `deal_contacts` gains a conversation id and two source columns. The
 * conversation is what makes a REPLY attributable: a message on its own says
 * who wrote, not which deal they are answering, and guessing between two live
 * deals is how a reply gets filed against the wrong one. Recording the thread
 * when the send is seen means the answer arrives already addressed.
 *
 * `mail_sync_state` is the watermark, and `mail_sync_unmatched` is where
 * anything this job will not guess about goes to be looked at by a person.
 *
 * Nothing here drops or rewrites a column.
 */
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(
  (existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const url = process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL;
if (!url) { console.error("No SUPABASE_DB_URL"); process.exit(2); }
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

const STEPS = [
  ["mail_sync_state", `
    create table if not exists mail_sync_state (
      mailbox      text not null,
      folder       text not null,
      -- The timestamp of the newest message this folder has been read up to.
      -- Deliberately the message's own time, not the clock: if a run fails the
      -- watermark does not move, so the next run simply covers a wider window.
      last_seen    timestamptz,
      last_run_at  timestamptz,
      last_ok_at   timestamptz,
      last_error   text,
      primary key (mailbox, folder)
    )`],

  ["mail_events", `
    create table if not exists mail_events (
      message_id      text        not null,
      contact_id      text        not null,
      -- 'out' = a partner emailed them. 'in' = they wrote to a partner.
      direction       text        not null check (direction in ('out','in')),
      -- Which partner's mailbox. For outbound this is the SENDER, and it comes
      -- from the mailbox being read rather than the message: three of the four
      -- partners' sent mail carries an internal Exchange identity in its From
      -- field, not an address, so the message cannot be trusted to say.
      mailbox         text        not null,
      occurred_at     timestamptz not null,
      conversation_id text,
      subject         text,
      seen_at         timestamptz not null default now(),
      primary key (message_id, contact_id, direction)
    )`],
  ["mail_events indexes", `
    create index if not exists mail_events_contact_idx
      on mail_events (contact_id, occurred_at desc);
    create index if not exists mail_events_conv_idx
      on mail_events (conversation_id) where conversation_id is not null`],

  ["contact_activity view", `
    create or replace view contact_activity as
    select contact_id,
           max(occurred_at) filter (where direction = 'out') as last_emailed_at,
           max(occurred_at) filter (where direction = 'in')  as last_reply_at,
           count(*)         filter (where direction = 'out') as emails_sent,
           count(*)         filter (where direction = 'in')  as replies_received,
           (array_agg(mailbox order by occurred_at desc)
              filter (where direction = 'out'))[1]           as last_emailed_by
    from mail_events
    group by contact_id`],

  ["mail_sync_unmatched", `
    create table if not exists mail_sync_unmatched (
      message_id  text not null,
      direction   text not null,
      mailbox     text not null,
      address     text,
      contact_id  text,
      occurred_at timestamptz,
      subject     text,
      -- Why this job declined to decide. Never a failure to record: a message
      -- it will not attribute is written here rather than attached to a guess.
      reason      text not null,
      seen_at     timestamptz not null default now(),
      resolved_at timestamptz,
      -- Keyed on the QUESTION, not the message. One person awaiting contact on
      -- two deals is one thing to decide however many times they are emailed;
      -- keyed per message the first test produced forty-one identical rows for
      -- a single person, which is how a review queue stops being read.
      primary key (contact_id, direction, reason)
    )`],

  ["deal_contacts.conversation_id", `
    alter table deal_contacts add column if not exists conversation_id text`],
  ["deal_contacts.sent_source", `
    alter table deal_contacts add column if not exists sent_source text`],
  ["deal_contacts.replied_source", `
    alter table deal_contacts add column if not exists replied_source text`],
  ["deal_contacts conv index", `
    create index if not exists deal_contacts_conv_idx
      on deal_contacts (contact_id, conversation_id) where conversation_id is not null`],
];

console.log(`${STEPS.length} steps${APPLY ? "" : " (dry run)"}\n`);
for (const [name] of STEPS) console.log(`   ${APPLY ? "+" : "·"} ${name}`);

if (!APPLY) { console.log("\n--apply to make these changes."); await db.end(); process.exit(0); }

console.log();
for (const [name, sql] of STEPS) {
  await db.query(sql);
  console.log(`   done  ${name}`);
}

/* Every mailbox starts with no watermark, which the sync reads as "first run"
   and treats as a short backfill rather than the whole history. Seeding the
   rows here means the sync never has to decide whether a missing row is a new
   mailbox or a lost one. */
const MAILBOXES = (process.env.GRAPH_MAILBOXES || env.GRAPH_MAILBOXES ||
  "alan@halden-ridge.example,grace@halden-ridge.example,peter@halden-ridge.example,ruth@halden-ridge.example")
  .split(",").map((s) => s.trim()).filter(Boolean);
/* The two passes. "received" replaced an earlier "Inbox" pass: measured over a
   week of live mail, 49-83% of what each partner received had already been
   filed out of the Inbox, almost all into Deleted Items. Its watermark is
   dropped rather than carried over so the wider net backfills properly. */
await db.query(`delete from mail_sync_state where folder in ('Inbox','SentItems')`);
for (const m of MAILBOXES) {
  for (const f of ["sent", "received"]) {
    await db.query(
      `insert into mail_sync_state (mailbox, folder) values ($1,$2) on conflict do nothing`, [m, f]);
  }
}
console.log(`\n   seeded ${MAILBOXES.length} mailboxes x 2 passes (sent, received)`);
console.log("\nApplied.");
await db.end();
