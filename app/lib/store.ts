import "server-only";
import { query, one } from "./db";
import type { Person, Company, Deal, DealContact, DealStatus, LastContact, OutreachStatus } from "./types";
import { contactsInScope, accountsInScope, setAsideWhere, isInvestorSegment } from "./scope";

/**
 * Single records, read from the database.
 *
 * This used to read three JSON files shipped with the app. Those files held
 * ten invented records, which was the right thing while the shape was being
 * agreed and the wrong thing the moment real people went in — the whole point
 * of the database is that nothing leaves the server that a signed-in request
 * did not ask for.
 *
 * Every function here is async now. That is not a style choice: a file read is
 * instant and a database is not, and pretending otherwise is how a page ends
 * up blocking on data it could have fetched alongside something else.
 */

/** The extra fields a segment carries, shaped for the record panels. */
async function fieldsForAccount(id: string, segment: string): Promise<Record<string, string>> {
  const j = (v: unknown) => (Array.isArray(v) ? v.filter(Boolean).join("; ") : v ? String(v) : "");
  /* Family offices and wealthy individuals are their own segments now, but
     their enrichment still lives in account_investor — a family office has an
     investor type, a fund size and a list of what it backs. Testing for
     "Investors" here would have emptied 741 record pages. */
  if (isInvestorSegment(segment)) {
    const r = await one<Record<string, unknown>>(`select * from account_investor where hr_id = $1`, [id]);
    if (!r) return {};
    return {
      "Investor Type": j(r.investor_type),
      "Invests In": j(r.invests_in),
      "Invests In Countries": j(r.invests_in_countries),
      "Invests Via": j(r.invests_via),
      "AUM Range": j(r.aum_range),
      // The sentence a figure came from travels with it. A number filed with a
      // regulator and one lifted off a marketing page look identical without it.
      "AUM Basis": j(r.aum_basis),
      "Cheque Size": j(r.cheque_size),
      "Cheque Size Basis": j(r.cheque_size_basis),
      "Holds Halden Ridge Companies": j(r.holds_hr_companies),
    };
  }
  if (segment === "Business") {
    const r = await one<Record<string, unknown>>(`select * from account_business where hr_id = $1`, [id]);
    if (!r) return {};
    return {
      Industry: j(r.industry), Commodity: j(r.commodity), "HQ City": j(r.hq_city),
      "Project Countries": j(r.project_countries), Ticker: j(r.ticker), Stage: j(r.stage),
      "Study Level": j(r.study_level), "Lead Project": j(r.lead_project),
      "Market Cap": j(r.market_cap), "Enterprise Value": j(r.enterprise_value), Cash: j(r.cash),
      "Cash Runway (mo)": j(r.cash_runway_months), Employees: j(r.employees),
      "Financials As Of": r.financials_as_of ? String(r.financials_as_of).slice(0, 10) : "",
      "Last Raise": j(r.last_raise), "Raise Type": j(r.raise_type),
    };
  }
  if (segment === "Intermediaries") {
    const r = await one<Record<string, unknown>>(`select * from account_intermediary where hr_id = $1`, [id]);
    return r ? { "Intermediary Type": j(r.intermediary_type), "Sector Focus": j(r.sector_focus) } : {};
  }
  if (segment === "Government/Strategic") {
    const r = await one<Record<string, unknown>>(`select * from account_government where hr_id = $1`, [id]);
    return r ? { "Entity Kind": j(r.entity_kind), "Mandate Focus": j(r.mandate_focus) } : {};
  }
  return {};
}

const clean = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ""));

