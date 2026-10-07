#!/usr/bin/env node
/**
 * The six invented raises, the people they went to, and what came back.
 * Also weights geography so the country lists look like a real book of
 * business rather than a uniform draw over forty countries.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./hash.mjs";
import * as V from "./vocab.mjs";

const db = new pg.Client({ connectionString: process.env.DEMO_DB_URL || "postgres://demo@127.0.0.1:5433/crm_demo" });
await db.connect();

let seed = 771103;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const arr = (a) => `{${a.map((x) => `"${x}"`).join(",")}}`;

await db.query("begin");

/* ── 1. Weight the geography ───────────────────────────────────────────── */
/* A natural-resources book sits mostly in six financial centres. A uniform
   draw over forty countries makes every filter look equally likely, which is
   both wrong and, on a screenshot, obviously synthetic. */
const HUBS = [["US","United States"],["GB","United Kingdom"],["AU","Australia"],
              ["CA","Canada"],["HK","Hong Kong"],["SG","Singapore"]];
for (const [code, name] of HUBS) {
  await db.query(
    `update accounts set countries = array_prepend($1, countries),
                         country_names = array_prepend($2, country_names)
     where random() < $3 and not ($1 = any(countries))`,
    [code, name, code === "US" ? 0.30 : code === "GB" ? 0.14 : code === "AU" ? 0.13 : 0.08]);
}
/* Investors that back Australian mining — enough of them that a lithium raise
   in Western Australia has a real first tier rather than three names. */
await db.query(
  `update account_investor i set
     invests_in_countries = array_prepend('AU', invests_in_countries),
     invests_in_country_names = array_prepend('Australia', invests_in_country_names)
   from accounts a where a.hr_id = i.hr_id and random() < 0.16
     and not ('AU' = any(i.invests_in_countries))`);
await db.query(
  `update account_investor set commodity = array_cat(commodity, '{Lithium,Copper}')
   where random() < 0.13 and 'Mining' = any(invests_in)
     and not ('Lithium' = any(commodity))`);

/* ── 2. The raises ─────────────────────────────────────────────────────── */
const issuers = (await db.query(
  `select hr_id, name, domain from accounts
   where segment = 'Business' order by hr_id limit 40`)).rows;

const DEALS = [
  { i: 0, status: "Live", raising: "US$15 million", countries: "AU", stage: "Feasibility",
    valuation: "A$62m pre-money", closing: "Q4 2026",
    sector: "Hard-rock lithium and copper development, Western Australia",
    summary: "A definitive feasibility study is complete on a hard-rock lithium project in the Goldfields, with a copper-gold satellite deposit on the same tenement package. The raise funds long-lead items and the first stage of plant construction.",
    terms: "Placement of new ordinary shares at A$0.42, a 12% discount to the 30-day VWAP, with one free attaching option for every two shares.",
    highlights: ["DFS complete: 14-year mine life at 1.4Mtpa","Binding offtake for 60% of stage-one production","Grid power and sealed road to the gate","Board has taken up 8% of the raise"] },
  { i: 1, status: "Live", raising: "US$40 million", countries: "CL", stage: "Development",
    valuation: "US$210m pre-money", closing: "Q1 2027",
    sector: "Copper development, Atacama region, Chile",
    summary: "Pre-IPO placement ahead of a planned dual listing. Permitted copper heap-leach project with an existing SX-EW plant nearby.",
    terms: "Convertible note, 18 months, converting at a 20% discount to the IPO price.",
    highlights: ["Permits granted for stage one","Water rights secured to 2041","Two strategic parties in the data room"] },
  { i: 2, status: "Live", raising: "US$8 million", countries: "TZ", stage: "Exploration",
    valuation: "US$31m pre-money", closing: "Q4 2026",
    sector: "Rare earths exploration, southern Tanzania",
    summary: "Bridge financing to complete a maiden resource estimate on an ionic-clay rare earths project, ahead of a larger raise next year.",
    terms: "Unsecured convertible bridge at a 25% discount to the next qualifying financing.",
    highlights: ["Ionic clay, low thorium","Metallurgical testwork returned 71% recovery","Government has granted the mining licence"] },
  { i: 3, status: "Closing", raising: "US$25 million", countries: "GH", stage: "Producing",
    valuation: "US$140m pre-money", closing: "This month",
    sector: "Gold production expansion, Ghana",
    summary: "Expansion capital for a producing underground gold mine, taking throughput from 900ktpa to 1.5Mtpa.",
    terms: "Equity placement at a 9% discount, with a A$5m cornerstone already committed.",
    highlights: ["Producing since 2023, all-in cost US$1,140/oz","Expansion permitted","Cornerstone investor committed"] },
  { i: 4, status: "Closed", raising: "US$60 million", countries: "CA", stage: "Development",
    valuation: "C$380m pre-money", closing: "Closed August 2026",
    sector: "Uranium development, Athabasca Basin, Canada",
    summary: "Fully subscribed development financing for a high-grade uranium project.",
    terms: "Equity, closed and allotted.",
    highlights: ["Fully subscribed in nine days","Two utilities took part"] },
  { i: 5, status: "On hold", raising: "US$5 million", countries: "MZ", stage: "Exploration",
    valuation: "US$18m pre-money", closing: "Paused",
    sector: "Graphite exploration, Mozambique",
    summary: "Seed round paused pending the outcome of a licence renewal.",
    terms: "Seed equity, paused.",
    highlights: ["Licence renewal lodged"] },
];

