import "server-only";
import { query, one } from "./db";
import {
  contactsInScope, accountsInScope, SET_ASIDE, bucket, setAsideWhere,
} from "./scope";
import { VIEW_FILTERS } from "./views";

/**
 * Search, running in the database.
 *
 * What this replaces: the whole contact list used to be published as a static
 * file, downloaded into every browser and searched there. That file could be
 * fetched by anyone who knew the address, because a file under public/ never
 * runs any of our code — no sign-in check could apply to it. Moving the search
 * here is what makes the data reachable only through a signed-in request.
 *
 * Two things it fixes at the same time:
 *  - the total is real. The old one capped candidates at 500 and then reported
 *    500 as the total, so a broad search said "showing 100 of 500" when there
 *    were three thousand, and the rest could not be reached at all.
 *  - a page is a page. The old one fetched, filtered and mapped every matching
 *    row and then displayed the first hundred.
 */

export interface ContactRow {
  id: string;
  name: string | null;
  jobTitle: string | null;
  email: string;
  company: string | null;
  companyId: string | null;
  segment: string;
  role: string | null;
  status: string | null;
  replied: boolean;
  countries: string[];
}

export interface AccountRow {
  id: string;
  name: string;
  domain: string | null;
  segment: string;
  type: string | null;
  contacts: number;
  reachable: boolean;
  countries: string[];
}

export interface Page<T> {
  rows: T[];
  /** The real number of matches, not the size of a capped candidate list. */
  total: number;
}

export type Filters = Record<string, string[]>;

/**
 * The one filter that is not a segment's own field: has this person ever
 * written back. It sits outside `Filters` on purpose — every one of those is
 * an enrichment value that only exists on one kind of counterparty, so leaving
 * a segment clears them. This one means the same thing on every tab and
 * survives the move between them.
 */
export type RepliedFilter = "yes" | "no" | null;

export interface SearchOptions {
  q?: string;
  segment?: string | null;
  filters?: Filters;
  replied?: RepliedFilter;
  limit?: number;
  offset?: number;
}

/**
 * Which database column each filter reads.
 *
 * `sector` and `commodity` are split apart at load time because the source
 * folds them into one string ("Mining — Gold"); `country_names` exists so a
 * person can filter by "Ghana" rather than "GH". Doing either in the query
 * would mean no index could be used.
 */
const FILTER_KEYS = [
  "country", "type", "sector", "commodity", "aum", "via", "invests_in", "stage", "project",
] as const;

/**
 * The four segments, flattened into one shape.
 *
 * `account_facets` is a view in the database that stitches whichever of the
 * four per-segment tables applies into a common set of column names. It lives
 * there rather than in a string here so that filtering a search and listing
 * the filter options cannot drift apart — they read the same definition.
 *
 * It also carries `view`: which of the SIX tabs a row is listed on, splitting
 * the investor segment into funds, family offices and individuals. That is
 * there for the same reason — one definition, so a search and the filter
 * counts beside it cannot disagree about who is on which tab. See views.ts.
 */
const FACET_JOIN = `left join account_facets af on af.hr_id = a.hr_id`;
const FACET_JOIN_C = `left join account_facets af on af.hr_id = c.account_id`;

/**
 * "Ever replied", in one definition.
 *
 * `contacts.replied` is five years of imported mailbox history: it says
 * whether this person ever wrote back before any of this existed. Everything
 * since is in `mail_events`, which the mail sync writes every five minutes and
 * which nothing folds back into that column. Reading the imported flag alone
 * therefore says "never replied" about somebody who answered last week.
 *
 * A join against the distinct inbound senders rather than an `exists` in the
 * select list: the total is a window function, so the select list is evaluated
 * for every matching row, not just the fifty on screen.
 */
export const REPLIED_JOIN = `left join (select distinct contact_id from mail_events where direction = 'in') mi
       on mi.contact_id = c.hr_id`;