export async function getContact(id: string): Promise<Person | null> {
  const r = await one<Record<string, unknown>>(
    `select c.*,
            a.name as company_name, a.segment as company_segment, ${LAST_CONTACT_COLS}
     from contacts c left join accounts a on a.hr_id = c.account_id
     ${lastContactJoin("c.hr_id")}
     where c.hr_id = $1`, [id]);
  if (!r) return null;

  const secondary = await query<{ email: string }>(
    `select email from contact_emails where contact_id = $1 and not is_primary order by email`, [id]);

  // A person's enrichment belongs to their firm, and only through the address
  // they actually use. Someone holding a government address as a leftover from
  // a job they left must not inherit that firm's details.
  const fields = r.account_id ? await fieldsForAccount(String(r.account_id), String(r.company_segment ?? "")) : {};

  return {
    id: String(r.hr_id),
    name: (r.full_name as string) ?? String(r.email),
    nameInferred: !r.full_name,
    email: String(r.email),
    bestEmail: (r.best_email as string) ?? String(r.email),
    secondary: secondary.map((s) => s.email).join("; "),
    domain: (r.domain as string) ?? "",
    companyId: (r.account_id as string) ?? null,
    companyName: (r.company_name as string) ?? "",
    segment: String(r.segment),
    role: (r.role as string) ?? "",
    jobTitle: (r.job_title as string) ?? "",
    personLocation: (r.person_location as string) ?? "",
    replied: everReplied(r),
    status: (r.best_email_status as string) ?? "",
    verified: Boolean(r.email_verified),
    owner: ((r.owner as string[]) ?? []).join(", "),
    inMailchimp: Boolean(r.in_mailchimp),
    countries: ((r.countries as string[]) ?? []).join("; "),
    countriesDisplay: ((r.country_names as string[]) ?? []).join(", "),
    note: (r.note as string) ?? "",
    lastContact: lastContactFrom(r),
    fields: clean(fields),
  };
}

export async function getAccount(id: string): Promise<Company | null> {
  const r = await one<Record<string, unknown>>(
    /* The company's version of lastContactJoin: anyone here, not one person.
       Same correction — read the mailbox, not the deal list. */
    `select a.*, ${LAST_CONTACT_COLS}
     from accounts a
     left join lateral (
       select max(me.occurred_at) filter (where me.direction = 'out') as sent_at,
              max(me.occurred_at) filter (where me.direction = 'in')  as reply_at,
              (array_agg(me.mailbox order by me.occurred_at desc)
                 filter (where me.direction = 'out'))[1]              as sender
       from mail_events me
       join contacts c on c.hr_id = me.contact_id
       where c.account_id = a.hr_id
     ) lc on true
     left join lateral (
       select d.title as deal_title, d.reference as deal_ref
       from deal_contacts dc
       join deals d on d.id = dc.deal_id
       join contacts c on c.hr_id = dc.contact_id
       where c.account_id = a.hr_id and dc.sent_at is not null
       order by dc.sent_at desc limit 1
     ) ld on true
     where a.hr_id = $1`, [id]);
  if (!r) return null;
  const fields = await fieldsForAccount(id, String(r.segment));
  return {
    id: String(r.hr_id),
    name: String(r.name),
    domain: (r.domain as string) ?? "",
    segment: String(r.segment),
    type: (r.type as string) ?? "",
    website: (r.website as string) ?? "",
    companyLinkedin: (r.company_linkedin as string) ?? "",
    countries: ((r.countries as string[]) ?? []).join("; "),
    countriesDisplay: ((r.country_names as string[]) ?? []).join(", "),
    contacts: Number(r.contact_count ?? 0),
    reachable: Boolean(r.reachable_contact),
    noContact: Boolean(r.no_contact),
    owner: ((r.owner as string[]) ?? []).join(", "),
    inMailchimp: (r.in_mailchimp as string) ?? "",
    note: (r.note as string) ?? "",
    lastContact: lastContactFrom(r),
    fields: clean(fields),
  };
}

