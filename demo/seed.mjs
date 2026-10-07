#!/usr/bin/env node
/**
 * Fill the demo database with invented data.
 *
 * Nothing here comes from the live database. Every firm, person, address and
 * figure is generated from demo/vocab.mjs, deterministically, so a re-run
 * produces exactly the same screenshots.
 *
 *   node demo/seed.mjs
 */
import pg from "pg";
import { hashPassword } from "./hash.mjs";
import * as V from "./vocab.mjs";

const URL = process.env.DEMO_DB_URL || "postgres://demo@127.0.0.1:5433/crm_demo";
const db = new pg.Client({ connectionString: URL });
await db.connect();

/* ── deterministic randomness ──────────────────────────────────────────── */
let seed = 20260902;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pickN = (a, n) => { const s = new Set(); while (s.size < Math.min(n, a.length)) s.add(pick(a)); return [...s]; };
const chance = (p) => rnd() < p;
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const CODES = Object.keys(V.COUNTRIES);
const named = (codes) => codes.map((c) => V.COUNTRIES[c]).filter(Boolean);

/* ── names, all unique ─────────────────────────────────────────────────── */
const usedFirm = new Set();
function firmName(suffixes) {
  for (let i = 0; i < 200; i++) {
    const two = chance(0.35);
    const n = two
      ? `${pick(V.STEMS)} ${pick(V.SECOND)} ${pick(suffixes)}`
      : `${pick(V.STEMS)} ${pick(suffixes)}`;
    if (!usedFirm.has(n)) { usedFirm.add(n); return n; }
  }
  const n = `${pick(V.STEMS)} ${usedFirm.size} ${pick(suffixes)}`;
  usedFirm.add(n); return n;
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 26);
const usedDomain = new Set();
function domainFor(name) {
  let d = `${slug(name)}.example`;
  let i = 2; while (usedDomain.has(d)) d = `${slug(name)}${i++}.example`;
  usedDomain.add(d); return d;
}
const usedEmail = new Set();
function personName() { return `${pick(V.FORENAMES)} ${pick(V.SURNAMES)}`; }
function emailFor(full, domain) {
  const [f, l] = full.toLowerCase().split(" ");
  const forms = [`${f}.${l}`, `${f[0]}${l}`, `${f}${l[0]}`, `${f}_${l}`, `${l}.${f[0]}`];
  for (const form of forms) {
    const e = `${form.replace(/[^a-z0-9._]/g, "")}@${domain}`;
    if (!usedEmail.has(e)) { usedEmail.add(e); return e; }
  }
  const e = `${f}.${l}${usedEmail.size}@${domain}`; usedEmail.add(e); return e;
}

/* ── the shape of the demo set ─────────────────────────────────────────── */
const PLAN = [
  { segment: "Investors",           n: 3900, suffix: V.FUND_SUFFIX },
  { segment: "Family Offices",      n: 430,  suffix: V.FUND_SUFFIX },
  { segment: "High Net Worth",      n: 300,  suffix: V.FUND_SUFFIX },
  { segment: "Intermediaries",      n: 2950, suffix: V.INTER_SUFFIX },
  { segment: "Business",            n: 2560, suffix: V.MINER_SUFFIX },
  { segment: "Government/Strategic",n: 265,  suffix: null },
  { segment: "Excluded",            n: 1800, suffix: V.INTER_SUFFIX },
  { segment: "Pending",             n: 300,  suffix: V.FUND_SUFFIX },
];

const OWNERS = ["Alan", "Grace", "Peter", "Ruth"];

const accounts = [];
const investorRows = [], businessRows = [], interRows = [], govRows = [];
let aid = 0;