const made = [];
for (const d of DEALS) {
  const issuer = issuers[d.i];
  const ref = `${issuer.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.floor(rnd() * 1e6).toString(16)}`;
  const id = randomUUID();
  const created = new Date(Date.now() - (6 - d.i) * 11 * 86400000);
  await db.query(
    `insert into deals (id, reference, title, company_id, summary, raise_terms, status,
       created_by, created_at, updated_at, sector, countries, raising, valuation, stage,
       website, closing, highlights, document_name, draft_gaps, written_at, draft_model)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$9,$20)`,
    [id, ref, issuer.name, issuer.hr_id, d.summary, d.terms, d.status, "grace@halden-ridge.example",
     created, d.sector, d.countries, d.raising, d.valuation, d.stage,
     `https://www.${issuer.domain}`, d.closing, arr(d.highlights),
     `${issuer.name.replace(/ /g, "-")}-teaser.pdf`,
     arr(d.i === 2 ? ["Use of funds not broken down","No independent resource estimate yet"] : []),
     "claude-opus-4"]);
  made.push({ ...d, id, ref, issuer });
}
console.log(`deals ${made.length}`);

/* ── 3. Who each raise went to ─────────────────────────────────────────── */
const SENDERS = ["grace@halden-ridge.example","alan@halden-ridge.example","peter@halden-ridge.example","ruth@halden-ridge.example"];
const SIZE = [210, 140, 60, 95, 180, 0];