/** The people at a firm, most reachable first. Ranked in SQL, not in memory. */
export async function getAccountContacts(companyId: string, limit?: number): Promise<Person[]> {
  const rows = await query<Record<string, unknown>>(
    `select c.hr_id, c.full_name, c.email, c.best_email, c.job_title, c.person_location,
            c.segment,
            c.role, c.replied, c.best_email_status, c.domain, c.country_names,
            ${LAST_CONTACT_COLS}
     from contacts c
     ${lastContactJoin("c.hr_id")}
     where c.account_id = $1 and ${contactsInScope("c")}
     order by
       case c.best_email_status when 'deliverable' then 0 when 'unknown' then 1 else 2 end,
       c.replied desc, c.full_name nulls last, c.hr_id
     ${limit ? `limit ${Number(limit)}` : ""}`,
    [companyId],
  );
  return rows.map((r) => ({
    id: String(r.hr_id),
    name: (r.full_name as string) ?? String(r.email),
    nameInferred: !r.full_name,
    email: String(r.email),
    bestEmail: (r.best_email as string) ?? String(r.email),
    secondary: "",
    domain: (r.domain as string) ?? "",
    companyId,
    companyName: "",
    segment: String(r.segment),
    role: (r.role as string) ?? "",
    jobTitle: (r.job_title as string) ?? "",
    personLocation: (r.person_location as string) ?? "",
    replied: everReplied(r),
    status: (r.best_email_status as string) ?? "",
    verified: false,
    owner: "",
    inMailchimp: false,
    countries: "",
    countriesDisplay: ((r.country_names as string[]) ?? []).join(", "),
    note: "",
    lastContact: lastContactFrom(r),
    fields: {},
  }));
}

/**
 * Several people at once, by hr_id.
 *
 * One round trip for a whole deal's recipient list. The company name is joined
 * in here rather than left blank: on a deal page the firm is the column people
 * scan, and a per-row lookup for it is how a 300-person deal makes 300 queries.
 */
export async function getPeople(ids: string[]): Promise<Person[]> {
  if (!ids.length) return [];
  const rows = await query<Record<string, unknown>>(
    `select c.hr_id, c.full_name, c.email, c.best_email, c.job_title, c.person_location,
            c.segment,
            c.role, c.replied, c.best_email_status, c.domain, c.country_names,
            c.account_id, a.name as company_name, ${LAST_CONTACT_COLS}
     from contacts c
     left join accounts a on a.hr_id = c.account_id
     ${lastContactJoin("c.hr_id")}
     where c.hr_id = any($1::text[])`,
    [ids],
  );
  return rows.map((r) => ({
    id: String(r.hr_id),
    name: (r.full_name as string) ?? String(r.email),
    nameInferred: !r.full_name,
    email: String(r.email),
    bestEmail: (r.best_email as string) ?? String(r.email),
    secondary: "",
    domain: (r.domain as string) ?? "",
    companyId: (r.account_id as string) ?? null,
    companyName: (r.company_name as string) ?? "",
    segment: String(r.segment),
    role: (r.role as string) ?? "",
    jobTitle: (r.job_title as string) ?? "",
    personLocation: (r.person_location as string) ?? "",
    replied: everReplied(r),
    status: (r.best_email_status as string) ?? "",
    verified: false,
    owner: "",
    inMailchimp: false,
    countries: "",
    countriesDisplay: ((r.country_names as string[]) ?? []).join(", "),
    note: "",
    lastContact: lastContactFrom(r),
    fields: {},
  }));
}

export async function countAccountContacts(companyId: string): Promise<number> {
  const r = await one<{ n: string }>(
    `select count(*) n from contacts c where c.account_id = $1 and ${contactsInScope("c")}`, [companyId]);
  return Number(r?.n ?? 0);
}

/**
 * The last time anyone at Halden Ridge emailed this person, and whether they answered.
 *
 * READ FROM THE MAILBOX, NOT FROM THE DEAL LIST. This used to ask "was this
 * person marked as emailed on a deal", which is a much narrower question and
 * came back empty for almost everybody: an email only counted if the sync
 * could work out which raise it was about, and most email is not about a raise
 * at all. Eight days of live mail covered 704 people while these pages showed
 * one.
 *
 * `mail_events` is the ledger of what actually went in and out of the four
 * mailboxes, so it answers the question the pages are really asking. The deal
 * is looked up separately and is allowed to be absent — "we emailed them, we
 * cannot tell you which raise it was about" is a true answer and a useful one.
 *
 * A reply is an inbound message AFTER the last one we sent. An earlier inbound
 * is them writing to us first, which is not a reply to anything.
 *
 * A function, not a constant: it is interpolated twice and
 * `String.replace(string, …)` only ever replaces the first match, so a
 * constant with two placeholders would silently produce broken SQL.
 */
