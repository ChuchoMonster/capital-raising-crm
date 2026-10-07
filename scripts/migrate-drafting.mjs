#!/usr/bin/env node
/**
 * The tables behind "Draft an email" on a deal.
 *
 *   node scripts/migrate-drafting.mjs            # show what would change
 *   node scripts/migrate-drafting.mjs --apply
 *
 * Three things, and one of them reverses an earlier decision.
 *
 * `deal_documents` KEEPS the deck. Until now the upload was deleted the moment
 * its text had been read, on the reasoning that holding every confidential deck
 * indefinitely was a liability for no benefit. That reasoning was sound and is
 * now outweighed: the whole point of drafting from the CRM is that the deck
 * goes out attached, and you cannot attach a file you have thrown away.
 *
 * `email_templates` holds Halden Ridge's own wording. A template is a subject and a
 * body with {tokens} in it; nothing is generated, because these are two lines
 * that a partner has approved and will send under their own name.
 *
 * `deal_drafts` is the point of the whole feature. It records that this email,
 * for this person, on this deal, went into that mailbox — and the Microsoft
 * conversation id it was given. That id is what lets the mailbox sync recognise
 * the message when it is finally sent and file it against the right raise with
 * no inference at all, which is the one thing reading mailboxes alone can never
 * do for somebody sitting on several live deals.
 *
 * Nothing here drops or rewrites an existing column.
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
  ["deal_documents", `
    create table if not exists deal_documents (
      id           uuid primary key default gen_random_uuid(),
      deal_id      uuid not null references deals(id) on delete cascade,
      name         text not null,
      storage_path text not null,
      content_type text,
      bytes        bigint not null,
      uploaded_at  timestamptz not null default now()
    );
    create index if not exists deal_documents_deal_idx on deal_documents (deal_id)`],

  ["email_templates", `
    create table if not exists email_templates (
      id         uuid primary key default gen_random_uuid(),
      name       text not null,
      subject    text not null,
      body       text not null,
      -- Ordering is explicit so Halden Ridge can put their usual one first.
      sort       int  not null default 100,
      archived   bool not null default false,
      created_at timestamptz not null default now()
    );
    create unique index if not exists email_templates_name_idx on email_templates (name)`],

  ["deal_drafts", `
    create table if not exists deal_drafts (
      id              uuid primary key default gen_random_uuid(),
      deal_id         uuid not null references deals(id) on delete cascade,
      contact_id      text not null,
      mailbox         text not null,
      -- Microsoft's ids. conversation_id is the one that matters: it survives
      -- the draft being edited and sent, which is how the sync recognises it.
      graph_id        text,
      conversation_id text,
      subject         text,
      template        text,
      created_by      text,
      created_at      timestamptz not null default now(),
      -- Set by the mailbox sync when the draft is actually sent.
      sent_at         timestamptz
    );
    create index if not exists deal_drafts_deal_idx on deal_drafts (deal_id, contact_id);
    create index if not exists deal_drafts_conv_idx
      on deal_drafts (conversation_id) where conversation_id is not null`],
];

/* Placeholder wording. Halden Ridge are writing the real templates; these exist so the
   page can be used and so nobody has to invent a sentence for an investor. */
/* Subjects are DELIBERATELY just the company name. The first version used
   "{Deal} — {Sector}", which read fine until it met a real deal: Morvane's
   sector is "Mining — Polymetallic Base Metals (zinc, lead, copper, silver,
   gold, cobalt)", so the subject line ran far too long and most mail
   clients cut it off mid-list. A field that is right on a deal page is not
   automatically right in a subject line. {Sector} is still available to drop
   in, for a deal whose sector is two words. */
const SEED = [
  ["Deck introduction", "{Deal}",
   "{Greeting},\n\nWe are working with {Deal} on their current raise and thought it might be of interest. The deck is attached.\n\nHappy to set up a call if useful.\n\n{Sender}"],
  ["Short follow-up", "Following up — {Deal}",
   "{Greeting},\n\nJust following up on {Deal}. The deck is attached again for convenience.\n\nLet me know if you would like to discuss.\n\n{Sender}"],
];

const have = new Set((await db.query(
  `select table_name from information_schema.tables where table_schema='public'`)).rows.map((r) => r.table_name));

const todo = STEPS.filter(([n]) => !have.has(n));
console.log(todo.length ? `${todo.length} table(s) to create:` : "All three tables already exist.");
for (const [n] of todo) console.log(`   + ${n}`);

const templates = have.has("email_templates")
  ? Number((await db.query(`select count(*) n from email_templates`)).rows[0].n) : 0;
console.log(`email_templates holds ${templates} template(s)${templates ? "" : ` — ${SEED.length} placeholders to seed`}`);

if (!APPLY) { console.log("\nDry run. Re-run with --apply to make the changes."); await db.end(); process.exit(0); }

for (const [n, sql] of todo) { await db.query(sql); console.log(`created ${n}`); }
if (!templates) {
  for (const [name, subject, body, i] of SEED.map((s, i) => [...s, i])) {
    await db.query(
      `insert into email_templates (name, subject, body, sort) values ($1,$2,$3,$4)
       on conflict (name) do nothing`, [name, subject, body, i]);
  }
  console.log(`seeded ${SEED.length} placeholder templates`);
}
console.log("done");
await db.end();
