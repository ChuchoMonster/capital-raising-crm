"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "../session";
import { query, one } from "../db";
import { readSheet, UnreadableSheet, MAX_ROWS } from "./parse";
import {
  mapContacts, mapAccounts, readContact, readAccount, looksLikeEmail,
} from "./map";
import { isFreeEmailDomain } from "./enrich";

/**
 * Adding people or firms from a spreadsheet.
 *
 * TWO STEPS ON PURPOSE. The file is read and mapped first and NOTHING is
 * written; what the columns were taken to mean, and what would happen to every
 * row, is put in front of the person. Only then is it committed. A wrong
 * column guess and a right one look identical once the rows are in, and this
 * is the only moment at which the difference is visible.
 *
 * WHAT AN UPLOADED ROW BECOMES. A person whose email domain is a firm the CRM
 * already holds is attached to it and takes its segment — that is the same
 * "do we already know this domain" join the research pipeline starts with, and
 * it is free. Everybody else lands in PENDING, which is the honest answer: we
 * have their address and no idea who they are. They are never guessed into
 * Investors.
 *
 * ⚠️ IDS ARE MINTED IN THEIR OWN SPACE — HR-CU- and HR-AU-, not HR-C- and
 * HR-A-. The research pipeline mints the numbered ones from its own files and
 * knows nothing about anything added here; continuing its sequence would mean
 * the next weekly run hands the same number to a different person, and the
 * loader would upsert one on top of the other. Two people would silently
 * become one, which is the exact failure this project has already paid for
 * once in dedup.
 */

export interface ImportPreview {
  ok: boolean;
  message: string;
  kind?: "contacts" | "accounts";
  /** field -> the column heading it was read from. */
  mapped?: Record<string, string>;
  /** Headings nothing matched. Named so a missed column is visible. */
  ignored?: string[];
  fileRows?: number;
  /** Beyond MAX_ROWS the rest were not read; said rather than implied. */
  truncated?: number;
  newRows?: number;
  knownRows?: number;
  unusable?: { row: number; why: string }[];
  /** The first few new rows, exactly as they would be written. */
  sample?: Record<string, string>[];
  /** Passed back to the commit step so the file is read once. */
  token?: string;
}

const MAX_BYTES = 4 * 1024 * 1024;
const SAMPLE = 5;

/* The parsed file, held between preview and commit. In memory and per-process:
   a re-preview simply re-reads, and the worst case of losing one is that the
   person presses the button again. Nothing is written from here without a
   token that was made in the same process from the same bytes. */
const pending = new Map<string, { kind: "contacts" | "accounts"; rows: Record<string, string>[]; at: number }>();
const TEN_MINUTES = 10 * 60 * 1000;
function keep(kind: "contacts" | "accounts", rows: Record<string, string>[]): string {
  for (const [k, v] of pending) if (Date.now() - v.at > TEN_MINUTES) pending.delete(k);
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  pending.set(token, { kind, rows, at: Date.now() });
  return token;
}

/* ── Reading the file ────────────────────────────────────────────────────── */

export async function previewImport(
  kind: "contacts" | "accounts",
  fileName: string,
  base64: string,
): Promise<ImportPreview> {
  await requireUser();

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  } catch {
    return { ok: false, message: "That file did not arrive intact. Try again." };
  }
  if (bytes.byteLength > MAX_BYTES)
    return { ok: false, message: "That file is over 4MB. Split it, or save it as CSV — a CSV of the same list is far smaller." };

  let sheet;
  try {
    sheet = readSheet(fileName, bytes);
  } catch (e) {
    if (e instanceof UnreadableSheet) return { ok: false, message: e.message };
    console.error("could not read an uploaded sheet", e);
    return { ok: false, message: "That file could not be read. A CSV or .xlsx saved from Excel or Google Sheets will work." };
  }

  const truncated = sheet.totalRows > sheet.rows.length ? sheet.totalRows - sheet.rows.length : 0;

  return kind === "contacts"
    ? previewContacts(sheet, truncated)
    : previewAccounts(sheet, truncated);
}