export function lastContactJoin(id: string): string {
  return `
  left join lateral (
    select max(occurred_at) filter (where direction = 'out') as sent_at,
           max(occurred_at) filter (where direction = 'in')  as reply_at,
           (array_agg(mailbox order by occurred_at desc)
              filter (where direction = 'out'))[1]           as sender
    from mail_events me where me.contact_id = ${id}
  ) lc on true
  left join lateral (
    select d.title as deal_title, d.reference as deal_ref
    from deal_contacts dc join deals d on d.id = dc.deal_id
    where dc.contact_id = ${id} and dc.sent_at is not null
    order by dc.sent_at desc limit 1
  ) ld on true`;
}

export const LAST_CONTACT_COLS = `lc.sent_at, lc.reply_at, lc.sender as lc_sender,
       ld.deal_title, ld.deal_ref`;

/**
 * A timestamp as the plain `YYYY-MM-DD` the UI formats, or "" for nothing.
 *
 * Every date column comes back from Postgres as a Date object. `formatDate`
 * takes a date string and, given anything else, hands its argument straight
 * back — so an unconverted Date reached React and broke the whole page. One
 * conversion, at the point the value leaves the database.
 */
export function day(v: Date | string | null | undefined): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * Ever replied, everywhere it is shown.
 *
 * `contacts.replied` is the imported mailbox history and stops at the load;
 * anything since is in `mail_events`, which the mail sync writes and which
 * nothing folds back into that column. Reading only the flag tells somebody
 * "never replied" about a person who answered last week. `reply_at` is the
 * most recent inbound message and is already joined in for the last-contact
 * line beside it.
 *
 * NB this is not `LastContact.replied`, which is narrower: that one asks
 * whether they answered the LAST thing we sent.
 */
export function everReplied(r: Record<string, unknown>): boolean {
  return Boolean(r.replied) || !!r.reply_at;
}

export function lastContactFrom(r: Record<string, unknown>): LastContact | null {
  const outAt = r.sent_at ? new Date(r.sent_at as string) : null;
  const inAt = r.reply_at ? new Date(r.reply_at as string) : null;
  /* Somebody who has only ever written TO us has no last-contact date but is
     not "never contacted" either — that shows as a reply with no send. */
  if (!outAt && !inAt) return null;
  /* Compared to the MINUTE, not the day. A message that came in at 15:59 and
     one we sent at 16:07 fall on the same date, and rounding to days made us
     answering them read as them answering us. */
  const answered = !!inAt && (!outAt || inAt.getTime() >= outAt.getTime());
  return {
    date: day(outAt),
    repliedDate: answered ? day(inAt) : "",
    deal: (r.deal_title as string) ?? "",
    dealId: (r.deal_ref as string) ?? "",
    sender: (r.lc_sender as string) ?? "",
    replied: answered,
  };
}

/** The numbers on the landing page. */
export async function stats() {
  const r = await one<{ people: string; companies: string; deals: string; outreach: string; setAside: string }>(
    `select (select count(*) from contacts c where ${contactsInScope("c")}) people,
            (select count(*) from accounts a where ${accountsInScope("a")}) companies,
            (select count(*) from deals) deals,
            (select count(*) from deal_contacts where sent_at is not null) outreach,
            (select count(*) from contacts c where ${setAsideWhere("c")}) "setAside"`);
  return {
    people: Number(r?.people ?? 0),
    companies: Number(r?.companies ?? 0),
    deals: Number(r?.deals ?? 0),
    outreach: Number(r?.outreach ?? 0),
    /* Counted here ONLY so the link to them can say how many there are. It is
       deliberately not added to `people`: the landing page's headline number is
       who Halden Ridge can work with, and that is the whole point of the split. */
    setAside: Number(r?.setAside ?? 0),
  };
}

// ── Deals ──────────────────────────────────────────────────────────────────

/* Every column the deal pages render. The old query selected four of them and
   the page reads eleven, so `d.highlights.length` threw on the first real deal.
   coalesce on the text fields because the page prints them directly and "null"
   is not a thing anyone wants to read. */
