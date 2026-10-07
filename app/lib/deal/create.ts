import "server-only";
import { randomUUID } from "node:crypto";
import { query, one } from "../db";
import { extractDocument, UnreadableDocument } from "./extract";
import { draftFromDocuments, DraftFailed, type SourceDoc } from "./draft";
import { buildTeaser } from "./teaser-store";
import { nextDealName, sameCompany } from "./naming";

/**
 * A document goes in, a deal comes out.
 *
 * Ordered so that nothing is written until the write-up exists. A row created
 * first and drafted second leaves a half-made deal on the list whenever the
 * drafting step fails, and somebody then emails investors from it.
 */

export const ACCEPTED = [".pdf", ".ppt", ".pptx", ".doc", ".docx"];
export const MAX_BYTES = 25 * 1024 * 1024;

export interface CreateResult {
  ok: boolean;
  reference?: string;
  title?: string;
  gaps?: string[];
  message: string;
}

/** A short readable id for the URL: the name, plus enough randomness to be unique. */
function referenceFor(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${slug || "deal"}-${randomUUID().slice(0, 6)}`;
}

/**
 * Match the raise to a company we already hold, so the deal page can link to it.
 *
 * Exact web address only. A name match would put the wrong company on a deal —
 * the research side learned that the expensive way, and a deal is a worse place
 * to learn it again than a spreadsheet row.
 */
async function accountForWebsite(website: string): Promise<string | null> {
  const d = website.toLowerCase().replace(/^www\./, "").trim();
  if (!d || !d.includes(".")) return null;
  const r = await one<{ hr_id: string }>(
    `select hr_id from accounts where lower(domain) in ($1, $2) limit 1`, [d, `www.${d}`]);
  return r?.hr_id ?? null;
}

/**
 * The deals we already hold for this same company.
 *
 * Halden Ridge raises for a company more than once, and a second raise is a different
 * deal rather than a correction of the first. Without this, both rows read
 * "Arkveld Zero" and nobody could tell which one an email went from.
 *
 * A deal counts as the same company on ANY of three signals, because a deck
 * that carries one often carries neither of the others:
 *   the matched company record — strongest, itself matched on exact web address
 *   the exact web address      — normalised for www and trailing slash
 *   the normalised name        — legal suffixes and punctuation removed
 *
 * THE NAME MATCH IS JOHN'S EXPLICIT CHOICE (2026-09-02), made knowing that two
 * different firms with similar names could be numbered as one. It is far lower
 * harm here than on the research side: the number is a visible label on a list
 * rather than a figure buried in a record, and the upload message names the
 * deal it matched, so a wrong match is seen while the person is still standing
 * there. Names are compared EXACTLY after normalising — nothing fuzzy.
 */
async function siblingDeals(
  title: string, website: string | null, accountId: string | null,
): Promise<{ title: string }[]> {
  const site = (website ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").trim();

  /* Every deal's name and address, which is all this needs. Three deals today
     and a few hundred at worst — the alternative is three round trips and a
     name comparison SQL cannot do the same way the module does. */
  const rows = await query<{ title: string; website: string | null; company_id: string | null }>(
    `select title, website, company_id from deals`);

  return rows.filter((r) => {
    if (accountId && r.company_id === accountId) return true;
    if (site) {
      const theirs = (r.website ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").trim();
      if (theirs && theirs === site) return true;
    }
    return sameCompany(title, r.title);
  });
}

/**
 * Several files, one deal.
 *
 * A raise arrives as a deck AND a term sheet AND sometimes a resource statement.
 * They are read together and drafted in one pass, because the raise amount is in
 * one and the project detail is in another — drafting them separately produces
 * two half-written deals nobody can merge.
 */
export async function createDealFromDocuments(
  files: { name: string; size: number; buffer: ArrayBuffer; path?: string; contentType?: string }[],
  user: string,
): Promise<CreateResult> {
  if (!files.length) return { ok: false, message: "No file was attached." };
  if (files.length > 8) return { ok: false, message: "Eight files at once is the limit. Upload the main ones and add the rest to the deal afterwards." };

  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_BYTES)
    return { ok: false, message: `Those files come to ${(total / 1024 / 1024).toFixed(0)}MB together. The limit is 25MB — export a lighter PDF or send fewer.` };

  for (const file of files) {
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ACCEPTED.includes(ext))
      return { ok: false, message: `${file.name}: ${ext} is not a format this reads. Send a PDF, a PowerPoint or a Word file.` };
    if (file.size === 0) return { ok: false, message: `${file.name} is empty.` };
  }

  const docs: SourceDoc[] = [];
  for (const file of files) {
    try {
      const got = await extractDocument(file);
      docs.push({
        name: file.name,
        text: got.text,
        /* Only a PDF can be handed over as a file, and only when there was no
           text to pull out of it. */
        vision: got.needsVision ? file.buffer : undefined,
      });
    } catch (e) {
      /* Which file failed matters when five were sent. */
      if (e instanceof UnreadableDocument) return { ok: false, message: files.length > 1 ? `${file.name}: ${e.message}` : e.message };
      throw e;
    }
  }

  let draft;
  try {
    draft = await draftFromDocuments(docs);
  } catch (e) {
    if (e instanceof DraftFailed) return { ok: false, message: e.message };
    throw e;
  }

  const accountId = draft.website ? await accountForWebsite(draft.website) : null;

  /* A second raise for a company we have already raised for is named for it —
     "Arkveld Zero - Deal #2". Done HERE, at creation, and nowhere else: add.ts
     refuses to rename a deal when new documents arrive, because a live raise's
     link is already in sent email, and that reasoning holds just as well for a
     deal that has been on the list for a month. The first deal keeps its plain
     name for the same reason. */
  const siblings = await siblingDeals(draft.title, draft.website, accountId);
  const title = nextDealName(draft.title, siblings);
  const reference = referenceFor(title);

  const created = await query<{ id: string }>(
    `insert into deals
       (reference, title, company_id, summary, status, created_by,
        sector, countries, raising, valuation, stage, website, closing, highlights,
        document_name, document_text, written_at, draft_model, draft_gaps)
     values ($1,$2,$3,$4,'Live',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),$16,$17)
     returning id`,
    [reference, title, accountId, draft.summary, user,
     draft.sector, draft.countries, draft.raising, draft.valuation, draft.stage,
     draft.website, draft.closing, draft.highlights,
     files.map((f) => f.name).join("; "), draft.text, draft.model, draft.gaps],
  );

  /* The documents are KEPT and recorded, which is what lets the deck be
     attached when the CRM drafts the emails. A file that cannot be recorded
     does not fail the deal — the write-up is the valuable part and it is
     already saved; the person can re-upload. */
  const dealId = created[0]?.id;
  if (dealId) {
    for (const f of files.filter((f) => f.path)) {
      try {
        await query(
          `insert into deal_documents (deal_id, name, storage_path, content_type, bytes)
           values ($1,$2,$3,$4,$5)`,
          [dealId, f.name, f.path, f.contentType ?? null, f.size]);
      } catch (e) {
        console.error("deal created but its document could not be recorded", f.name, e);
      }
    }
  }

  /* The teaser, written from the same document text the write-up was checked
     against. AFTER the deal exists and deliberately NON-FATAL: the write-up is
     the valuable part and it is already saved, so a raise must not be reported
     as a failed upload because its two-pager could not be drafted. The deal
     page offers to draft it. */
  try {
    await buildTeaser(reference);
  } catch (e) {
    console.error("deal created but its teaser could not be drafted", reference, e);
  }

  /* A success says it succeeded and nothing else. The gaps used to be read out
     here, which turned every completed upload into a warning about a field the
     deck never mentioned — and the deal is right there to open and look at.
     A message is for something the person has to ACT on, and "it worked" plus a
     link is the whole action. The gaps are still stored on the deal.
     Failures are the opposite: every one of them says why. */
  /* When the deal was numbered, SAY SO AND SAY WHY. This is the whole safety
     net on matching by name: a deal wrongly read as a repeat of another company
     is visible in this message, while the person who uploaded it is still
     standing there, rather than being found weeks later on the list. */
  return {
    ok: true, reference, title, gaps: draft.gaps,
    message: siblings.length
      ? `${title} is drafted — ${draft.title} already has ${siblings.length === 1 ? "a deal" : `${siblings.length} deals`}.`
      : `${title} is drafted.`,
  };
}
