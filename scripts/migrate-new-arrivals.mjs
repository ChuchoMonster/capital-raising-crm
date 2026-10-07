#!/usr/bin/env node
/**
 * A place to keep the people the mailbox sync currently throws away.
 *
 *   node scripts/migrate-new-arrivals.mjs            # show what would change
 *   node scripts/migrate-new-arrivals.mjs --apply
 *
 * Every five minutes the sync reads four mailboxes, and every address it does
 * not recognise it counts and discards. Those are the people Halden Ridge has started
 * talking to since the last research run — the ones the weekly enrichment
 * exists to pick up. Nothing was recording them, so a Saturday job would have
 * found an empty queue.
 *
 * WHY A TABLE AND NOT A CONTACT ROW. A contact on the list has been through
 * classification and belongs to a segment; one of these has been through
 * nothing. Writing them straight into `contacts` would put unjudged people on
 * an investor list, which is the one thing this project protects against.
 * They sit here until the weekly run decides what they are.
 *
 * Keyed on the address, not the message: the same person writing twenty times
 * is one arrival with a count, not twenty rows.
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

const exists = (await db.query(
  `select 1 from information_schema.tables where table_schema='public' and table_name='new_arrivals'`)).rowCount;

console.log(exists ? "new_arrivals already exists — checking columns" : "new_arrivals does not exist");

const SQL = `
create table if not exists new_arrivals (
  email            text primary key,
  display_name     text,
  domain           text,
  -- Which partners have seen them. An array because two partners emailing the
  -- same person is one relationship known to both, and overwriting would hand
  -- it to whichever mailbox was read last.
  mailboxes        text[] not null default '{}',
  inbound          integer not null default 0,
  outbound         integer not null default 0,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  -- Set when the weekly run has taken them; they are kept afterwards rather
  -- than deleted, so a run can be audited and re-run without losing the queue.
  processed_at     timestamptz,
  processed_run    text
);
create index if not exists new_arrivals_pending on new_arrivals (last_seen)
  where processed_at is null;
create index if not exists new_arrivals_domain on new_arrivals (domain);
`;

if (!APPLY) {
  console.log("\nwould run:\n" + SQL);
  console.log("--apply to create it.");
  await db.end();
  process.exit(0);
}

await db.query(SQL);
const cols = (await db.query(
  `select column_name, data_type from information_schema.columns
   where table_schema='public' and table_name='new_arrivals' order by ordinal_position`)).rows;
console.log("\nnew_arrivals:");
for (const c of cols) console.log(`   ${c.column_name.padEnd(16)} ${c.data_type}`);
const n = (await db.query(`select count(*)::int n from new_arrivals`)).rows[0].n;
console.log(`\n${n} rows. The sync will start filling it on its next run.`);
await db.end();