const DEAL_COLS = `reference as id,
       title as name,
       status,
       coalesce(raising, '') as raising,
       coalesce(valuation, '') as valuation,
       coalesce(stage, '') as stage,
       coalesce(sector, '') as sector,
       coalesce(countries, '') as countries,
       coalesce(website, '') as website,
       coalesce(document_name, '') as deck,
       company_id as "accountId",
       coalesce(summary, '') as summary,
       coalesce(highlights, '{}') as highlights,
       coalesce(closing, '') as closing`;

export async function getDeals(): Promise<Deal[]> {
  return query<Deal>(`select ${DEAL_COLS} from deals order by created_at desc`);
}

export async function getDeal(id: string): Promise<Deal | null> {
  return one<Deal>(`select ${DEAL_COLS} from deals where reference = $1`, [id]);
}

/** What the document did not say. Shown on the deal so a gap is never silent. */
export async function getDealGaps(id: string): Promise<string[]> {
  const r = await one<{ gaps: string[] }>(
    `select coalesce(draft_gaps, '{}') as gaps from deals where reference = $1`, [id]);
  return r?.gaps ?? [];
}

/**
 * The people on a deal, each with their full record.
 *
 * One query, not one per person: a deal with three hundred contacts is normal
 * and three hundred round trips is not. The four timestamps collapse to the one
 * status the UI shows, newest state winning.
 */
export async function getDealContacts(
  dealId: string,
): Promise<(DealContact & { person: Person })[]> {
  /* Postgres timestamps arrive as JS Dates, not strings — typing them as
     `string` here was a lie the compiler could not catch, and the raw Date
     reached React, which refuses to render an object. */
  const rows = await query<{
    contact_id: string; drafted_at: Date | null; sent_at: Date | null;
    replied_at: Date | null; sender: string | null;
  }>(
    /* Only what was recorded against THIS deal. There was a mailbox fallback
       here that turned unrelated email into an "In touch" status; it went with
       that status, and its dates went with it — a row reading "Not contacted"
       beside a date is worse than either fact on its own. */
    `select dc.contact_id, dc.drafted_at, dc.sent_at, dc.replied_at, dc.sender
     from deal_contacts dc join deals d on d.id = dc.deal_id
     where d.reference = $1
     order by dc.replied_at desc nulls last, dc.sent_at desc nulls last, dc.added_at`,
    [dealId],
  );
  if (!rows.length) return [];

  const people = await getPeople(rows.map((r) => r.contact_id));
  const byId = new Map(people.map((p) => [p.id, p]));

  return rows.flatMap((r) => {
    const person = byId.get(r.contact_id);
    if (!person) return []; // dropped from research since being added
    const status = r.replied_at ? "Replied"
      : r.sent_at ? "Sent"
      : r.drafted_at ? "Drafted"
      : "Not contacted";
    return [{
      contactId: r.contact_id,
      status: status as DealContact["status"],
      date: day(r.sent_at ?? r.drafted_at),
      sender: r.sender ?? "",
      person,
    }];
  });
}

export async function dealTally(dealId: string) {
  const r = await one<{ people: string; drafted: string; sent: string; replied: string }>(
    `select count(*) people,
            count(*) filter (where dc.drafted_at is not null) drafted,
            count(*) filter (where dc.sent_at is not null) sent,
            count(*) filter (where dc.replied_at is not null) replied
     from deal_contacts dc join deals d on d.id = dc.deal_id where d.reference = $1`, [dealId]);
  return {
    people: Number(r?.people ?? 0),
    drafted: Number(r?.drafted ?? 0),
    sent: Number(r?.sent ?? 0),
    replied: Number(r?.replied ?? 0),
  };
}

// ── Outreach ───────────────────────────────────────────────────────────────

export interface OutreachRow {
  contactId: string;
  name: string;
  nameInferred: boolean;
  jobTitle: string;
  email: string;
  company: string;
  companyId: string | null;
  segment: string;
  dealRef: string;
  dealTitle: string;
  status: OutreachStatus;
  addedAt: string;
  draftedAt: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  sender: string;
  /**
   * What the FIRM said about this raise, if anything.
   *
   * On a person's row because a verdict is a firm's, and this list is where
   * somebody is about to pick people to email — the warning has to be where the
   * mistake would be made, not on a page they would have to think to open.
   */
  verdict: "Accepted" | "Passed" | null;
  verdictEvidence: string;
  verdictSource: "email" | "manual" | null;
}

