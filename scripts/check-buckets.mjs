#!/usr/bin/env node
/**
 * Do the four working segments and the three set-aside buckets still account
 * for every contact, exactly once?
 *
 * This is the one thing about the split that can break quietly. A person in
 * two buckets is double-counted; a person in none has vanished from a CRM that
 * still holds their row, and nothing on any screen would say so. Neither shows
 * up as an error — the pages render perfectly either way.
 *
 *   node scripts/check-buckets.mjs
 *
 * Exit 0 if every contact lands in exactly one place, 1 if not.
 */
import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';

const envFile = ['.env.local', '.env'].find((f) => existsSync(f));
const env = Object.fromEntries((envFile ? readFileSync(envFile, 'utf8') : '')
  .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const url = process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL;
if (!url) { console.error('No SUPABASE_DB_URL'); process.exit(2); }

/* Kept in step with app/lib/scope.ts by hand. If you change one, change both —
   the app cannot import from here and this cannot import TypeScript. */
const WORKING = `c.segment in ('Investors','Family Offices','High Net Worth','Intermediaries','Business','Government/Strategic')`;
const PLACES = {
  'in scope':   `${WORKING} and c.best_email_status is distinct from 'invalid'`,
  'pending':    `c.segment = 'Pending'`,
  'bad emails': `${WORKING} and c.best_email_status = 'invalid'`,
  'exclusions': `c.segment = 'Excluded'`,
};

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

/* How many of the four places each contact matches. One is right; anything
   else is the bug. Counting the matches is the test — comparing totals would
   pass if one person were double-counted and another lost. */
const sql = Object.values(PLACES).map((w) => `(case when ${w} then 1 else 0 end)`).join(' + ');
const { rows } = await db.query(
  `select ${sql} as places, count(*)::int n from contacts c group by 1 order by 1`);
const total = (await db.query(`select count(*)::int n from contacts`)).rows[0].n;

const each = {};
for (const [name, w] of Object.entries(PLACES)) {
  each[name] = (await db.query(`select count(*)::int n from contacts c where ${w}`)).rows[0].n;
}
await db.end();

for (const [name, n] of Object.entries(each)) {
  console.log(`${name.padEnd(11)} ${String(n).padStart(7)}`);
}
console.log(`${'—'.repeat(19)}\n${'total'.padEnd(11)} ${String(total).padStart(7)}`);

const wrong = rows.filter((r) => Number(r.places) !== 1);
if (wrong.length) {
  console.error('\nFAILED — every contact must land in exactly one place.');
  for (const r of wrong) {
    console.error(r.places === 0
      ? `  ${r.n} contacts are in NONE of them — they exist and appear nowhere.`
      : `  ${r.n} contacts are in ${r.places} of them at once — double-counted.`);
  }
  process.exit(1);
}
console.log('\nEvery contact lands in exactly one place.');
