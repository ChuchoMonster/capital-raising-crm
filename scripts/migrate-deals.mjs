#!/usr/bin/env node
/**
 * Give `deals` the columns its own page already renders.
 *
 *   node scripts/migrate-deals.mjs            # show what would change
 *   node scripts/migrate-deals.mjs --apply
 *
 * The deal page was built against a richer shape than the table holds — it
 * reads sector, countries, raising, valuation, stage, website and highlights,
 * none of which existed. Every one is added here rather than crammed into
 * `summary`, because a raise amount you cannot filter on is not a raise amount.
 *
 * `document_text` is deliberately kept alongside the drafted fields. A write-up
 * drafted from a document that nobody can re-read afterwards cannot be checked,
 * and this project's whole discipline is that a wrong value and a right value
 * look identical once they are on a screen.
 *
 * Nothing here drops or rewrites a column. `deals` is a people-owned table —
 * the nightly backup copies it out and a research load never touches it.
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

const COLUMNS = [
  ["sector",        "text",   "what the company does — drafted from the document"],
  ["countries",     "text",   "where the project or company is, ISO codes"],
  ["raising",       "text",   "the amount sought, as written (e.g. 'US$40m')"],
  ["valuation",     "text",   "pre- or post-money, only where the document states it"],
  ["stage",         "text",   "exploration / development / producing / growth"],
  ["website",       "text",   "the company's own address"],
  ["closing",       "text",   "the timing line, e.g. 'first close targeted Q4'"],
  ["highlights",    "text[]", "the three-to-six bullets that go in every email"],
  ["document_name", "text",   "the original file name, so a person can recognise it"],
  ["document_text", "text",   "the extracted text the write-up was drafted from"],
  // NOT `drafted_at`: deal_contacts already has one, meaning "an email draft was
  // made for this person". Two different facts under one name blows up the moment
  // a query joins the two tables, which dealTally does.
  ["written_at",    "timestamptz", "when the write-up was drafted"],
  ["draft_model",   "text",   "which model drafted it"],
  ["draft_gaps",    "text[]", "fields the document did not state — never guessed"],
];

const have = new Set((await db.query(
  `select column_name from information_schema.columns
   where table_schema='public' and table_name='deals'`)).rows.map((r) => r.column_name));

const todo = COLUMNS.filter(([n]) => !have.has(n));
console.log(`deals has ${have.size} columns; ${todo.length} to add`);
for (const [n, t, why] of todo) console.log(`   + ${n.padEnd(14)} ${t.padEnd(12)} ${why}`);

// The UI's four statuses; the table shipped with a default of 'open', which is
// not one of them and would render as an unknown chip on the first deal made.
const def = (await db.query(
  `select column_default from information_schema.columns
   where table_schema='public' and table_name='deals' and column_name='status'`)).rows[0]?.column_default;
const fixDefault = def && !String(def).includes("Live");
if (fixDefault) console.log(`\n   status default is ${def} — the UI knows Live / Closing / Closed / On hold`);

if (!APPLY) { console.log("\n--apply to make these changes."); await db.end(); process.exit(0); }

for (const [n, t] of todo) {
  await db.query(`alter table deals add column if not exists ${n} ${t}`);
  console.log(`   added ${n}`);
}
if (fixDefault) {
  await db.query(`alter table deals alter column status set default 'Live'`);
  await db.query(`update deals set status = 'Live' where status = 'open'`);
  console.log("   status default -> 'Live'");
}
await db.query(`create index if not exists deals_created_idx on deals (created_at desc)`);
console.log("\nApplied.");
await db.end();
