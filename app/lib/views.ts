import "server-only";

/**
 * The six tabs the Accounts and Contacts pages offer — which are simply the six
 * segments.
 *
 * There is no derivation here any more. Family Offices and High Net Worth were
 * briefly a way of LISTING investors while investors they remained; the client
 * settled it on 2026-08-28 the other way. They are separate kinds of
 * counterparty, written to separately, and there is not enough on file about
 * them to tier them against a raise — so a deal looking for investors must not
 * pick them up, and the only way to guarantee that is for them not to be
 * investors.
 *
 * What this file does now is name the tabs, order them, and say which filters
 * each offers. Which segment a row is in is a fact on the row.
 *
 * ⚠️ Their enrichment did NOT move. A family office still has an investor type,
 * a fund size and a list of what it backs, all in `account_investor` — see
 * INVESTOR_SEGMENTS in scope.ts. Anything reading those fields must ask that,
 * never test for "Investors".
 */

export interface ViewDef {
  /** What goes in the address bar, and what `account_facets.view` holds. */
  id: string;
  label: string;
  blurb: string;
}

/**
 * In the order they appear: two rows of three.
 *
 * The row break is not decoration. The top row is the three kinds of buyer — a
 * fund, a family, a person — and the bottom row is everybody else. That is how
 * Halden Ridge reads the list, so it is how the list is arranged.
 */
export const VIEWS: ViewDef[] = [
  { id: "Investors", label: "Investors", blurb: "Funds and institutions that write cheques. The list a deal is matched against." },
  { id: "Family Offices", label: "Family Offices", blurb: "One family's money, run by its own office." },
  { id: "High Net Worth", label: "High Net Worth Investors", blurb: "Individuals investing their own money." },
  { id: "Business", label: "Businesses", blurb: "Mining and energy companies — the counterparties raising capital." },
  { id: "Government/Strategic", label: "Government", blurb: "Ministries, agencies and state-backed bodies." },
  { id: "Intermediaries", label: "Intermediaries", blurb: "Brokers, lawyers and advisers who open doors." },
];

const BY_ID = new Map(VIEWS.map((v) => [v.id, v]));

/** A view id from the address bar, or null if it is not one of ours. */
export function viewOf(raw: unknown): string | null {
  return typeof raw === "string" && BY_ID.has(raw) ? raw : null;
}

export function labelFor(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

/**
 * Which filters each tab offers, in the order they appear.
 *
 * The three investor segments offer the same filters, because all three are
 * enriched into the same table. The AUM filter is left in place on all of them
 * rather than hidden: a family office having no registered fund size is a fact
 * worth being able to see, not a filter worth removing.
 */
const INVESTOR_FILTERS = [
  { key: "type", label: "Investor type" },
  { key: "sector", label: "Invests in" },
  { key: "commodity", label: "Commodity" },
  { key: "aum", label: "AUM" },
  { key: "via", label: "Investment type" },
  { key: "invests_in", label: "Invests in country" },
  { key: "country", label: "Based in" },
];

export const VIEW_FILTERS: Record<string, { key: string; label: string }[]> = {
  Investors: INVESTOR_FILTERS,
  "Family Offices": INVESTOR_FILTERS,
  "High Net Worth": INVESTOR_FILTERS,
  Intermediaries: [
    { key: "type", label: "Intermediary type" },
    { key: "sector", label: "Sector focus" },
    { key: "commodity", label: "Commodity" },
    { key: "country", label: "Based in" },
  ],
  Business: [
    { key: "type", label: "Industry" },
    { key: "commodity", label: "Commodity" },
    { key: "stage", label: "Stage" },
    { key: "project", label: "Project country" },
    { key: "country", label: "Based in" },
  ],
  "Government/Strategic": [
    { key: "type", label: "Entity kind" },
    { key: "sector", label: "Mandate" },
    { key: "country", label: "Jurisdiction" },
  ],
};
