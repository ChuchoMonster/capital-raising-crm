#!/usr/bin/env node
/**
 * Firms taken off a deal's matched list by hand.
 *
 *   node scripts/migrate-target-removals.mjs            # show what would change
 *   node scripts/migrate-target-removals.mjs --apply
 *
 * The matched list is WORKED OUT, not stored — recomputed from the deal against
 * the current investor records every time it is opened, so it improves as the
 * research does. That is right, and it is also why a judgement made while
 * reading it had nowhere to live: "this one is not for us" was true, and then
 * gone on the next page load.
 *
 * So the judgement is stored, not the list. One row per firm a person has
 * ruled out on one deal. The tiering still runs over everything and this is
 * subtracted at the end, which means a firm ruled out of one raise is
 * untouched on every other — the reason is nearly always about THIS deal.
 *
 * Nothing is deleted when a firm is restored: the row goes, the account never
 * moves. Removing a firm from a matched list says something about a deal, not
 * about the firm, and it must never leak back into the research data.
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
  create table if not exists deal_target_removals (
    deal_id     uuid not null references deals(id) on delete cascade,
    account_id  text not null references accounts(hr_id),
    removed_by  text,
    removed_at  timestamptz not null default now(),
    primary key (deal_id, account_id)
  )`;

const exists = (await db.query(
  `select 1 from information_schema.tables
   where table_schema='public' and table_name='deal_target_removals'`)).rowCount > 0;
console.log(exists ? "deal_target_removals already exists" : "deal_target_removals will be created");

if (!APPLY) { console.log("\n--apply to make these changes."); await db.end(); process.exit(0); }

await db.query(DDL);
const cols = (await db.query(
  `select column_name from information_schema.columns
   where table_schema='public' and table_name='deal_target_removals' order by ordinal_position`)).rows.map((r) => r.column_name);
const want = ["deal_id", "account_id", "removed_by", "removed_at"];
const missing = want.filter((c) => !cols.includes(c));
if (missing.length) { console.error(`FAILED — missing: ${missing.join(", ")}`); await db.end(); process.exit(1); }
console.log(`   ready — ${cols.join(", ")}`);
await db.end();
