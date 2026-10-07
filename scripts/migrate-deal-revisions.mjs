#!/usr/bin/env node
/**
 * Record what a re-upload changed on a deal.
 *
 *   node scripts/migrate-deal-revisions.mjs            # show what would change
 *   node scripts/migrate-deal-revisions.mjs --apply
 *
 * WHY THIS TABLE EXISTS. Adding documents to a live deal can move a figure that
 * has already gone out in an email — a term sheet arriving after the deck
 * routinely changes the raise amount. A silent overwrite would leave nobody
 * able to answer "it said $40m last week, what happened", and this project's
 * whole discipline is that a changed value and an original value look identical
 * once they are on a screen.
 *
 * So every re-upload writes one row: which files arrived, which fields moved,
 * what they moved from and to, and who did it. Nothing here is derived from
 * anything else, so it cannot drift from what the deal now says.
 *
 * `deals` and everything hanging off it are people-owned — a research load
 * never touches them, and the nightly backup copies them out.
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
  create table if not exists deal_revisions (
    id          uuid primary key default gen_random_uuid(),
    deal_id     uuid not null references deals(id) on delete cascade,
    -- The files that arrived in this re-upload, by name.
    documents   text[] not null default '{}',
    -- One entry per field that moved: {field, from, to}. Empty when the new
    -- documents added detail without contradicting anything already recorded.
    changes     jsonb  not null default '[]',
    -- Fields the combined documents still do not state, after this upload.
    gaps        text[] not null default '{}',
    created_by  text,
    created_at  timestamptz not null default now()
  )`;

const IDX = `create index if not exists deal_revisions_deal_idx
             on deal_revisions (deal_id, created_at desc)`;

const exists = (await db.query(
  `select 1 from information_schema.tables
   where table_schema='public' and table_name='deal_revisions'`)).rowCount > 0;

console.log(exists ? "deal_revisions already exists" : "deal_revisions will be created");

if (!APPLY) { console.log("\n--apply to make these changes."); await db.end(); process.exit(0); }

await db.query(DDL);
await db.query(IDX);
console.log("   deal_revisions ready");

/* Rows in, rows out. A migration that reports success on work it did not do is
   the failure mode this project has been bitten by more than once. */
const cols = (await db.query(
  `select column_name from information_schema.columns
   where table_schema='public' and table_name='deal_revisions' order by ordinal_position`)).rows.map((r) => r.column_name);
const want = ["id", "deal_id", "documents", "changes", "gaps", "created_by", "created_at"];
const missing = want.filter((c) => !cols.includes(c));
if (missing.length) { console.error(`FAILED — missing columns: ${missing.join(", ")}`); await db.end(); process.exit(1); }
console.log(`   verified ${cols.length} columns: ${cols.join(", ")}`);

await db.end();
