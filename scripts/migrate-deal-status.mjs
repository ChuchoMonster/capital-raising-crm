#!/usr/bin/env node
/**
 * Cut the deal statuses down to the two that mean something.
 *
 *   node scripts/migrate-deal-status.mjs            # show what would change
 *   node scripts/migrate-deal-status.mjs --apply
 *
 * `deals.status` has carried four values — Live, Closing, Closed, On hold — and
 * NOTHING HAS EVER SET ANY BUT THE FIRST. Every deal is created Live by
 * create.ts and stays there; there was no button, script or upload path that
 * assigned another. So three of the four were decoration.
 *
 * A deal is now either Live or Complete. Complete is the one being added — a
 * finished raise previously had nowhere to go except deletion, which took its
 * contact list and the record of who was emailed with it.
 *
 * The mapping, for any row that somehow has one of the old values:
 *   Closed    -> Complete   the raise is over
 *   Closing   -> Live       nearly done is still being worked
 *   On hold   -> Live       paused is not finished
 * Expect zero of each. It is written anyway because "nothing sets it" is a
 * claim about the code, and this is a claim about the data.
 *
 * `deals` is people-owned — the nightly backup copies it out and a research
 * load never touches it. Nothing here drops a column.
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

const MAP = [["Closed", "Complete"], ["Closing", "Live"], ["On hold", "Live"]];

const counts = (await db.query(
  `select status, count(*)::int n from deals group by status order by n desc`)).rows;
console.log("deals by status:");
for (const r of counts) console.log(`   ${String(r.status).padEnd(10)} ${r.n}`);

const todo = MAP.filter(([from]) => counts.some((r) => r.status === from));
if (!todo.length) console.log("\nNothing to move — every deal is already Live or Complete.");
for (const [from, to] of todo) console.log(`\n   ${from} -> ${to}`);

const def = (await db.query(
  `select column_default from information_schema.columns
   where table_schema='public' and table_name='deals' and column_name='status'`)).rows[0]?.column_default;
const fixDefault = !def || !String(def).includes("Live");
if (fixDefault) console.log(`\n   status default is ${def} — a new deal must start Live`);

if (!APPLY) { console.log("\n--apply to make these changes."); await db.end(); process.exit(0); }

for (const [from, to] of todo) {
  const r = await db.query(`update deals set status = $2 where status = $1`, [from, to]);
  console.log(`   moved ${r.rowCount} from ${from} to ${to}`);
}
if (fixDefault) {
  await db.query(`alter table deals alter column status set default 'Live'`);
  console.log("   status default -> 'Live'");
}
/* The deals list still orders by date — completing a raise greys it where it
   sits rather than moving it, because a deal people have open should not jump
   down the page. The index is for the reply-check, which now reads live deals
   only. */
await db.query(`create index if not exists deals_status_idx on deals (status)`);
console.log("\nApplied.");
await db.end();
