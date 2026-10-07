#!/usr/bin/env node
/**
 * Templates are a first touch or a follow-up.
 *
 *   node scripts/migrate-template-kinds.mjs            # show what would change
 *   node scripts/migrate-template-kinds.mjs --apply
 *
 * The two are not interchangeable and the difference is not cosmetic. A first
 * touch is a new email to somebody who has not heard from us on this raise. A
 * follow-up is a REPLY, in the thread that already exists, and it can only go
 * to somebody already emailed — there is nothing to reply to otherwise.
 *
 * So the kind decides three things at once: which templates are offered, who
 * can be picked, and whether Microsoft is asked for a new message or a reply.
 * Holding it on the template is what lets a partner choose by picking the
 * wording they want, rather than setting a mode and then hunting for it.
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

const rows = (await db.query(`select id, name, sort from email_templates order by sort`)).rows;
/* The two that exist are one of each, which is what prompted this. Anything
   added later is a first touch unless it says otherwise — the safe default,
   since a first touch can go to anybody and a follow-up cannot. */
const followish = (name) => /follow|reminder|chase|bump|nudge/i.test(name);

console.log("Templates:");
for (const r of rows) console.log(`   ${r.name.padEnd(24)} -> ${followish(r.name) ? "follow-up" : "first touch"}`);

if (!APPLY) { console.log("\n--apply to make these changes."); await db.end(); process.exit(0); }

await db.query(`alter table email_templates add column if not exists kind text not null default 'first'`);
await db.query(`alter table email_templates drop constraint if exists email_templates_kind_check`);
await db.query(`alter table email_templates add constraint email_templates_kind_check
                check (kind in ('first','follow'))`);
for (const r of rows)
  await db.query(`update email_templates set kind = $2 where id = $1`, [r.id, followish(r.name) ? "follow" : "first"]);

const after = (await db.query(`select kind, count(*)::int n from email_templates group by 1 order by 1`)).rows;
console.log("\nAfter:");
for (const r of after) console.log(`   ${r.kind.padEnd(8)} ${r.n}`);
if (!after.find((r) => r.kind === "follow")) { console.error("FAILED — no follow-up template exists."); await db.end(); process.exit(1); }
if (!after.find((r) => r.kind === "first")) { console.error("FAILED — no first-touch template exists."); await db.end(); process.exit(1); }
await db.end();