for (const p of PLAN) {
  for (let i = 0; i < p.n; i++) {
    const id = `HR-A-${String(++aid).padStart(6, "0")}`;
    let name;
    if (p.segment === "Government/Strategic") {
      const c = pick(CODES);
      name = `${V.COUNTRIES[c]} ${pick(["Critical Minerals Office", "Minerals Development Authority",
        "Export Finance Agency", "Resources Investment Board", "Strategic Reserves Programme"])}`;
      if (usedFirm.has(name)) name += ` (${pick(V.STEMS)})`;
      usedFirm.add(name);
    } else name = firmName(p.suffix);

    const domain = domainFor(name);
    const codes = pickN(CODES, chance(0.25) ? int(2, 4) : 1);
    const owner = pickN(OWNERS, chance(0.4) ? 2 : 1);

    accounts.push({ id, name, domain, segment: p.segment, codes, owner,
      website: chance(0.78) ? `https://www.${domain}` : null });

    if (p.segment === "Investors" || p.segment === "Family Offices" || p.segment === "High Net Worth") {
      const isFO = p.segment !== "Investors";
      const type = isFO ? (p.segment === "High Net Worth" ? ["HNWI"] : ["Family Office"])
        : pickN(V.INVESTOR_TYPES.slice(0, 8), chance(0.12) ? 2 : 1);
      /* Family offices and individuals are exempt from filing a fund size, so
         N/A is the answer rather than a hole. */
      const aum = isFO ? (chance(0.75) ? "N/A" : pick(V.AUM_BANDS))
        : chance(0.14) ? null : pick(V.AUM_BANDS);
      const sect = chance(0.72) ? pickN(V.SECTORS.slice(0, 4), int(1, 2)) : ["Generalist"];
      const metals = sect.includes("Mining") || sect.includes("Battery & Critical Minerals")
        ? (chance(0.78) ? pickN(V.COMMODITIES, int(1, 3)) : []) : [];
      const via = chance(0.08) ? [] : chance(0.15) ? ["Equity", "Debt"] : chance(0.07) ? ["Debt"] : ["Equity"];
      const invCodes = chance(0.34) ? pickN(CODES, int(1, 4)) : [];
      investorRows.push({ id, type, sector: sect, metals, via, aum,
        invCodes,
        cheque: chance(0.3) ? `$${pick([2,5,10,15,20,25])}m - $${pick([40,50,75,100,150])}m` : null });
    }
    if (p.segment === "Business") {
      const ind = pick(V.INDUSTRIES);
      businessRows.push({ id, industry: [ind],
        commodity: ind === "Mining" ? pickN(V.COMMODITIES, int(1, 2)) : [],
        stage: chance(0.8) ? pick(V.STAGES) : null,
        ticker: chance(0.35) ? `${slug(name).slice(0, 3).toUpperCase()}` : null,
        hq: pick(["Perth", "Toronto", "London", "Vancouver", "Sydney", "Denver", "Johannesburg", "Brisbane"]),
        projects: pickN(CODES, int(1, 3)),
        mcap: chance(0.5) ? `A$${int(20, 900)}m` : null });
    }
    if (p.segment === "Intermediaries") interRows.push({ id, type: pick(V.INTERMEDIARY_TYPES),
      sector: chance(0.8) ? pickN(V.SECTORS, int(1, 2)) : [],
      commodity: chance(0.3) ? pickN(V.COMMODITIES, int(1, 2)) : [] });
    if (p.segment === "Government/Strategic") govRows.push({ id, kind: pick(V.GOV_KINDS),
      mandate: pickN(V.MANDATES, int(1, 3)) });
  }
}
console.log(`accounts ${accounts.length}`);

/* ── people ────────────────────────────────────────────────────────────── */
const TITLES = {
  "Investors": V.INVESTOR_TITLES, "Family Offices": V.INVESTOR_TITLES,
  "High Net Worth": V.INVESTOR_TITLES, "Intermediaries": V.INTER_TITLES,
  "Business": V.BUSINESS_TITLES, "Government/Strategic": V.GOV_TITLES,
  "Excluded": V.INTER_TITLES, "Pending": V.INTER_TITLES,
};
const contacts = [];
let cid = 0;
for (const a of accounts) {
  const n = a.segment === "High Net Worth" ? 1
    : a.segment === "Excluded" ? int(1, 2)
    : a.segment === "Pending" ? 1
    : chance(0.45) ? 1 : chance(0.6) ? int(2, 3) : int(4, 9);
  for (let i = 0; i < n; i++) {
    const id = `HR-C-${String(++cid).padStart(6, "0")}`;
    const full = personName();
    const email = emailFor(full, a.domain);
    /* Roughly the real mix: half confirmed deliverable, a fifth catch-all,
       the rest bounces. A bouncing address is set aside, never deleted. */
    const r = rnd();
    const status = a.segment === "Excluded" ? null
      : r < 0.55 ? "deliverable" : r < 0.78 ? "unknown" : "invalid";
    contacts.push({
      id, accountId: a.id, full: chance(0.86) ? full : null, email,
      title: chance(0.72) ? pick(TITLES[a.segment]) : null,
      segment: a.segment, status, owner: a.owner, codes: a.codes,
      replied: chance(0.36), mailchimp: chance(0.22), domain: a.domain,
    });
  }
}
console.log(`contacts ${contacts.length}`);

