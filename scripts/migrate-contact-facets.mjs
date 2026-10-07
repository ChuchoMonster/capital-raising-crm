#!/usr/bin/env node
/**
 * Filter counts for the CONTACTS list, counted in contacts.
 *
 *   node scripts/migrate-contact-facets.mjs            # show what would change
 *   node scripts/migrate-contact-facets.mjs --apply
 *
 * The contacts page was showing account numbers. Its filters come from
 * `facet_counts`, which is built from `account_facets` and counts COMPANIES —
 * so "Australia 431" meant 431 Australian firms, and ticking it returned the
 * 1,205 people who work at them. Two different questions under one number, and
 * the smaller one was on the button.
 *
 * A contact inherits its filters from its account, which is right: the person
 * at a Perth copper fund is an Australian copper contact. What was wrong was
 * only ever the counting.
 *
 * Scope matters here. These count the people the CRM actually offers — the
 * four working segments, minus anyone whose best address bounces — so the
 * number on a filter and the number of rows it returns are the same number.
 * Get that wrong and the bug comes back wearing a different mask.
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

const KEYS = ["country", "type", "sector", "commodity", "aum", "via", "invests_in", "stage", "project"];
const IN_SCOPE = `c.segment in ('Investors','Family Offices','High Net Worth','Intermediaries','Business','Government/Strategic')
    and c.best_email_status is distinct from 'invalid'`;

/* One row per (contact, filter, value). Grouped on the CONTACT's segment, not
   the account's — the page filters by the contact's, and a handful disagree. */
const UNPIVOT = KEYS.map((k) => `
    select c.hr_id, c.segment, '${k}'::text as key, af.f_${k} as vals
    from contacts c join account_facets af on af.hr_id = c.account_id
    where ${IN_SCOPE}`).join("\n    union all");

const SQL = [
  ["contact_facet_counts", `
    drop materialized view if exists contact_facet_counts cascade;
    create materialized view contact_facet_counts as
    with unpivoted as (${UNPIVOT})
    select segment, key, value, count(distinct hr_id)::int as n
    from unpivoted, unnest(vals) as value
    where value is not null and value <> ''
    group by 1, 2, 3;
    create index contact_facet_counts_idx on contact_facet_counts (segment, key)`],

  ["contact_facet_coverage", `
    drop materialized view if exists contact_facet_coverage cascade;
    create materialized view contact_facet_coverage as
    with unpivoted as (${UNPIVOT}),
    totals as (
      select c.segment, count(*)::int as segment_total
      from contacts c where ${IN_SCOPE} group by 1)
    select t.segment, u.key,
           count(distinct u.hr_id) filter (where coalesce(array_length(u.vals, 1), 0) > 0)::int as have,
           t.segment_total
    from totals t join unpivoted u on u.segment = t.segment
    group by t.segment, u.key, t.segment_total;
    create index contact_facet_coverage_idx on contact_facet_coverage (segment)`],
];

if (!APPLY) {
  console.log("Would create:");
  for (const [n] of SQL) console.log(`   ${n}`);
  console.log("\nDry run. Re-run with --apply.");
  await db.end();
  process.exit(0);
}

for (const [name, sql] of SQL) { await db.query(sql); console.log(`built ${name}`); }

/* The check that matters: the number on a filter must equal the number of rows
   it returns. That is the whole bug. */
const sample = await db.query(
  `select value, n from contact_facet_counts where segment='Investors' and key='country'
   order by n desc limit 5`);
console.log("\nInvestor contacts by country, as the filter will now show:");
for (const r of sample.rows) {
  const real = await db.query(
    `select count(*)::int n from contacts c join account_facets af on af.hr_id = c.account_id
     where c.segment = 'Investors' and ${IN_SCOPE} and af.f_country && array[$1]::text[]`, [r.value]);
  const ok = real.rows[0].n === r.n;
  console.log(`   ${ok ? "ok " : "MISMATCH"} ${String(r.value).padEnd(18)} filter says ${String(r.n).padStart(5)}, search returns ${String(real.rows[0].n).padStart(5)}`);
}
await db.end();
