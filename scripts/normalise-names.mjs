#!/usr/bin/env node
/**
 * Tidy the contact names that are not names.
 *
 *   node scripts/normalise-names.mjs            # show what would change
 *   node scripts/normalise-names.mjs --apply
 *   node scripts/normalise-names.mjs --revert --apply
 *
 * NOTHING IS EDITED IN PLACE WITHOUT A COPY. The original goes to
 * `full_name_raw` on every row that changes, so --revert puts all of it back
 * and any single row can be checked against what it used to say.
 *
 * ACCOUNTS ARE NOT TOUCHED, deliberately. Dozens of account names start with a
 * digit and almost every one is correct — think "7 Quay", "44North",
 * "1911 Asset Management". A rule that stripped leading numbers there would
 * destroy real company names, which is the same mistake that once put a
 * stranger's SEC filing on a Halden Ridge account.
 *
 * Four rules, in this order:
 *
 *  1. LEADING JUNK. Outlook sorting prefixes — `_Alex Brannigan`, `#ABC-
 *     Syndicate`, `+ XYZ StockTransfer`, `• Sam Dorsey`. Stripped as
 *     PUNCTUATION, never as "everything before the first A-Z": Øyvind
 *     Lindqvist, Иван Петров and a dozen Korean and Hebrew names do not start
 *     with a Latin letter either, and a Latin-letter rule would eat them.
 *
 *  2. WHITESPACE. Tabs, control characters and doubled spaces.
 *
 *  3. "SURNAME, FIRSTNAME" -> "Firstname Surname", ONLY where the person's own
 *     email address contains both halves. That test is the whole safety of it:
 *     `Sam Dorsey, QV Finance` is a name and a COMPANY, and flipping it would
 *     produce "QV Finance Sam Dorsey". Anything the address cannot confirm is
 *     left exactly as it is.
 *
 *  4. ALL CAPS -> Title Case. Skips single-word names, because acronyms like
 *     ABCM and SPAC read worse as Abcm and Spac than they do shouting. Skips
 *     anything with an underscore, a slash or a digit — those are system
 *     mailboxes, not people. Keeps one- and two-letter words uppercase, so
 *     initials survive: JANE A DOE becomes Jane A Doe, and a two-letter
 *     desk tag such as (KC) stays (KC).
 *
 * search_text is EXTENDED rather than rewritten, so somebody who searches the
 * old spelling still finds them.
 */
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");
const env = Object.fromEntries(
  (existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const url = process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL;
if (!url) { console.error("No SUPABASE_DB_URL"); process.exit(2); }
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

await db.query(`alter table contacts add column if not exists full_name_raw text`);

if (REVERT) {
  const back = await db.query(
    `update contacts set full_name = full_name_raw, full_name_raw = null
     where full_name_raw is not null returning hr_id`);
  console.log(`put ${back.rowCount} names back`);
  await db.end();
  process.exit(0);
}

/* ── the rules ─────────────────────────────────────────────────────────── */

/* A whole bracketed tag first — `[metals.example] Jane Doe`. Stripping
   only the leading "[" left the closing "]" stranded mid-name, which the dry
   run caught. */
const LEADING_TAG = /^\s*[[({][^\])}]{0,60}[\])}]\s*/u;
const LEADING_JUNK = /^[\p{P}\p{S}\p{Z}\p{C}]+/u;
const CONTROL = /[\p{C}]+/gu;

const core = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

/** A word that should stay shouting: an initial, or a short desk tag. */
const keepUpper = (w) => w.replace(/[^A-Za-z]/g, "").length <= 2;

function titleCase(name) {
  return name.split(" ").map((w) => {
    if (!w) return w;
    if (keepUpper(w)) return w;
    /* A trailing desk code — TANAKA KENJI-DESK041 — is not part of a name
       and reads worse as -Desk041, so the part after the hyphen is left. */
    const dash = w.indexOf("-");
    if (dash > 0 && /\d/.test(w.slice(dash))) {
      return w.slice(0, dash).charAt(0) + w.slice(1, dash).toLowerCase() + w.slice(dash);
    }
    /* Each half of a double-barrelled name is capitalised: ASHBY-KERR is
       Ashby-Kerr, not Ashby-kerr. */
    return w.split("-").map((part) =>
      part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part).join("-");
  }).join(" ");
}

function normalise(name, email) {
  const changed = [];
  let out = name;

  const untagged = out.replace(LEADING_TAG, "");
  const stripped = (untagged.trim() ? untagged : out).replace(LEADING_JUNK, "");
  if (stripped !== out && stripped.trim()) { out = stripped; changed.push("prefix"); }

  const spaced = out.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (spaced !== out) { out = spaced; changed.push("spacing"); }

  const comma = out.match(/^([^,]+),\s*([^,]+)$/);
  if (comma) {
    const [, surname, forename] = comma.map((x) => x.trim());
    const local = core(String(email).split("@")[0]);
    /* Both halves must be in their own address. Anything less and this starts
       reordering names that were never backwards. */
    if (core(surname) && core(forename) && local.includes(core(surname)) && local.includes(core(forename))) {
      out = `${forename} ${surname}`;
      changed.push("flipped");
    }
  }

  const letters = out.replace(/[^A-Za-z]/g, "");
  const shouting = letters.length >= 4 && out === out.toUpperCase();
  const isPerson = out.includes(" ") && !/[_/\d]/.test(out);
  if (shouting && isPerson) {
    const cased = titleCase(out);
    if (cased !== out) { out = cased; changed.push("caps"); }
  }

  return { out, changed };
}

/* ── run it ────────────────────────────────────────────────────────────── */

const SCOPE = `segment in ('Investors','Family Offices','High Net Worth','Intermediaries','Business','Government/Strategic')
  and best_email_status is distinct from 'invalid' and full_name is not null and full_name <> ''`;

const rows = (await db.query(
  `select hr_id, full_name, email, search_text from contacts where ${SCOPE}`)).rows;

const changes = [];
for (const r of rows) {
  const { out, changed } = normalise(r.full_name, r.email);
  if (changed.length && out !== r.full_name) changes.push({ ...r, next: out, why: changed });
}

const by = {};
for (const c of changes) for (const w of c.why) by[w] = (by[w] ?? 0) + 1;
console.log(`${rows.length.toLocaleString()} names read, ${changes.length.toLocaleString()} would change`);
for (const [k, v] of Object.entries(by)) console.log(`   ${String(v).padStart(5)}  ${k}`);

for (const w of Object.keys(by)) {
  console.log(`\n${w} — a sample:`);
  for (const c of changes.filter((c) => c.why.includes(w)).slice(0, 6))
    console.log(`   ${JSON.stringify(c.full_name)}  ->  ${JSON.stringify(c.next)}`);
}

if (!APPLY) { console.log("\nDry run. Re-run with --apply."); await db.end(); process.exit(0); }

let done = 0;
for (const c of changes) {
  await db.query(
    `update contacts
     set full_name_raw = coalesce(full_name_raw, full_name),
         full_name = $2,
         search_text = $3
     where hr_id = $1`,
    [c.hr_id, c.next, `${c.search_text ?? ""} ${c.next.toLowerCase()}`.trim()]);
  done++;
}
console.log(`\napplied to ${done.toLocaleString()} contacts; originals kept in full_name_raw`);
await db.end();