async function previewContacts(
  sheet: { headers: string[]; rows: Record<string, string>[] }, truncated: number,
): Promise<ImportPreview> {
  const m = mapContacts(sheet.headers);
  if (!m.fields.email)
    return {
      ok: false,
      message: `No email column. One heading must be something like "Email" or "Email Address" — these were: ${sheet.headers.join(", ")}`,
    };

  const unusable: { row: number; why: string }[] = [];
  const seen = new Set<string>();
  const usable: Record<string, string>[] = [];

  sheet.rows.forEach((raw, i) => {
    const c = readContact(raw, m);
    /* An address is the point of a contact. A row without one cannot be
       emailed, deduped or matched to a firm, so it is refused rather than
       stored as a name nobody can act on. */
    if (!c.email) { unusable.push({ row: i + 2, why: "no email address" }); return; }
    if (!looksLikeEmail(c.email)) { unusable.push({ row: i + 2, why: `"${c.email}" is not an email address` }); return; }
    if (seen.has(c.email)) { unusable.push({ row: i + 2, why: `${c.email} appears twice in the file` }); return; }
    seen.add(c.email);
    usable.push(raw);
  });

  /* Everything already held, in ONE query rather than one per row: matched on
     every address a person owns, not just their primary, or somebody's second
     address comes back in as a second person. */
  const emails = [...seen];
  const known = new Set(
    (await query<{ email: string }>(
      `select lower(email) as email from contacts where lower(email) = any($1::text[])
       union
       select lower(best_email) from contacts where lower(best_email) = any($1::text[])
       union
       select lower(email) from contact_emails where lower(email) = any($1::text[])`,
      [emails])).map((r) => r.email));

  const fresh = usable.filter((raw) => !known.has(readContact(raw, m).email));

  return {
    ok: true, kind: "contacts",
    mapped: m.fields as Record<string, string>,
    ignored: m.ignored,
    fileRows: sheet.rows.length,
    truncated,
    newRows: fresh.length,
    knownRows: usable.length - fresh.length,
    unusable: unusable.slice(0, 20),
    sample: fresh.slice(0, SAMPLE).map((raw) => {
      const c = readContact(raw, m);
      return { Name: c.name || "(no name)", Email: c.email, Company: c.company || c.domain || "", "Job title": c.jobTitle };
    }),
    token: keep("contacts", fresh),
    message: fresh.length
      ? `${fresh.length} new ${fresh.length === 1 ? "person" : "people"} to add.`
      : "Everybody in that file is already in the CRM.",
  };
}

