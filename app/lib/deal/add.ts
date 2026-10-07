import "server-only";
import { query, one } from "../db";
import { extractDocument, UnreadableDocument } from "./extract";
import { draftFromDocuments, DraftFailed, type SourceDoc } from "./draft";
import { ACCEPTED, MAX_BYTES } from "./create";
import { buildTeaser } from "./teaser-store";

/**
 * More documents arrive for a deal that already exists.
 *
 * A raise does not land in one go. The deck comes first, the term sheet a week
 * later, a resource statement after that — and until now the only way to get
 * the term sheet's numbers onto the deal was to upload the lot again as a
 * SECOND deal, which left two half-written raises on the list and no way to
 * tell which one the emails had gone from.
 *
 * THE THREE RULES THIS IS BUILT ON:
 *
 *  1. RE-DRAFT FROM EVERYTHING, not from the new file alone. The write-up has
 *     to reconcile the documents — the raise amount is in the term sheet and
 *     the project detail is in the deck — so the deal's existing text goes back
 *     into the drafting call alongside the new files, exactly the way several
 *     files uploaded together are already handled. Drafting the new file on its
 *     own would produce a write-up about a term sheet rather than about a raise.
 *
 *  2. NEW WINS, BLANK NEVER DOES. A field the new draft states replaces what
 *     was there — that is the whole point of adding a corrected term sheet. But
 *     a field it leaves empty KEEPS the value the deal already had. A draft can
 *     come back without re-quoting something it read perfectly well last time,
 *     and deleting a raise amount on that basis would be silent damage.
 *
 *  3. NOTHING CHANGES SILENTLY. Every field that moves is recorded in
 *     `deal_revisions` with its old and new value, and handed back so the
 *     person who uploaded sees it. A figure that has already gone out in an
 *     email must never change with nobody told.
 *
 * The deal keeps its name and its address. A re-draft can read a different
 * title off a term sheet, and renaming a live raise that colleagues have open —
 * and whose link is in sent email — is worse than a slightly stale name. The
 * new title is reported when it differs, and left to a person to act on.
 *
 * Matched Accounts needs nothing here: that list is recomputed from the deal's
 * own sector, minerals, countries and raise size every time it is opened, so it
 * follows this update by itself.
 */

/** One field the new documents moved. */
export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface AddResult {
  ok: boolean;
  reference?: string;
  title?: string;
  changes?: FieldChange[];
  gaps?: string[];
  /** Set when the new documents read as a different company name. */
  renamedTo?: string;
  message: string;
}

/** The fields a re-draft may move, and what to call them to a person. */
const FIELDS = [
  ["raising", "Raising"],
  ["valuation", "Valuation"],
  ["stage", "Stage"],
  ["sector", "Sector"],
  ["countries", "Countries"],
  ["closing", "Closing"],
  ["website", "Website"],
  ["summary", "Summary"],
] as const;

interface DealRow {
  id: string;
  reference: string;
  title: string;
  raising: string | null; valuation: string | null; stage: string | null;
  sector: string | null; countries: string | null; closing: string | null;
  website: string | null; summary: string | null;
  highlights: string[] | null;
  document_name: string | null;
  document_text: string | null;
  company_id: string | null;
}

/** Cap the text carried back into the drafting call. */
const MAX_CARRIED = 400_000;

/**
 * Match the raise to a company we hold, exact web address only.
 *
 * Repeated from `create` rather than shared, because it only fires here when
 * the deal has NO company yet — a new document naming a website is how an
 * unlinked deal acquires one. It never re-points a deal that is already linked:
 * a term sheet can name an adviser's site, and silently moving a live deal onto
 * a different company is the wrong-entity mistake this project has paid for.
 */
async function accountForWebsite(website: string): Promise<string | null> {
  const d = website.toLowerCase().replace(/^www\./, "").trim();
  if (!d || !d.includes(".")) return null;
  const r = await one<{ hr_id: string }>(
    `select hr_id from accounts where lower(domain) in ($1, $2) limit 1`, [d, `www.${d}`]);
  return r?.hr_id ?? null;
}