/**
 * Every person on every deal, one row each.
 *
 * The whole table is one query. Outreach is bounded by how many people Halden Ridge has
 * actually put on deals, which is a working list rather than the 47,000-row
 * contact set, so it does not need the search machinery the other sections use.
 */
export async function getOutreach(opts: { deal?: string; status?: string } = {}): Promise<OutreachRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  /* `deal` carries a comma-separated list, because the picker is multi-select:
     "who has not answered on Arkveld OR Morvane" is one question a partner asks,
     and splitting it across two URLs makes them add the rows up by hand. One
     deal is just a list of one, so nothing special-cases the common case. */
  const refs = (opts.deal ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (refs.length) { params.push(refs); where.push(`d.reference = any($${params.length})`); }
  if (opts.status === "Replied") where.push("dc.replied_at is not null");
  else if (opts.status === "Sent") where.push("dc.sent_at is not null and dc.replied_at is null");
  else if (opts.status === "Drafted") where.push("dc.drafted_at is not null and dc.sent_at is null");
  else if (opts.status === "Not contacted")
    where.push(`dc.drafted_at is null and dc.sent_at is null
      and not exists (select 1 from mail_events me
                      where me.contact_id = dc.contact_id and me.occurred_at >= dc.added_at)`);
  /* The three verdict filters. They sit on the FIRM, so they cut across the
     four stages above rather than extending them — a firm can pass having only
     been drafted to, if somebody rang them. */
  else if (opts.status === "Accepted") where.push("v.verdict = 'Accepted'");
  else if (opts.status === "Passed") where.push("v.verdict = 'Passed'");
  /* Open is contacted-and-undecided. It deliberately overlaps Sent and Replied,
     because it answers a different question: who still owes us an answer. */
  else if (opts.status === "Open")
    where.push("v.verdict is null and (dc.sent_at is not null or dc.drafted_at is not null)");

  const rows = await query<Record<string, unknown>>(
    /* Strictly what was recorded against this deal. A mailbox fallback used to
       hang off here, turning unrelated email into an "In touch" status; both
       are gone, so nothing on this row is about anything but this raise. */
    `select dc.contact_id, dc.added_at, dc.drafted_at, dc.sent_at, dc.replied_at, dc.sender,
            d.reference as deal_ref, d.title as deal_title,
            c.full_name, c.job_title, c.email, c.best_email, c.segment, c.account_id,
            a.name as company_name,
            v.verdict, v.evidence as verdict_evidence, v.source as verdict_source
     from deal_contacts dc
     join deals d on d.id = dc.deal_id
     join contacts c on c.hr_id = dc.contact_id
     left join accounts a on a.hr_id = c.account_id
     /* The firm's answer, carried onto every one of its people. */
     left join deal_verdicts v on v.deal_id = dc.deal_id and v.account_id = c.account_id
     ${where.length ? "where " + where.join(" and ") : ""}
     order by coalesce(dc.replied_at, dc.sent_at, dc.drafted_at, dc.added_at) desc,
              c.full_name nulls last`,
    params);

  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return rows.map((r) => ({
    contactId: String(r.contact_id),
    name: (r.full_name as string) ?? String(r.email),
    nameInferred: !r.full_name,
    jobTitle: (r.job_title as string) ?? "",
    email: (r.best_email as string) ?? String(r.email),
    company: (r.company_name as string) ?? "",
    companyId: (r.account_id as string) ?? null,
    segment: String(r.segment),
    dealRef: String(r.deal_ref),
    dealTitle: String(r.deal_title),
    status: (r.replied_at ? "Replied"
      : r.sent_at ? "Sent"
      : r.drafted_at ? "Drafted"
      : "Not contacted") as OutreachStatus,
    addedAt: iso(r.added_at)!,
    draftedAt: iso(r.drafted_at),
    sentAt: iso(r.sent_at),
    repliedAt: iso(r.replied_at),
    sender: (r.sender as string) ?? "",
    verdict: (r.verdict as "Accepted" | "Passed" | null) ?? null,
    verdictEvidence: (r.verdict_evidence as string) ?? "",
    verdictSource: (r.verdict_source as "email" | "manual" | null) ?? null,
  }));
}