async function previewAccounts(
  sheet: { headers: string[]; rows: Record<string, string>[] }, truncated: number,
): Promise<ImportPreview> {
  const m = mapAccounts(sheet.headers);
  if (!m.fields.name && !m.fields.domain)
    return {
      ok: false,
      message: `No company name or web address column. One heading must be something like "Company" or "Website" — these were: ${sheet.headers.join(", ")}`,
    };

  const unusable: { row: number; why: string }[] = [];
  const seen = new Set<string>();
  const usable: Record<string, string>[] = [];

  sheet.rows.forEach((raw, i) => {
    const a = readAccount(raw, m);
    if (!a.domain && !a.name) { unusable.push({ row: i + 2, why: "no company name or web address" }); return; }
    /* Firms are keyed on the web address, as everywhere else in the CRM. One
       with no address cannot be told apart from another of the same name, so
       it is refused rather than merged with something. */
    if (!a.domain) { unusable.push({ row: i + 2, why: `${a.name} has no web address` }); return; }
    if (seen.has(a.domain)) { unusable.push({ row: i + 2, why: `${a.domain} appears twice in the file` }); return; }
    seen.add(a.domain);
    usable.push(raw);
  });

  const domains = [...seen];
  const known = new Set(
    (await query<{ domain: string }>(
      `select lower(domain) as domain from accounts where lower(domain) = any($1::text[])`,
      [domains])).map((r) => r.domain));

  const fresh = usable.filter((raw) => !known.has(readAccount(raw, m).domain));

  return {
    ok: true, kind: "accounts",
    mapped: m.fields as Record<string, string>,
    ignored: m.ignored,
    fileRows: sheet.rows.length,
    truncated,
    newRows: fresh.length,
    knownRows: usable.length - fresh.length,
    unusable: unusable.slice(0, 20),
    sample: fresh.slice(0, SAMPLE).map((raw) => {
      const a = readAccount(raw, m);
      return { Company: a.name || a.domain, "Web address": a.domain, Country: a.country };
    }),
    token: keep("accounts", fresh),
    message: fresh.length
      ? `${fresh.length} new ${fresh.length === 1 ? "firm" : "firms"} to add.`
      : "Every firm in that file is already in the CRM.",
  };
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

export interface ImportResult { ok: boolean; message: string; added: number }

/** The next free id in the CRM's own space. Never the pipeline's. */
async function nextId(prefix: string, table: "contacts" | "accounts"): Promise<number> {
  const r = await one<{ m: number | null }>(
    `select max((substring(hr_id from ${prefix.length + 1}))::int) as m
     from ${table} where hr_id like $1`, [`${prefix}%`]);
  return (r?.m ?? 0) + 1;
}

export async function commitImport(token: string): Promise<ImportResult> {
  const user = await requireUser();
  const held = pending.get(token);
  if (!held)
    return { ok: false, added: 0, message: "That upload has expired. Choose the file again — nothing was written." };
  pending.delete(token);

  return held.kind === "contacts"
    ? addContacts(held.rows, user.email)
    : addAccounts(held.rows, user.email);
}

async function addContacts(rows: Record<string, string>[], by: string): Promise<ImportResult> {
  if (!rows.length) return { ok: true, added: 0, message: "Nothing to add." };
  const m = mapContacts(Object.keys(rows[0]));
  const people = rows.map((r) => readContact(r, m));

  /* Which of these domains is a firm we already hold. One query, and it is
     what decides where an uploaded person lands: attached to a known firm they
     take its segment, and everybody else is Pending. Nobody is guessed into
     Investors on the strength of a spreadsheet.

     ⚠️ A CONSUMER PROVIDER IS NEVER A FIRM. gmail.com, outlook.com and four
     others exist as accounts here — filed Excluded, correctly, because the
     provider is not a counterparty. Joining on the domain would have attached
     every uploaded gmail address to "Gmail" and filed the person as Excluded
     the moment they arrived: not merely wrong, but the one outcome that puts
     them beyond every later pass, since nothing looks at Excluded again. */
  const domains = [...new Set(people.map((p) => p.domain).filter((d) => d && !isFreeEmailDomain(d)))];
  const firms = new Map(
    (await query<{ domain: string; hr_id: string; segment: string }>(
      `select lower(domain) as domain, hr_id, segment from accounts
       where lower(domain) = any($1::text[])`, [domains]))
      .map((r) => [r.domain, r]));

  let n = await nextId("HR-CU-", "contacts");
  let added = 0;
  for (const p of people) {
    const firm = p.domain && !isFreeEmailDomain(p.domain) ? firms.get(p.domain) : undefined;
    const id = `HR-CU-${String(n++).padStart(6, "0")}`;
    try {
      await query(
        `insert into contacts
           (hr_id, account_id, full_name, job_title, email, best_email, domain,
            segment, note, owner, countries, country_names, search_text)
         values ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'{}','{}',$10)`,
        [id, firm?.hr_id ?? null, p.name || null, p.jobTitle || null, p.email,
         p.domain || null, firm?.segment ?? "Pending", noteFor(p), [`Uploaded`],
         [p.name, p.email, p.company, p.domain, p.jobTitle].filter(Boolean).join(" ").toLowerCase()]);
      await query(
        `insert into contact_emails (contact_id, email, is_primary) values ($1,$2,true)
         on conflict do nothing`, [id, p.email]);
      added++;
    } catch (e) {
      console.error("could not add an uploaded contact", p.email, e);
    }
  }

  revalidatePath("/contacts");
  revalidatePath("/accounts");
  const placed = people.filter((p) => p.domain && !isFreeEmailDomain(p.domain) && firms.has(p.domain)).length;
  return {
    ok: true, added,
    message: `${added} added${placed ? `, ${placed} of them attached to a firm already in the CRM` : ""}.`
      + (added < people.length ? ` ${people.length - added} could not be written — see the server log.` : "")
      + ` Added by ${by.split("@")[0]}.`,
  };
}

async function addAccounts(rows: Record<string, string>[], by: string): Promise<ImportResult> {
  if (!rows.length) return { ok: true, added: 0, message: "Nothing to add." };
  const m = mapAccounts(Object.keys(rows[0]));
  const firms = rows.map((r) => readAccount(r, m));

  let n = await nextId("HR-AU-", "accounts");
  let added = 0;
  for (const f of firms) {
    const id = `HR-AU-${String(n++).padStart(6, "0")}`;
    try {
      await query(
        `insert into accounts
           (hr_id, name, domain, segment, type, note, owner, countries, country_names, search_text, website)
         values ($1,$2,$3,'Pending',$4,$5,$6,'{}','{}',$7,$8)`,
        [id, f.name || f.domain, f.domain || null, f.type || null, f.note || null,
         [`Uploaded`], [f.name, f.domain].filter(Boolean).join(" ").toLowerCase(),
         f.domain || null]);
      added++;
    } catch (e) {
      console.error("could not add an uploaded account", f.domain, e);
    }
  }

  revalidatePath("/accounts");
  return {
    ok: true, added,
    message: `${added} ${added === 1 ? "firm" : "firms"} added, in Pending until somebody says what they are.`
      + (added < firms.length ? ` ${firms.length - added} could not be written — see the server log.` : "")
      + ` Added by ${by.split("@")[0]}.`,
  };
}

/**
 * What the spreadsheet claimed, kept on the row.
 *
 * A company name and a LinkedIn address in the file are the only things known
 * about somebody on a personal address, and they are exactly what the person
 * lookup starts from. Discarding them and then paying a model to search for the
 * same facts would be its own kind of silly.
 */
function noteFor(p: { note: string; company: string; linkedin: string; phone: string }): string | null {
  const claimed = [
    p.company && `company "${p.company}"`,
    p.linkedin,
    p.phone && `phone ${p.phone}`,
  ].filter(Boolean).join("; ");
  const parts = [p.note, claimed && `Uploaded with: ${claimed}`].filter(Boolean);
  return parts.length ? parts.join(" — ") : null;
}

export async function importLimits(): Promise<{ maxRows: number; maxMb: number }> {
  return { maxRows: MAX_ROWS, maxMb: MAX_BYTES / 1024 / 1024 };
}
