export type Segment =
  | "Investors"
  | "Family Offices"
  | "High Net Worth"
  | "Intermediaries"
  | "Business"
  | "Government/Strategic"
  | "Pending"
  | "Excluded";

export type EmailStatus = "deliverable" | "unknown" | "invalid" | "";

/**
 * The last time anyone at Halden Ridge emailed this person, and what came of it.
 *
 * Carried on the person, not the deal, because the question it answers is
 * "has someone already pitched them" — which has to be true across deals.
 * `replied` is the load-bearing part: re-contacting someone who answered is
 * normal, re-pitching someone who went quiet is the mistake worth catching.
 */
export interface LastContact {
  date: string;         // ISO. "" when they wrote to us and we never wrote first
  repliedDate: string;  // ISO. "" when they have not answered
  deal: string;         // "" when the email could not be tied to a raise
  dealId: string;       // ""  likewise
  sender: string;       // which mailbox it went out of
  replied: boolean;
}

/**
 * Whether a raise is still being worked.
 *
 * Two values, not four. `Closing` and `Closed` and `On hold` were in this type
 * for months and NOTHING EVER SET ANY OF THEM — every deal was created Live and
 * stayed there. A deal is either being worked or it is done; how far the
 * outreach has got is already the Contacts, Emailed and Replied counts, which
 * say it better than a word somebody has to remember to change.
 */
export type DealStatus = "Live" | "Complete";

/** One raise. The write-up mirrors how Halden Ridge actually describes a mandate. */
export interface Deal {
  id: string;
  name: string;
  status: DealStatus;
  raising: string;
  valuation: string;
  stage: string;
  sector: string;
  countries: string;
  website: string;
  deck: string;
  /** The account being raised for, when it is one we hold. */
  accountId: string | null;
  summary: string;
  highlights: string[];
  closing: string;
}

/**
 * Where one person stands on one deal.
 *
 * Strictly about THIS raise. There was a fifth value, "In touch", for a person
 * the mailbox showed email with since they joined the list but which nothing
 * tied to this deal. Dropped 2026-08-26: it answered a question nobody asked,
 * and "not contacted about this deal" is the truer reading of that person
 * anyway. What a person has going on elsewhere belongs on their own record.
 */
export type OutreachStatus = "Not contacted" | "Drafted" | "Sent" | "Replied";

export interface DealContact {
  contactId: string;
  status: OutreachStatus;
  date: string;
  sender: string;
}

/** Compact row shipped to the browser. Short keys — this goes over the wire. */
export interface ContactIndexRow {
  i: string; // hr_id
  n: string; // display name (or email, if none known)
  g: 0 | 1; // name was inferred from the address
  e: string; // best email
  j: string; // job title (not yet collected — empty for now)
  c: string; // company name
  a: string; // account hr_id ("" when the person has no company)
  d: string; // domain
  s: string; // segment
  r: string; // role
  k: string; // countries (display)
  kk: string; // countries, code + name (searchable)
  t: string; // type (investor type / industry / etc.)
  q: 0 | 1; // has replied
  v: string; // best email status
  z?: LastContact; // last outreach, absent if never contacted
  // Facets — present only where the row's segment has that field. See FILTERS
  // in scripts/build-index.mjs.
  ft?: string[]; // primary type (investor / intermediary / industry / entity kind)
  fo?: string[]; // sector or mandate focus
  fc?: string[]; // commodity
  fa?: string[]; // AUM band
  fv?: string[]; // investment type
  fi?: string[]; // countries they invest in
  fs?: string[]; // stage
  fp?: string[]; // operating countries
  fk?: string[]; // locations, as country names
}

export interface AccountIndexRow {
  i: string;
  n: string; // name
  d: string; // domain
  s: string; // segment
  t: string; // type
  k: string; // countries (display)
  kk: string; // countries, code + name (searchable)
  w: string; // website
  m: number; // contact count
  z?: LastContact; // most recent outreach to anyone at the firm
  r: 0 | 1; // has a reachable contact
  y: string; // investor type / industry
  ft?: string[];
  fo?: string[];
  fc?: string[];
  fa?: string[];
  fv?: string[];
  fi?: string[];
  fs?: string[];
  fp?: string[];
  fk?: string[];
}

/** One filter a segment offers, with every value and how many rows hold it. */
export interface FacetFilter {
  key: string;
  label: string;
  /** How many rows in the segment have this field at all. */
  have: number;
  options: { value: string; n: number }[];
}

export interface SegmentFacets {
  total: number;
  filters: FacetFilter[];
}

/** segment -> its filters. Built by scripts/build-index.mjs. */
export type FacetMap = Record<string, SegmentFacets>;

/** What the user has picked: filter key -> chosen values. */
export type Selected = Record<string, string[]>;

/** Does a row satisfy every active filter? A filter with no pick is inactive. */
export function matchesFilters(
  row: Record<string, unknown>,
  selected: Selected
): boolean {
  for (const [key, wanted] of Object.entries(selected)) {
    if (!wanted.length) continue;
    const held = row[key];
    if (!Array.isArray(held)) return false;
    // Within one filter the values are OR'd; across filters they are AND'd.
    if (!wanted.some((w) => (held as string[]).includes(w))) return false;
  }
  return true;
}

export type IndexKind = "contacts" | "accounts";

export interface Hit {
  kind: IndexKind;
  id: string;
  title: string;
  titleInferred: boolean;
  subtitle: string;
  /** Contacts only: the person's firm, and the account page it opens. */
  jobTitle?: string;
  company?: string;
  companyId?: string;
  segment: string;
  status: string;
  replied: boolean;
  lastContact?: LastContact;
  score: number;
  matched: string[];
}

/** Full record, served from the server on demand — never in the browser index. */
export interface Person {
  id: string;
  name: string;
  nameInferred: boolean;
  email: string;
  bestEmail: string;
  secondary: string;
  domain: string;
  companyId: string | null;
  companyName: string;
  segment: string;
  role: string;
  jobTitle: string;
  personLocation: string;
  replied: boolean;
  status: string;
  verified: boolean;
  owner: string;
  inMailchimp: boolean;
  countries: string;
  countriesDisplay: string;
  note: string;
  lastContact: LastContact | null;
  fields: Record<string, string>;
}

export interface Company {
  id: string;
  name: string;
  domain: string;
  segment: string;
  type: string;
  website: string;
  companyLinkedin: string;
  countries: string;
  countriesDisplay: string;
  contacts: number;
  reachable: boolean;
  noContact: boolean;
  owner: string;
  inMailchimp: string;
  note: string;
  lastContact: LastContact | null;
  fields: Record<string, string>;
}

export const SEGMENT_COLOR: Record<string, string> = {
  Investors: "var(--color-seg-investor)",
  /* The three investor segments share one colour. They are separate kinds of
     counterparty, approached separately, but they are all money that can be
     asked for — and the colour's job is to say which side of the business a
     record belongs to, which the chip's own words then narrow. */
  "Family Offices": "var(--color-seg-investor)",
  "High Net Worth": "var(--color-seg-investor)",
  Intermediaries: "var(--color-seg-intermediary)",
  Business: "var(--color-seg-business)",
  "Government/Strategic": "var(--color-seg-government)",
  Pending: "var(--color-seg-excluded)",
  Excluded: "var(--color-seg-excluded)",
};