/** The four counts across every deal. */
export async function outreachTally() {
  const r = await one<Record<string, string>>(
    `select count(*) total,
            count(*) filter (where dc.drafted_at is not null and dc.sent_at is null) drafted,
            count(*) filter (where dc.sent_at is not null) sent,
            count(*) filter (where dc.replied_at is not null) replied,
            count(distinct dc.contact_id) filter (where dc.sent_at is not null) people
     from deal_contacts dc`);
  return {
    total: Number(r?.total ?? 0),
    drafted: Number(r?.drafted ?? 0),
    sent: Number(r?.sent ?? 0),
    replied: Number(r?.replied ?? 0),
    people: Number(r?.people ?? 0),
  };
}

export interface OutreachBoardRow {
  reference: string;
  title: string;
  status: DealStatus;
  live: boolean;
  /** Everyone on the deal's list. */
  people: number;
  /** How many of them have actually been emailed — replies included, since an
      email that got an answer was still sent. So people >= sent >= replied,
      and the three read down as one funnel rather than three separate facts. */
  sent: number;
  replied: number;
  /** Firms that have answered — the house, not the person. */
  accepted: number;
  passed: number;
  lastActivity: string | null;
}

/**
 * Every deal with the state of its list — the board Outreach opens on.
 *
 * Three counts, and they nest: on the list, emailed, replied. An earlier
 * version showed "to send" and "waiting" instead, which were each a
 * subtraction the reader had to do in their head and neither of which said
 * plainly whether an email had gone out.
 *
 * Outreach is worked one raise at a time, so the landing screen is a choice of
 * deal rather than every person on every deal run together. The counts are the
 * reason it is a board and not a menu: `waiting` is the chase list, and seeing
 * it per deal is the thing worth looking at first thing.
 *
 * Deals with nobody on them are INCLUDED, showing zero. A raise where the list
 * has not been built yet is exactly the one somebody needs reminding about, and
 * hiding it until it has a contact is how it gets forgotten.
 */
