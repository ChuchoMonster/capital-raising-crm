#!/usr/bin/env node
/**
 * Family offices and wealthy individuals become segments of their own.
 *
 *   node scripts/migrate-investor-segments.mjs            # show what would move
 *   node scripts/migrate-investor-segments.mjs --apply
 *
 * WHY THEY ARE NOT INVESTORS ANY MORE (client, 2026-08-28). Halden Ridge approaches them
 * as a different kind of counterparty and writes to them separately, and there
 * is not enough on file about them to tier them against a raise. A deal looking
 * for investors must not pick them up — and the only way to guarantee that is
 * for them not to be investors. `tierFirms` asks for the investor segment, so
 * this change alone takes them off Matched Accounts.
 *
 * ⚠️ THEIR ENRICHMENT DOES NOT MOVE. `account_investor` still holds their type,
 * fund size and what they back, and the record page still reads it — see
 * INVESTOR_SEGMENTS in app/lib/scope.ts. Nothing about a family office is lost;
 * only what it IS has changed.
 *
 * ⚠️ THE WEEKLY LOAD WOULD PUT THEM BACK. `segment` is loaded from the research
 * workbook, which still files them under Investors, so the same rule is applied
 * in the research pipeline's own loader (not part of this repo). Running this alone fixes today and lasts
 * until Saturday. Both are needed.
 *
 * A firm typed both Family Office and HNWI becomes a family office: the thing
 * being filed is a firm, and a family office is a firm.
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
const WORKING = `('Investors','Family Offices','High Net Worth','Intermediaries','Business','Government/Strategic')`;

/* Which accounts move, and where to. Family Office is tested first so a firm
   typed as both lands in one place. */
const TARGET = `
  case when i.investor_type @> array['Family Office'] then 'Family Offices'
       when i.investor_type @> array['HNWI']          then 'High Net Worth'
  end`;

const before = (await db.query(
  `select segment, count(*)::int n from accounts group by 1 order by 2 desc`)).rows;
const movingA = (await db.query(
  `select ${TARGET} as target, count(*)::int n
   from accounts a join account_investor i on i.hr_id = a.hr_id
   where a.segment = 'Investors' and ${TARGET} is not null group by 1 order by 2 desc`)).rows;
const movingC = (await db.query(
  `select ${TARGET} as target, count(*)::int n
   from contacts c join accounts a on a.hr_id = c.account_id
   join account_investor i on i.hr_id = a.hr_id
   where c.segment = 'Investors' and ${TARGET} is not null group by 1 order by 2 desc`)).rows;

console.log("Accounts moving off Investors:");
for (const r of movingA) console.log(`   ${String(r.target).padEnd(16)} ${String(r.n).padStart(6)}`);
console.log("Contacts moving off Investors:");
for (const r of movingC) console.log(`   ${String(r.target).padEnd(16)} ${String(r.n).padStart(6)}`);

if (!APPLY) { console.log("\n--apply to move them."); await db.end(); process.exit(0); }

/* An account's own row first, then the people at it. A contact follows its
   FIRM: a person is a family-office contact because the firm is a family
   office, never because of anything on the person. */
const a = await db.query(
  `update accounts a set segment = t.target
   from (select a2.hr_id, ${TARGET} as target
         from accounts a2 join account_investor i on i.hr_id = a2.hr_id
         where a2.segment = 'Investors' and ${TARGET} is not null) t
   where a.hr_id = t.hr_id`);
console.log(`\nmoved ${a.rowCount} accounts`);

const c = await db.query(
  `update contacts c set segment = a.segment
   from accounts a
   where a.hr_id = c.account_id
     and c.segment = 'Investors'
     and a.segment in ('Family Offices','High Net Worth')`);
console.log(`moved ${c.rowCount} contacts`);

/* account_facets goes back to being keyed on the segment: the tab a row is
   listed on IS its segment again, so the derived `view` column has nothing
   left to say. Replaced rather than dropped — dropping cascades through every
   filter-count view built on it. */
await db.query(`
  create or replace view account_facets as
  select a.hr_id,
         a.segment,
         a.country_names as f_country,
         case
           when a.segment in ('Investors','Family Offices','High Net Worth')
             then coalesce(i.investor_type, '{}'::text[])
           when a.segment = 'Intermediaries'
             then case when it.intermediary_type is null then '{}'::text[] else array[it.intermediary_type] end
           when a.segment = 'Government/Strategic'
             then case when g.entity_kind is null then '{}'::text[] else array[g.entity_kind] end
           when a.segment = 'Business' then coalesce(b.sector, '{}'::text[])
           else '{}'::text[]
         end as f_type,
         coalesce(i.sector, it.sector, g.mandate_focus, '{}'::text[]) as f_sector,
         coalesce(i.commodity, it.commodity, b.commodity, '{}'::text[]) as f_commodity,
         case when i.aum_range is null then '{}'::text[] else array[i.aum_range] end as f_aum,
         coalesce(i.invests_via, '{}'::text[]) as f_via,
         coalesce(i.invests_in_country_names, '{}'::text[]) as f_invests_in,
         case when b.stage is null then '{}'::text[] else array[b.stage] end as f_stage,
         coalesce(b.project_country_names, '{}'::text[]) as f_project,
         /* Kept only so CREATE OR REPLACE may keep the column list it already
            has. It now simply repeats the segment; nothing reads it. */
         a.segment as view
  from accounts a
    left join account_investor i on i.hr_id = a.hr_id
    left join account_intermediary it on it.hr_id = a.hr_id
    left join account_business b on b.hr_id = a.hr_id
    left join account_government g on g.hr_id = a.hr_id`);