export const EVER_REPLIED = `(c.replied or mi.contact_id is not null)`;

function buildFilters(filters: Filters, params: unknown[]): string {
  const clauses: string[] = [];
  for (const [key, values] of Object.entries(filters)) {
    if (!values?.length) continue;
    if (!(FILTER_KEYS as readonly string[]).includes(key)) continue; // never interpolated
    params.push(values);
    clauses.push(`af.f_${key} && $${params.length}::text[]`);
  }
  return clauses.join(" and ");
}

export async function searchContacts(opts: SearchOptions = {}): Promise<Page<ContactRow>> {
  const { q = "", segment = null, filters = {}, replied = null, limit = 100, offset = 0 } = opts;
  const params: unknown[] = [];
  const where: string[] = [];

  /* A named tab still has to be one we work, and still hides dead addresses —
     otherwise /contacts?segment=Investors would show the 2,070 bouncing
     investors the deliverability workbook set aside.

     Matched on the TAB, not the segment: Investors, Family Offices and High Net
     Worth are one segment underneath, told apart by how the research typed the
     firm. `coalesce` because a contact with no account has no tab of its own
     and belongs under its own segment rather than nowhere. */
  if (segment) { params.push(segment); where.push(`c.segment = $${params.length}`); }
  where.push(contactsInScope("c"));

  const term = q.trim();
  /* Where the search term sits in the parameter list, remembered rather than
     counted backwards from the end. The sort below used to say "third from
     last", counting back past limit and offset — which is the search term only
     when nothing was added in between. Search for a word AND tick a filter and
     it pointed at the filter's list of values instead, and the whole page
     returned a server error. */
  let likeAt = 0;
  if (term) {
    params.push(`%${term.toLowerCase()}%`);
    likeAt = params.length;
    const like = `$${params.length}`;
    /* One column, one index. It already holds the name, every address this
       person owns, their job title, their company and their domain — so this
       finds someone by an address they stopped using years ago, which the old
       search could not do at all. Five OR'd conditions and a subquery across
       53,829 addresses took 500ms; this takes about 100. */
    where.push(`c.search_text ilike ${like}`);
  }

  const filterSql = buildFilters(filters, params);
  if (filterSql) where.push(filterSql);

  if (replied === "yes") where.push(EVER_REPLIED);
  else if (replied === "no") where.push(`not ${EVER_REPLIED}`);

  params.push(limit, offset);
  const rows = await query<ContactRow & { total: string }>(
    `select c.hr_id as id, c.full_name as name, c.job_title as "jobTitle", c.email,
            a.name as company, c.account_id as "companyId",
            c.segment, c.role,
            c.best_email_status as status, ${EVER_REPLIED} as replied, c.country_names as countries,
            count(*) over() as total
     from contacts c
     left join accounts a on a.hr_id = c.account_id
     ${REPLIED_JOIN}
     ${filterSql ? FACET_JOIN_C : ""}
     where ${where.join(" and ")}
     order by ${term ? `(c.full_name ilike $${likeAt}) desc,` : ""} c.full_name nulls last, c.hr_id
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { rows: rows.map((r) => { const { total, ...rest } = r; void total; return rest; }), total: rows.length ? Number(rows[0].total) : 0 };
}

export async function searchAccounts(opts: SearchOptions = {}): Promise<Page<AccountRow>> {
  const { q = "", segment = null, filters = {}, limit = 100, offset = 0 } = opts;
  const params: unknown[] = [];
  const where: string[] = [];

  /* The TAB, not the segment — see searchContacts above. */
  if (segment) { params.push(segment); where.push(`a.segment = $${params.length}`); }
  where.push(accountsInScope("a"));

  const term = q.trim();
  if (term) {
    params.push(`%${term.toLowerCase()}%`);
    where.push(`a.search_text ilike $${params.length}`);
  }

  const filterSql = buildFilters(filters, params);
  if (filterSql) where.push(filterSql);

  params.push(limit, offset);
  const rows = await query<AccountRow & { total: string }>(
    `select a.hr_id as id, a.name, a.domain,
            a.segment, a.type,
            a.contact_count as contacts, a.reachable_contact as reachable,
            a.country_names as countries, count(*) over() as total
     from accounts a
     ${filterSql ? FACET_JOIN : ""}
     where ${where.join(" and ")}
     order by a.name, a.hr_id
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { rows: rows.map((r) => { const { total, ...rest } = r; void total; return rest; }), total: rows.length ? Number(rows[0].total) : 0 };
}

/**
 * How many contacts and accounts sit on each TAB. Shown on the cards.
 *
 * Counted the same way the searches filter, so the number on a card and the
 * number of rows behind it are the same number — the mistake that put account
 * totals on the contacts page once already.
 */
export async function segmentCounts() {
  const [c, a] = await Promise.all([
    query<{ segment: string; n: string }>(
      `select c.segment, count(*) n
       from contacts c
       where ${contactsInScope("c")} group by 1`),
    query<{ segment: string; n: string }>(
      `select a.segment, count(*) n
       from accounts a
       where ${accountsInScope("a")} group by 1`),
  ]);
  const toMap = (rows: { segment: string; n: string }[]) =>
    Object.fromEntries(rows.map((r) => [r.segment, Number(r.n)]));
  return { contacts: toMap(c), accounts: toMap(a) };
}

export interface FacetFilter {
  key: string;
  label: string;
  /** How many rows in the segment hold this field at all. */
  have: number;
  options: { value: string; n: number }[];
}

/**
 * Filters whose options have a natural order, which is not the popular one.
 *
 * Everything else is listed commonest first, which is what you want for a
 * country or an investor type. A SIZE BAND IS DIFFERENT: read biggest-bucket
 * first it becomes a puzzle, because the reader has to sort five overlapping
 * money ranges in their head before they can pick one. Ordered small to large
 * it is a scale.
 */
const ORDERED: Record<string, string[]> = {
  aum: ["Under $100m", "$100m - $1bn", "$1bn - $10bn", "$10bn - $100bn", "$100bn+"],
};

/**
 * The filter options for a segment, counted from the data.
 *
 * COUNTED IN WHATEVER THE PAGE IS LISTING. The contacts page used to read the
 * account numbers — "Australia 431" meant 431 Australian firms and ticking it
 * returned the 1,205 people who work at them. A filter whose number disagrees
 * with its own result is worse than one with no number at all, because the
 * number is what a person plans around.
 *
 * `have` is not decoration either. Filtering on AUM returns a short list, and
 * without knowing that only half the segment has a figure recorded, a person
 * reads that as "there are few big investors" rather than "most were set aside
 * for having nothing on file". The filter bar shows the shortfall.
 */
export async function facetOptions(
  segment: string,
  kind: "contacts" | "accounts" = "accounts",
): Promise<{ total: number; filters: FacetFilter[] } | null> {
  const defs = VIEW_FILTERS[segment];
  if (!defs) return null;

  /* Read from materialised views, refreshed when data is loaded. Counting
     these live took 1.7 seconds — acceptable for a report, far too slow for
     something that renders on every page load. */
  const countsView = kind === "contacts" ? "contact_facet_counts" : "facet_counts";
  const coverageView = kind === "contacts" ? "contact_facet_coverage" : "facet_coverage";
  const [counts, coverage] = await Promise.all([
    query<{ key: string; value: string; n: number }>(
      `select key, value, n from ${countsView} where segment = $1 order by n desc, value`, [segment]),
    query<{ key: string; have: number; segment_total: number }>(
      `select key, have, segment_total from ${coverageView} where segment = $1`, [segment]),
  ]);

  const total = coverage[0]?.segment_total ?? 0;
  const haveBy = new Map(coverage.map((c) => [c.key, c.have]));
  const optionsBy = new Map<string, { value: string; n: number }[]>();
  for (const c of counts) {
    if (!optionsBy.has(c.key)) optionsBy.set(c.key, []);
    optionsBy.get(c.key)!.push({ value: c.value, n: Number(c.n) });
  }

  /* A value the ORDERED list does not name keeps its place at the end rather
     than disappearing — a band renamed in the data must still be pickable. */
  for (const [key, order] of Object.entries(ORDERED)) {
    const opts = optionsBy.get(key);
    if (!opts) continue;
    const rank = (v: string) => { const i = order.indexOf(v); return i === -1 ? order.length : i; };
    opts.sort((a, b) => rank(a.value) - rank(b.value) || b.n - a.n);
  }

  const filters = defs
    .map((d) => ({
      key: d.key,
      label: d.label,
      have: Number(haveBy.get(d.key) ?? 0),
      options: optionsBy.get(d.key) ?? [],
    }))
    .filter((f) => f.options.length > 0);

  return { total, filters };
}

/* ── The set-aside side: exclusions, bad emails and pending ──────────────── */

/**
 * The same search, over the people the CRM does not work.
 *
 * A separate function rather than a flag on `searchContacts`, on purpose: that
 * one is what feeds drafting and deal-building, and a boolean able to switch
 * its scope off is one mistaken argument away from emailing a newsletter
 * address. The two never share a code path.
 *
 * No filters. The facets exist for enrichment nobody has done here — an AUM
 * band on a bouncing address is not a question anyone asks.
 */
/**
 * Sort by the name with its leading punctuation ignored.
 *
 * Exclusions are full of system mailboxes whose display name starts with a
 * symbol — "_- Voice Message System -_", ". Quarantine . Report .", "-Portal-"
 * — and a plain alphabetical sort puts every one of them on page one. The list
 * then looks broken rather than looking like what it is. Sorting on the
 * letters puts them where they belong, among the Vs and Qs and Ps.
 */
const SORT_NAME = `nullif(regexp_replace(c.full_name, '^[^[:alnum:]]+', ''), '') nulls last`;

export async function searchSetAside(
  opts: { q?: string; bucket?: string | null; limit?: number; offset?: number } = {},
): Promise<Page<ContactRow>> {
  const { q = "", bucket: bucketId = null, limit = 100, offset = 0 } = opts;
  const b = bucketId ? bucket(bucketId) : null;
  const params: unknown[] = [];
  const where: string[] = [b ? b.where("c") : setAsideWhere("c")];

  const term = q.trim();
  if (term) {
    params.push(`%${term.toLowerCase()}%`);
    where.push(`c.search_text ilike $${params.length}`);
  }

  params.push(limit, offset);
  const rows = await query<ContactRow & { total: string }>(
    `select c.hr_id as id, c.full_name as name, c.job_title as "jobTitle", c.email,
            a.name as company, c.account_id as "companyId",
            c.segment, c.role,
            c.best_email_status as status, c.replied, c.country_names as countries,
            count(*) over() as total
     from contacts c
     left join accounts a on a.hr_id = c.account_id
     where ${where.join(" and ")}
     order by ${term ? `(c.full_name ilike $${params.length - 2}) desc,` : ""} ${SORT_NAME}, c.hr_id
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return {
    rows: rows.map((r) => { const { total, ...rest } = r; void total; return rest; }),
    total: rows.length ? Number(rows[0].total) : 0,
  };
}

/** How many people sit in each set-aside bucket. Shown on the three cards. */
export async function setAsideCounts(): Promise<Record<string, number>> {
  const r = await one<Record<string, string>>(
    `select ${SET_ASIDE.map((b) => `count(*) filter (where ${b.where("c")}) as "${b.id}"`).join(", ")}
     from contacts c`);
  return Object.fromEntries(SET_ASIDE.map((b) => [b.id, Number(r?.[b.id] ?? 0)]));
}