/* ── writing ───────────────────────────────────────────────────────────── */
const arr = (a) => `{${a.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(",")}}`;
async function bulk(table, cols, rows, values) {
  const CH = 500;
  for (let i = 0; i < rows.length; i += CH) {
    const slice = rows.slice(i, i + CH);
    const params = []; const tuples = [];
    for (const r of slice) {
      const v = values(r);
      tuples.push(`(${v.map(() => `$${params.push(0)}`).join(",")})`);
      params.splice(params.length - v.length, v.length, ...v);
    }
    await db.query(`insert into ${table} (${cols.join(",")}) values ${tuples.join(",")}`, params);
  }
  console.log(`  ${table}: ${rows.length}`);
}

await db.query("begin");
for (const t of ["mail_events","deal_verdicts","deal_target_removals","deal_contacts","deal_revisions",
  "deal_drafts","deal_documents","deals","contact_emails","contact_notes","contacts",
  "account_investor","account_business","account_intermediary","account_government","accounts",
  "app_people","new_arrivals","email_templates"]) await db.query(`delete from ${t}`);

await bulk("accounts",
  ["hr_id","name","domain","segment","contact_count","no_contact","reachable_contact","included",
   "owner","countries","country_names","website","search_text"],
  accounts, (a) => [a.id, a.name, a.domain, a.segment, 0, false, true,
    !["Excluded","Pending"].includes(a.segment), arr(a.owner), arr(a.codes), arr(named(a.codes)),
    a.website, `${a.name} ${a.domain}`.toLowerCase()]);

await bulk("account_investor",
  ["hr_id","investor_type","invests_in","invests_in_countries","invests_in_country_names",
   "invests_via","aum_range","aum_basis","cheque_size","cheque_size_basis","sector","commodity"],
  investorRows, (r) => [r.id, arr(r.type), arr(r.sector), arr(r.invCodes), arr(named(r.invCodes)),
    arr(r.via), r.aum,
    r.aum && r.aum !== "N/A" ? "Regulatory filing" : r.aum === "N/A" ? "Exempt from registration" : null,
    r.cheque, r.cheque ? "Stated on the firm's own site" : null, arr(r.sector), arr(r.metals)]);

await bulk("account_business",
  ["hr_id","industry","sector","commodity","stage","ticker","hq_city","project_countries",
   "project_country_names","market_cap"],
  businessRows, (r) => [r.id, arr(r.industry), arr(r.industry), arr(r.commodity), r.stage, r.ticker,
    r.hq, arr(r.projects), arr(named(r.projects)), r.mcap]);

await bulk("account_intermediary", ["hr_id","intermediary_type","sector_focus","sector","commodity"],
  interRows, (r) => [r.id, r.type, arr(r.sector), arr(r.sector), arr(r.commodity)]);

await bulk("account_government", ["hr_id","entity_kind","mandate_focus"],
  govRows, (r) => [r.id, r.kind, arr(r.mandate)]);

await bulk("contacts",
  ["hr_id","account_id","full_name","job_title","email","best_email","domain","segment",
   "owner","countries","country_names","replied","in_mailchimp","email_verified",
   "best_email_status","search_text"],
  contacts, (c) => [c.id, c.accountId, c.full, c.title, c.email, c.email, c.domain, c.segment,
    arr(c.owner), arr(c.codes), arr(named(c.codes)), c.replied, c.mailchimp, c.status !== null,
    c.status, `${c.full ?? ""} ${c.email} ${c.title ?? ""}`.toLowerCase()]);

await bulk("contact_emails", ["email","contact_id","is_primary","status"],
  contacts, (c) => [c.email, c.id, true, c.status]);

await db.query(`update accounts a set contact_count = x.n,
  reachable_contact = x.ok > 0, no_contact = x.n = 0
  from (select account_id, count(*) n,
        count(*) filter (where best_email_status is distinct from 'invalid') ok
        from contacts group by account_id) x where x.account_id = a.hr_id`);
await db.query("commit");

console.log("accounts and people written");
await db.end();
