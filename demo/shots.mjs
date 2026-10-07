#!/usr/bin/env node
// Playwright is not a project dependency: `npm i -D playwright` before running.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import pg from "pg";

const BASE = "http://localhost:3100";
const OUT = new URL("./shots", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const db = new pg.Client({ connectionString: process.env.DEMO_DB_URL || "postgres://demo@127.0.0.1:5433/crm_demo" });
await db.connect();
/* The hero raise is the lithium one seed-deals.mjs writes first. */
const hero = (await db.query(
  `select reference, title, status from deals where raising = 'US$15 million' order by created_at limit 1`)).rows[0];
const acct = (await db.query(
  `select a.hr_id from accounts a join account_investor i on i.hr_id = a.hr_id
   where a.segment='Investors' and i.aum_range not in ('N/A') and i.cheque_size is not null
     and cardinality(i.holds_hr_companies) > 1 and cardinality(i.commodity) > 1
     and a.note is not null and a.contact_count between 3 and 6
   order by a.hr_id limit 1`)).rows[0];
const person = (await db.query(
  `select c.hr_id from contacts c join accounts a on a.hr_id=c.account_id
   join deal_contacts dc on dc.contact_id = c.hr_id
   where a.segment='Investors' and c.full_name is not null and c.job_title is not null
     and c.replied and dc.replied_at is not null and a.note is not null
   order by c.hr_id limit 1`)).rows[0];
await db.end();
console.log("hero deal:", hero.reference, "|", hero.title);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

/* Sign in through the password door — no Microsoft tenant is involved. */
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill("#email", "demo@example.com");
await page.fill('input[type="password"]', process.env.DEMO_PASSWORD || "demo-password");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
console.log("signed in ->", page.url());

async function shot(name, path, { full = false, wait = 1200, before } = {}) {
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90000 });
  await page.addStyleTag({ content: "nextjs-portal,#nextjs-devtools{display:none!important}" });
  if (before) await before(page);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log(`  ${name}.png  <- ${path}`);
}

await shot("01-landing", "/");
await shot("02-deals-list", "/deals");
await shot("03-matched-accounts", `/deals/${hero.reference}/targets`);
await shot("03b-matched-accounts-full", `/deals/${hero.reference}/targets`, { full: true });
await shot("04-outreach-board", "/outreach");
await shot("05-outreach-tracker", `/outreach?deal=${hero.reference}`);
await shot("05b-outreach-replied", `/outreach?deal=${hero.reference}&status=Replied`);
await shot("06-deal-record", `/deals/${hero.reference}`);
await shot("06b-deal-teaser-full", `/deals/${hero.reference}`, { full: true });
await shot("11-draft-email", `/deals/${hero.reference}/draft`, {
  before: async (p) => {
    /* Start from a template so the composer shows a written email rather than
       an empty box — that is how it is used. */
    await p.getByRole("button", { name: "Investor introduction" }).click();
    await p.waitForTimeout(600);
  },
});
await shot("07-contacts", "/contacts");
await shot("08-accounts", "/accounts");
if (acct) await shot("09-account-record", `/accounts/${acct.hr_id}`);
if (person) await shot("10-contact-record", `/contacts/${person.hr_id}`);

await browser.close();
console.log(`\nwritten to ${OUT}`);