for (const d of made) {
  const n = SIZE[d.i];
  if (!n) continue;
  /* Investors first, then the intermediaries who reach them — which is how a
     raise is actually worked. */
  const people = (await db.query(
    `select c.hr_id, c.account_id from contacts c
     join accounts a on a.hr_id = c.account_id
     where a.segment in ('Investors','Family Offices','High Net Worth','Intermediaries')
       and c.best_email_status is distinct from 'invalid'
       and c.segment in ('Investors','Family Offices','High Net Worth','Intermediaries')
     order by md5(c.hr_id || $2) limit $1`, [n, d.ref])).rows;

  const base = new Date(d.i === 5 ? Date.now() : Date.parse(String(new Date(Date.now() - (6 - d.i) * 10 * 86400000))));
  const rows = [], firms = new Map();
  for (const [k, p] of people.entries()) {
    const added = new Date(base.getTime() + k * 60000);
    /* A live raise is part-worked: most drafted, most of those sent, a third
       of those answered. A closed one is finished. */
    const doneRate = d.status === "Closed" ? 1 : d.status === "Closing" ? 0.92 : 0.8;
    const drafted = chance(doneRate) ? new Date(added.getTime() + 3600000) : null;
    const sent = drafted && chance(0.86) ? new Date(drafted.getTime() + 7200000) : null;
    const replied = sent && chance(0.29) ? new Date(sent.getTime() + int(4, 96) * 3600000) : null;
    const sender = pick(SENDERS);
    rows.push([d.id, p.hr_id, "grace@halden-ridge.example", added, drafted, sent, replied, sender,
      sent ? `conv-${p.hr_id}-${d.i}` : null, sent ? "graph" : null, replied ? "graph" : null]);
    if (replied && !firms.has(p.account_id)) firms.set(p.account_id, replied);
  }
  for (let i = 0; i < rows.length; i += 300) {
    const slice = rows.slice(i, i + 300);
    const params = []; const t = [];
    for (const r of slice) t.push(`(${r.map((v) => `$${params.push(v)}`).join(",")})`);
    await db.query(`insert into deal_contacts
      (deal_id, contact_id, added_by, added_at, drafted_at, sent_at, replied_at, sender,
       conversation_id, sent_source, replied_source) values ${t.join(",")}`, params);
  }

  /* What the firms said. A verdict belongs to the house, not the person. */
  let acc = 0, pas = 0;
  for (const [accountId, when] of firms) {
    if (!chance(0.55)) continue;
    const yes = chance(0.42);
    await db.query(
      `insert into deal_verdicts (deal_id, account_id, verdict, decided_at, source, evidence, recorded_by)
       values ($1,$2,$3,$4,'email',$5,'grace@halden-ridge.example')`,
      [d.id, accountId, yes ? "Accepted" : "Passed", when, yes
        ? "“This is one for us — send the data room link and we will come back with a number this week.”"
        : "“Thank you for thinking of us. Below our size at this stage; please keep us on the list for the next one.”"]);
    yes ? acc++ : pas++;
  }
  console.log(`  ${d.ref}: ${rows.length} people, ${acc} accepted, ${pas} passed`);
}

/* ── 4. The mailbox record behind it ───────────────────────────────────── */
await db.query(
  `insert into mail_events (message_id, contact_id, direction, mailbox, occurred_at, conversation_id, subject)
   select 'msg-out-' || dc.contact_id || '-' || left(dc.deal_id::text, 8), dc.contact_id, 'out',
          dc.sender, dc.sent_at, dc.conversation_id, d.title || ' — introduction'
   from deal_contacts dc join deals d on d.id = dc.deal_id where dc.sent_at is not null
   on conflict do nothing`);
await db.query(
  `insert into mail_events (message_id, contact_id, direction, mailbox, occurred_at, conversation_id, subject)
   select 'msg-in-' || dc.contact_id || '-' || left(dc.deal_id::text, 8), dc.contact_id, 'in',
          dc.sender, dc.replied_at, dc.conversation_id, 'RE: ' || d.title || ' — introduction'
   from deal_contacts dc join deals d on d.id = dc.deal_id where dc.replied_at is not null
   on conflict do nothing`);

/* ── 5. Somebody to sign in as ─────────────────────────────────────────── */
await db.query(
  `insert into app_people (name, email, kind, state, role, password_hash, decided_at, decided_by)
   values ($1,$2,'password','active','approver',$3, now(), 'demo')`,
  /* Set DEMO_PASSWORD before seeding; the fallback is for a throwaway local copy only. */
  ["Demo User", "demo@example.com", await hashPassword(process.env.DEMO_PASSWORD || "demo-password")]);

await db.query("commit");
for (const m of ["facet_counts","facet_coverage","contact_facet_counts","contact_facet_coverage"]) {
  await db.query(`refresh materialized view ${m}`);
}
console.log("deals, outreach and sign-in written");
await db.end();
