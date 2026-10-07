/**
 * Who the CRM actually works with.
 *
 * The master list this database was loaded from holds everybody Halden Ridge has ever
 * corresponded with — 49,000 people — and three groups of them are set aside
 * rather than browsed (client, 2026-08-26):
 *
 *  - EXCLUDED    consumer vendors, newsletters, role mailboxes, Halden Ridge's own staff
 *  - PENDING     people nobody has managed to identify
 *  - BAD EMAILS  people whose best address was verified and bounces
 *
 * The first two are a segment on the row. The third is not — it is a property
 * of the ADDRESS, and it was the one this database lost: the deliverability
 * workbook puts a bouncing investor on its Bad Emails tab, but the master list
 * this was loaded from files them back under Investors, so the CRM was showing
 * 11,370 investors where the signed-off deliverable shows 9,300. Every one of
 * that difference is somebody whose email comes straight back.
 *
 * Set aside, NOT deleted. They are still in the database, still reachable by a
 * direct link to their record, and still counted by anything asking about the
 * whole set — they are simply not offered in a list, a search, or a draft.
 *
 * ⚠️ "invalid" is the test, never "not deliverable". An address nobody has
 * tested yet is UNKNOWN, not dead, and filing it as dead is a mistake this
 * project has already made once — new contacts arrive untested, and treating
 * them as bad would quietly bury everybody added from here on.
 */

/**
 * The six segments Halden Ridge works. Excluded and Pending are deliberately absent.
 *
 * FAMILY OFFICES AND HIGH NET WORTH ARE SEGMENTS IN THEIR OWN RIGHT, not a way
 * of listing investors (client, 2026-08-28). They are approached as a separate
 * kind of counterparty and written to separately, and there is not enough on
 * file about them to tier them against a raise — so they must NOT be swept up
 * when a deal looks for investors. `tierFirms` asks for the investor segment
 * and now correctly gets funds only.
 *
 * A family office is still enriched as an investor: its type, what it backs and
 * any fund size live in `account_investor` exactly as before, and the record
 * page reads them. Only what it IS has changed. See INVESTOR_SEGMENTS below.
 */
export const WORKING_SEGMENTS = [
  "Investors",
  "Family Offices",
  "High Net Worth",
  "Intermediaries",
  "Business",
  "Government/Strategic",
] as const;

/**
 * The segments whose enrichment lives in `account_investor`.
 *
 * A family office has an investor type, an AUM band and a list of what it
 * backs; so does a wealthy individual. Anything reading those fields must ask
 * this rather than test for "Investors", or a family office's record page goes
 * blank the moment it stops being filed as an investor.
 */
export const INVESTOR_SEGMENTS = ["Investors", "Family Offices", "High Net Worth"] as const;

export function isInvestorSegment(segment: string): boolean {
  return (INVESTOR_SEGMENTS as readonly string[]).includes(segment);
}

const SEGMENT_LIST = WORKING_SEGMENTS.map((s) => `'${s}'`).join(", ");

/** People the CRM lists, searches and can email. */
export function contactsInScope(alias = "c"): string {
  return `${alias}.segment in (${SEGMENT_LIST})
      and ${alias}.best_email_status is distinct from 'invalid'`;
}

/** Companies the CRM lists and searches. */
export function accountsInScope(alias = "a"): string {
  return `${alias}.segment in (${SEGMENT_LIST})`;
}

/* ── The other side of the line ──────────────────────────────────────────── */

/**
 * The three groups set aside, as Halden Ridge refers to them (client, 2026-08-26).
 *
 * They are shown on their own page, read-only. Nobody is emailed from here and
 * nothing here reaches a deal — `resolveSelection` scopes every selection, so
 * that is enforced in the database rather than by hiding a button.
 *
 * ⚠️ THEY MUST NOT OVERLAP, and together they must be exactly everybody
 * `contactsInScope` leaves out — otherwise a person appears twice, or vanishes
 * from both sides and nobody notices. The four counts (in scope + exclusions + bad emails + pending) must sum
 *   to every contact in the database.
 * `scripts/check-buckets.mjs` re-runs that sum; run it after any change here.
 *
 * Segment wins over address, which is why a dead address inside Pending stays
 * in Pending rather than moving to Bad emails: "we could not work out who this
 * is" is a different problem from "we know who it is and cannot reach them",
 * and the second is the one worth spending money on.
 */
export const SET_ASIDE = [
  {
    id: "pending",
    label: "Pending",
    blurb: "Identified far enough to keep, not far enough to place.",
    where: (a = "c") => `${a}.segment = 'Pending'`,
  },
  {
    id: "bad-emails",
    label: "Bad emails",
    blurb: "A real counterparty whose best address bounces.",
    where: (a = "c") =>
      `${a}.segment in (${SEGMENT_LIST}) and ${a}.best_email_status = 'invalid'`,
  },
  {
    id: "exclusions",
    label: "Exclusions",
    blurb: "Newsletters, vendors, role mailboxes and Halden Ridge's own people.",
    where: (a = "c") => `${a}.segment = 'Excluded'`,
  },
] as const;

export type BucketId = (typeof SET_ASIDE)[number]["id"];

export function bucket(id: string) {
  return SET_ASIDE.find((b) => b.id === id) ?? null;
}

/** Everybody on the set-aside side of the line, whichever bucket they are in. */
export function setAsideWhere(alias = "c"): string {
  return `(${SET_ASIDE.map((b) => b.where(alias)).join(" or ")})`;
}

/**
 * Is THIS person set aside? The same test as the queries above, applied to a
 * row already fetched — used by a record page to decide where "back" goes and
 * whether to offer actions that would be refused anyway.
 */
export function isSetAside(p: { segment: string; status?: string | null }): boolean {
  if (p.segment === "Excluded" || p.segment === "Pending") return true;
  return p.status === "invalid";
}
