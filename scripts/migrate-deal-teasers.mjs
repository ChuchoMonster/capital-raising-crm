#!/usr/bin/env node
/**
 * Give `deals` somewhere to keep its two-page teaser.
 *
 *   node scripts/migrate-deal-teasers.mjs            # show what would change
 *   node scripts/migrate-deal-teasers.mjs --apply
 *
 * The teaser is the document Halden Ridge attaches to a first email — two pages, drafted
 * from the same document text the write-up was checked against. It is STORED
 * rather than drafted on demand because the file on the deal page and the file
 * on the email have to be the same file, and because an Opus call in a page
 * request is seconds of blank screen.
 *
 * The PDF is deliberately NOT stored. It renders from `teaser` in milliseconds,
 * and a cached copy is one more thing that can disagree with the record it came
 * from.
 *
 * `teaser_image` holds a picture pulled out of the company's own deck, kept as
 * its own small file so a render never has to read a 7MB PDF back. Empty means
 * the Halden Ridge photograph is used, which is a fallback and not a fault.
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

const COLUMNS = [
  ["teaser",         "jsonb",       "the drafted two-pager, section by section"],
  ["teaser_at",      "timestamptz", "when it was drafted"],
  ["teaser_model",   "text",        "which model drafted it"],
  ["teaser_image",   "text",        "storage path of the hero picture taken from the deck"],
  ["teaser_image_2", "text",        "storage path of the second picture, for page two"],
];

const have = new Set((await db.query(
  `select column_name from information_schema.columns
   where table_schema='public' and table_name='deals'`)).rows.map((r) => r.column_name));

const todo = COLUMNS.filter(([n]) => !have.has(n));
console.log(`deals has ${have.size} columns; ${todo.length} to add`);
for (const [n, t, why] of todo) console.log(`   + ${n.padEnd(14)} ${t.padEnd(12)} ${why}`);

if (!APPLY) { console.log("\n--apply to make these changes."); await db.end(); process.exit(0); }
for (const [n, t] of todo) {
  await db.query(`alter table deals add column if not exists ${n} ${t}`);
  console.log(`   added ${n}`);
}
console.log("\nApplied.");
await db.end();