console.log("account_facets keyed on segment again");

const IN_SCOPE = `c.segment in ${WORKING} and c.best_email_status is distinct from 'invalid'`;
const A_UNPIVOT = KEYS.map((k) => `
    select hr_id, segment, '${k}'::text as key, f_${k} as vals from account_facets`).join("\n    union all");
const C_UNPIVOT = KEYS.map((k) => `
    select c.hr_id, c.segment, '${k}'::text as key, af.f_${k} as vals
    from contacts c join account_facets af on af.hr_id = c.account_id
    where ${IN_SCOPE}`).join("\n    union all");

for (const [name, sql] of [
  ["facet_counts", `
    drop materialized view if exists facet_counts cascade;
    create materialized view facet_counts as
    with unpivoted as (${A_UNPIVOT})
    select segment, key, v as value, count(*)::int as n
    from unpivoted cross join lateral unnest(vals) v
    where v <> 'N/A' group by 1,2,3;
    create index facet_counts_idx on facet_counts (segment, key)`],
  ["facet_coverage", `
    drop materialized view if exists facet_coverage cascade;
    create materialized view facet_coverage as
    with unpivoted as (${A_UNPIVOT})
    select segment, key,
           count(*) filter (where vals <> '{}'::text[])::int as have,
           count(*)::int as segment_total
    from unpivoted group by 1,2;
    create index facet_coverage_idx on facet_coverage (segment)`],
  ["contact_facet_counts", `
    drop materialized view if exists contact_facet_counts cascade;
    create materialized view contact_facet_counts as
    with unpivoted as (${C_UNPIVOT})
    select segment, key, value, count(distinct hr_id)::int as n
    from unpivoted, unnest(vals) as value
    where value is not null and value <> '' group by 1,2,3;
    create index contact_facet_counts_idx on contact_facet_counts (segment, key)`],
  ["contact_facet_coverage", `
    drop materialized view if exists contact_facet_coverage cascade;
    create materialized view contact_facet_coverage as
    with unpivoted as (${C_UNPIVOT}),
    totals as (select c.segment, count(*)::int as segment_total
               from contacts c where ${IN_SCOPE} group by 1)
    select t.segment, u.key,
           count(distinct u.hr_id) filter (where coalesce(array_length(u.vals,1),0) > 0)::int as have,
           t.segment_total
    from totals t join unpivoted u on u.segment = t.segment
    group by t.segment, u.key, t.segment_total;
    create index contact_facet_coverage_idx on contact_facet_coverage (segment)`],
]) { await db.query(sql); console.log(`built ${name}`); }

/* ── Verification ───────────────────────────────────────────────────────── */
let bad = 0;
const after = (await db.query(
  `select segment, count(*)::int n from accounts group by 1 order by 2 desc`)).rows;
console.log("\nAccounts by segment:");
const beforeBy = Object.fromEntries(before.map((r) => [r.segment, r.n]));
for (const r of after) {
  const was = beforeBy[r.segment] ?? 0;
  console.log(`   ${String(r.segment).padEnd(22)} ${String(r.n).padStart(6)}${was !== r.n ? `   (was ${was})` : ""}`);
}
const total = (s) => s.reduce((n, r) => n + r.n, 0);
if (total(before) !== total(after)) { console.error("FAILED — accounts appeared or vanished."); bad++; }
else console.log(`   ${"".padEnd(22)} ${"-".repeat(6)}\n   ${"total".padEnd(22)} ${String(total(after)).padStart(6)}  (unchanged)`);

/* The point of the exercise: a deal must no longer see them. */
const stillInvestor = (await db.query(
  `select count(*)::int n from accounts a join account_investor i on i.hr_id = a.hr_id
   where a.segment = 'Investors'
     and (i.investor_type @> array['Family Office'] or i.investor_type @> array['HNWI'])`)).rows[0].n;
console.log(`\nFamily offices or individuals still filed as investors: ${stillInvestor}`);
if (stillInvestor !== 0) { console.error("FAILED — a deal would still match them."); bad++; }

/* And their enrichment must have survived the move. */
const enriched = (await db.query(
  `select count(*)::int n from accounts a join account_investor i on i.hr_id = a.hr_id
   where a.segment in ('Family Offices','High Net Worth') and i.investor_type is not null`)).rows[0].n;
const moved = (await db.query(
  `select count(*)::int n from accounts where segment in ('Family Offices','High Net Worth')`)).rows[0].n;
console.log(`Moved accounts that still carry their investor record: ${enriched} of ${moved}`);
if (enriched !== moved) { console.error("FAILED — a moved account lost its enrichment."); bad++; }

const orphan = (await db.query(
  `select count(*)::int n from contacts c join accounts a on a.hr_id = c.account_id
   where a.segment in ('Family Offices','High Net Worth') and c.segment = 'Investors'`)).rows[0].n;
console.log(`Contacts left behind at a moved firm: ${orphan}`);
if (orphan !== 0) { console.error("FAILED — a person is filed apart from their firm."); bad++; }

await db.end();
process.exit(bad ? 1 : 0);