export async function outreachBoard(): Promise<OutreachBoardRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select d.reference, d.title, d.status,
            count(dc.contact_id)::int as people,
            count(*) filter (where dc.sent_at is not null)::int as sent,
            count(*) filter (where dc.replied_at is not null)::int as replied,
            /* Firms, not people — a verdict belongs to the house, and counting
               it once per contact would report three passes for one firm. */
            (select count(*)::int from deal_verdicts v
             where v.deal_id = d.id and v.verdict = 'Accepted') as accepted,
            (select count(*)::int from deal_verdicts v
             where v.deal_id = d.id and v.verdict = 'Passed') as passed,
            max(coalesce(dc.replied_at, dc.sent_at, dc.drafted_at, dc.added_at)) as last_activity
     from deals d
     left join deal_contacts dc on dc.deal_id = d.id
     group by d.id, d.reference, d.title, d.status
     order by max(coalesce(dc.replied_at, dc.sent_at, dc.drafted_at, dc.added_at)) desc nulls last,
              d.created_at desc`);

  return rows.map((r) => ({
    reference: String(r.reference),
    title: String(r.title),
    status: (r.status ?? "Live") as DealStatus,
    /* What "live" means here is "still being worked", which is the only reason
       the board hides anything. Closed and On hold both stop being work. */
    live: r.status === "Live" || r.status === "Closing",
    people: Number(r.people ?? 0),
    sent: Number(r.sent ?? 0),
    replied: Number(r.replied ?? 0),
    accepted: Number(r.accepted ?? 0),
    passed: Number(r.passed ?? 0),
    lastActivity: r.last_activity ? new Date(r.last_activity as string).toISOString() : null,
  }));
}

/**
 * When research data was last loaded.
 *
 * Shown in the top bar. It used to be the moment the browser index file was
 * built; now it is the most recent load, which is the same fact about the same
 * thing. It matters because stale contact data looks exactly like fresh
 * contact data — someone needs to be told when they are working from
 * something six months old.
 */
export async function lastLoadedAt(): Promise<string | null> {
  const r = await one<{ at: string | null }>(`select max(loaded_at)::text at from contacts`);
  return r?.at ?? null;
}

// ── Drafting emails on a deal ──────────────────────────────────────────────

export interface EmailTemplate {
  id: string; name: string; subject: string; body: string;
  /** "first" — a new email. "follow" — a reply in an existing thread. */
  kind: "first" | "follow";
}

/** Halden Ridge's own wording. Nothing here is generated. */
export async function emailTemplates(): Promise<EmailTemplate[]> {
  return query<EmailTemplate>(
    `select id, name, subject, body, coalesce(kind, 'first') as kind
     from email_templates where not archived order by kind desc, sort, name`);
}

export interface DealDocument {
  id: string; name: string; path: string; contentType: string; bytes: number;
}

/** The files the deal was made from, which are what get attached. */
export async function dealDocuments(dealId: string): Promise<DealDocument[]> {
  return query<DealDocument>(
    `select dd.id, dd.name, dd.storage_path as path,
            coalesce(dd.content_type, '') as "contentType", dd.bytes
     from deal_documents dd join deals d on d.id = dd.deal_id
     where d.reference = $1 order by dd.uploaded_at, dd.name`, [dealId]);
}

/**
 * Who on this deal already has a draft sitting in somebody's Outlook.
 *
 * Read so the page can show it rather than silently make a second copy. Only
 * drafts that have NOT been sent count — once it is sent the person shows as
 * emailed instead, which is a different thing to tell somebody.
 */
export async function draftedAlready(dealId: string): Promise<Map<string, string>> {
  const rows = await query<{ contact_id: string; mailbox: string }>(
    `select distinct on (dd.contact_id) dd.contact_id, dd.mailbox
     from deal_drafts dd join deals d on d.id = dd.deal_id
     where d.reference = $1 and dd.sent_at is null
     order by dd.contact_id, dd.created_at desc`, [dealId]);
  return new Map(rows.map((r) => [r.contact_id, r.mailbox]));
}

/**
 * Who on this deal can actually be followed up.
 *
 * TWO conditions, not one. They must have been emailed, AND we must have
 * recorded which conversation it was — a follow-up is a reply, and there is
 * nothing to reply into otherwise. Somebody emailed by hand from Outlook
 * satisfies the first and fails the second, and the composer greys them out
 * with the reason rather than letting a partner pick them and find out at the
 * end of the run.
 */
export async function followableOn(dealRef: string): Promise<Set<string>> {
  const rows = await query<{ contact_id: string }>(
    `select distinct dc.contact_id
     from deal_contacts dc
     join deals d on d.id = dc.deal_id
     join deal_drafts dd on dd.deal_id = d.id and dd.contact_id = dc.contact_id
     where d.reference = $1 and dc.sent_at is not null and dd.conversation_id is not null`,
    [dealRef]);
  return new Set(rows.map((r) => r.contact_id));
}

/**
 * Firms ruled out of this deal's matched list, newest first.
 *
 * Read alongside the matched list rather than derived from it — a removed firm
 * is by definition not in that list, so the only way to offer it back is to
 * ask for it separately.
 */
export async function removedMatches(dealRef: string): Promise<{ id: string; name: string }[]> {
  return query<{ id: string; name: string }>(
    `select r.account_id as id, a.name
     from deal_target_removals r
     join deals d on d.id = r.deal_id
     join accounts a on a.hr_id = r.account_id
     where d.reference = $1
     order by r.removed_at desc`, [dealRef]);
}

/** Record a draft that Microsoft accepted. */
export async function recordDraft(v: {
  dealRef: string; contactId: string; mailbox: string;
  graphId: string; conversationId: string; subject: string;
  template: string; user: string;
}): Promise<void> {
  await query(
    `insert into deal_drafts
       (deal_id, contact_id, mailbox, graph_id, conversation_id, subject, template, created_by)
     select d.id, $2, $3, $4, $5, $6, $7, $8 from deals d where d.reference = $1`,
    [v.dealRef, v.contactId, v.mailbox, v.graphId, v.conversationId, v.subject, v.template, v.user]);
}