export async function addDocumentsToDeal(
  reference: string,
  files: { name: string; size: number; buffer: ArrayBuffer; path?: string; contentType?: string }[],
  user: string,
): Promise<AddResult> {
  if (!files.length) return { ok: false, message: "No file was attached." };
  if (files.length > 8) return { ok: false, message: "Eight files at once is the limit." };

  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_BYTES)
    return { ok: false, message: `Those files come to ${(total / 1024 / 1024).toFixed(0)}MB together. The limit is 25MB.` };

  for (const file of files) {
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ACCEPTED.includes(ext))
      return { ok: false, message: `${file.name}: ${ext} is not a format this reads. Send a PDF, a PowerPoint or a Word file.` };
    if (file.size === 0) return { ok: false, message: `${file.name} is empty.` };
  }

  const deal = await one<DealRow>(
    `select id, reference, title, raising, valuation, stage, sector, countries,
            closing, website, summary, highlights, document_name, document_text, company_id
     from deals where reference = $1`, [reference]);
  if (!deal) return { ok: false, message: "That deal no longer exists." };

  /* Read the new files. */
  const docs: SourceDoc[] = [];
  for (const file of files) {
    try {
      const got = await extractDocument(file);
      docs.push({ name: file.name, text: got.text, vision: got.needsVision ? file.buffer : undefined });
    } catch (e) {
      if (e instanceof UnreadableDocument)
        return { ok: false, message: files.length > 1 ? `${file.name}: ${e.message}` : e.message };
      throw e;
    }
  }

  /* The deal's existing text goes in FIRST, as one more source. That is what
     makes this a re-draft of the raise rather than a write-up of the newest
     file, and it is what lets a quote from the original deck still pass the
     evidence check. */
  const carried = (deal.document_text ?? "").slice(0, MAX_CARRIED);
  const all: SourceDoc[] = carried.trim()
    ? [{ name: deal.document_name || "the documents already on this deal", text: carried }, ...docs]
    : docs;

  let draft;
  try {
    draft = await draftFromDocuments(all);
  } catch (e) {
    if (e instanceof DraftFailed) return { ok: false, message: e.message };
    throw e;
  }

  /* Rule 2: new wins, blank keeps. Applied field by field so a change can be
     shown, rather than by writing the whole row and hoping. */
  const before: Record<string, string> = {
    raising: deal.raising ?? "", valuation: deal.valuation ?? "", stage: deal.stage ?? "",
    sector: deal.sector ?? "", countries: deal.countries ?? "", closing: deal.closing ?? "",
    website: deal.website ?? "", summary: deal.summary ?? "",
  };
  const drafted: Record<string, string> = {
    raising: draft.raising, valuation: draft.valuation, stage: draft.stage,
    sector: draft.sector, countries: draft.countries, closing: draft.closing,
    website: draft.website, summary: draft.summary,
  };

  const after: Record<string, string> = {};
  const changes: FieldChange[] = [];
  for (const [key, label] of FIELDS) {
    const next = drafted[key].trim() || before[key];
    after[key] = next;
    if (next !== before[key]) changes.push({ field: label, from: before[key], to: next });
  }

  /* Highlights are written prose about the documents, not quoted claims, so a
     re-draft over more material simply supersedes them — but an empty list
     still never wipes the ones already there. */
  const highlights = draft.highlights.length ? draft.highlights : (deal.highlights ?? []);
  if (draft.highlights.length && JSON.stringify(highlights) !== JSON.stringify(deal.highlights ?? []))
    changes.push({ field: "Highlights", from: `${(deal.highlights ?? []).length} bullets`, to: `${highlights.length} bullets` });

  /* A deal with no company can gain one. A deal that has one keeps it. */
  const companyId = deal.company_id ?? (after.website ? await accountForWebsite(after.website) : null);

  const names = [deal.document_name, ...files.map((f) => f.name)].filter(Boolean).join("; ");

  await query(
    `update deals set
       raising=$2, valuation=$3, stage=$4, sector=$5, countries=$6, closing=$7,
       website=$8, summary=$9, highlights=$10, company_id=$11,
       document_name=$12, document_text=$13, written_at=now(),
       draft_model=$14, draft_gaps=$15
     where id=$1`,
    [deal.id, after.raising, after.valuation, after.stage, after.sector, after.countries,
     after.closing, after.website, after.summary, highlights, companyId,
     names, draft.text, draft.model, draft.gaps]);

  /* The documents are recorded so they can be attached to an email, the same
     as the ones the deal started with. A file that cannot be recorded does not
     fail the update — the write-up is saved and the person can re-upload. */
  for (const f of files.filter((f) => f.path)) {
    try {
      await query(
        `insert into deal_documents (deal_id, name, storage_path, content_type, bytes)
         values ($1,$2,$3,$4,$5)`,
        [deal.id, f.name, f.path, f.contentType ?? null, f.size]);
    } catch (e) {
      console.error("deal updated but its document could not be recorded", f.name, e);
    }
  }

  /* Rule 3. Written even when nothing moved: "the term sheet added nothing we
     did not already have" is itself worth being able to look up. */
  try {
    await query(
      `insert into deal_revisions (deal_id, documents, changes, gaps, created_by)
       values ($1,$2,$3::jsonb,$4,$5)`,
      [deal.id, files.map((f) => f.name), JSON.stringify(changes), draft.gaps, user]);
  } catch (e) {
    console.error("deal updated but the revision could not be recorded", e);
  }

  /* Re-written, not left alone. A term sheet that moved the raise amount has
     moved it in the document Halden Ridge attaches to its emails too, and a teaser
     quoting last week's figure beside a deal page quoting this week's is
     exactly the silent disagreement rule 3 exists to prevent. Non-fatal, for
     the same reason as on the first upload. */
  try {
    await buildTeaser(deal.reference);
  } catch (e) {
    console.error("deal updated but its teaser could not be re-drafted", deal.reference, e);
  }

  const renamedTo = draft.title && draft.title !== deal.title ? draft.title : undefined;

  return {
    ok: true,
    reference: deal.reference,
    title: deal.title,
    changes,
    gaps: draft.gaps,
    renamedTo,
    message: changes.length === 0
      ? `${deal.title} is updated. Nothing in the write-up changed — the new ${files.length === 1 ? "document adds" : "documents add"} no figure it did not already have.`
      : `${deal.title} is updated. ${changes.length} ${changes.length === 1 ? "field" : "fields"} changed.`,
  };
}
