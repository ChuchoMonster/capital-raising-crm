#!/usr/bin/env node
/**
 * Where a firm's answer on a raise is written down.
 *
 *   node scripts/migrate-deal-verdicts.mjs            # show what would change
 *   node scripts/migrate-deal-verdicts.mjs --apply
 *
 * WHY THE FIRM AND NOT THE PERSON. An investor declines as a house: the analyst
 * who says "not for us" is speaking for the firm, and the mistake this exists
 * to prevent is emailing their colleague the next morning (client, 2026-08-31).
 * So the key is the deal and the ACCOUNT, and every contact there inherits it.
 *
 * WHY IT IS SCOPED TO ONE DEAL. A pass is about this raise, not about the firm.
 * Somebody who declines a lithium deal should still see the next copper one,
 * and a verdict that outlived its deal would quietly shrink the investor list
 * every time a raise ran.
 *
 * IT FLAGS, IT DOES NOT BLOCK. Nothing here removes anyone from anything — the
 * outreach list and the email composer show it and stay out of the way, because
 * a wrong verdict must be survivable. `deal_target_removals` next door is the
 * one that actually removes, and it stays a deliberate, separate act.
 *
 * `evidence` is not decoration. A verdict read out of an email carries the
 * sentence it was read from; one typed after a phone call carries the note and
 * the name of whoever took the call. Nobody should have to wonder later whether
 * a person or a machine decided it.
 *
 * `read_at` on mail_events is the marker that a message has been looked at, so
 * the reader never pays to read the same reply twice. The message BODY is
 * deliberately never stored — only the sentence that carried a verdict.
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

const DDL = `
  create table if not exists deal_verdicts (
    deal_id     uuid not null references deals(id) on delete cascade,
    -- The FIRM. Not a foreign key: accounts is research-owned and reloaded, and
    -- a reload must never be able to delete somebody's typed decision.
    account_id  text not null,
    -- 'Accepted' or 'Passed'. "Open" is the absence of a row, not a value —
    -- storing it would mean writing a row for every firm that has said nothing.
    verdict     text not null check (verdict in ('Accepted', 'Passed')),
    decided_at  timestamptz not null default now(),
    -- 'email' (read from their reply) or 'manual' (typed after a call).
    source      text not null,
    -- Their sentence, or the note whoever took the call typed.
    evidence    text,
    -- Who said it, and which message it was in. Both null for a phone call.
    contact_id  text,
    message_id  text,
    recorded_by text not null,
    primary key (deal_id, account_id)
  );
  create index if not exists deal_verdicts_account_idx on deal_verdicts (account_id);
`;

const have = (await db.query(
  `select to_regclass('public.deal_verdicts') t`)).rows[0].t;
const cols = new Set((await db.query(
  `select column_name from information_schema.columns
   where table_schema='public' and table_name='mail_events'`)).rows.map((r) => r.column_name));

console.log(`deal_verdicts ${have ? "already exists" : "to create"}`);
console.log(`mail_events.read_at ${cols.has("read_at") ? "already exists" : "to add"}`);

if (!APPLY) { console.log("\n--apply to make these changes."); await db.end(); process.exit(0); }
await db.query(DDL);
await db.query(`alter table mail_events add column if not exists read_at timestamptz`);
console.log("\nApplied.");
await db.end();
