import { NextResponse } from "next/server";
import { requireUser } from "@/app/lib/session";
import { query } from "@/app/lib/db";
import { resolveSelection, type Selection } from "@/app/lib/selection";

/**
 * Export the current selection as a spreadsheet file.
 *
 * A POST rather than a link, because a selection can be thousands of rows and
 * a web address cannot carry that. The browser downloads the response directly
 * — no assembling the file in the page, which at eleven thousand rows would
 * mean holding the whole export in memory in the tab.
 *
 * Guarded like every other route: this hands out contact details, so an
 * unauthenticated request must never reach the query.
 */

/** Arrays come back as arrays; the sheet wants one cell. */
const J = (c: string) => `array_to_string(${c}, '; ')`;

/** On every row, whatever the segment. */
const CONTACT_CORE: [string, string][] = [
  ["hr_id", "c.hr_id"],
  ["Full Name", "c.full_name"],
  ["Job Title", "c.job_title"],
  ["Email", "c.best_email"],
  ["Primary Email", "c.email"],
  ["Secondary Email(s)", "(select string_agg(ce.email, '; ' order by ce.email) from contact_emails ce where ce.contact_id = c.hr_id and not ce.is_primary)"],
  ["Domain", "c.domain"],
  ["Company", "a.name"],
  ["Website", "a.website"],
  ["Segment", "c.segment"],
  ["Role", "c.role"],
  ["Replied?", "c.replied"],
  ["Email Verified?", "c.email_verified"],
  ["Best Email Status", "c.best_email_status"],
  ["In Mailchimp?", "c.in_mailchimp"],
  ["Contact Owner", J("c.owner")],
  ["Countries", J("c.country_names")],
  ["Note", "c.note"],
];

const ACCOUNT_CORE: [string, string][] = [
  ["hr_id", "a.hr_id"],
  ["Account Name", "a.name"],
  ["Domain", "a.domain"],
  ["Website", "a.website"],
  ["Segment", "a.segment"],
  ["Type", "a.type"],
  ["# Contacts", "a.contact_count"],
  ["No Contact?", "a.no_contact"],
  ["Reachable Contact?", "a.reachable_contact"],
  ["Account Owner", J("a.owner")],
  ["In Mailchimp?", "a.in_mailchimp"],
  ["Countries", J("a.country_names")],
  ["Note", "a.note"],
];

/**
 * Everything each segment has been enriched with.
 *
 * Every money figure ships beside the sentence it came from. A number filed
 * with a regulator and one lifted off a marketing page look identical in a
 * spreadsheet cell; the basis column is the only thing that separates them,
 * so the two must never be exported apart.
 */
const SEGMENT_COLUMNS: Record<string, [string, string][]> = {
  Investors: [
    ["Investor Type", J("i.investor_type")],
    ["Invests In", J("i.invests_in")],
    ["Invests In Countries", J("i.invests_in_countries")],
    ["Invests Via", J("i.invests_via")],
    ["Invests Via Basis", "i.invests_via_basis"],
    ["AUM Range", "i.aum_range"],
    ["AUM $", "i.aum_usd"],
    ["AUM Basis", "i.aum_basis"],
    ["Cheque Size", "i.cheque_size"],
    ["Cheque Size Basis", "i.cheque_size_basis"],
    ["Holds Halden Ridge Companies", J("i.holds_hr_companies")],
  ],
  Business: [
    ["Industry", J("b.industry")],
    ["Commodity", J("b.commodity")],
    ["HQ City", "b.hq_city"],
    ["Project Countries", J("b.project_countries")],
    ["Ticker", "b.ticker"],
    ["Stage", "b.stage"],
    ["Study Level", "b.study_level"],
    ["Lead Project", "b.lead_project"],
    // Kept exactly as recorded, in the currency stated. No conversion — that
    // decision sits with Halden Ridge, and GBX is pence, not pounds.
    ["Market Cap", "b.market_cap"],
    ["Enterprise Value", "b.enterprise_value"],
    ["Cash", "b.cash"],
    ["Cash Runway (mo)", "b.cash_runway_months"],
    ["Employees", "b.employees"],
    ["Financials As Of", "b.financials_as_of"],
    ["Last Raise", "b.last_raise"],
    ["Raise Type", "b.raise_type"],
  ],
  Intermediaries: [
    ["Intermediary Type", "it.intermediary_type"],
    ["Sector Focus", J("it.sector_focus")],
  ],
  "Government/Strategic": [
    ["Entity Kind", "g.entity_kind"],
    ["Mandate Focus", J("g.mandate_focus")],
  ],
};

const ENRICHMENT_JOINS = `
  left join account_investor     i  on i.hr_id  = acct.hr_id
  left join account_business     b  on b.hr_id  = acct.hr_id
  left join account_intermediary it on it.hr_id = acct.hr_id
  left join account_government   g  on g.hr_id  = acct.hr_id`;

/** Excel treats a leading =, +, - or @ as a formula. Blunt the cell. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return `"${v.toISOString().slice(0, 10)}"`;
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function POST(req: Request) {
  await requireUser();

  const body = (await req.json().catch(() => null)) as
    | { selection: Selection; kind: "contacts" | "accounts" }
    | null;
  if (!body?.selection) return NextResponse.json({ error: "no selection" }, { status: 400 });

  const kind = body.kind === "accounts" ? "accounts" : "contacts";
  const ids = await resolveSelection(body.selection, kind);
  if (!ids.length) return NextResponse.json({ error: "nothing selected" }, { status: 400 });

  /* Which enrichment columns to include. If the selection is all investors,
     twenty blank mining columns help nobody; if it spans segments, everything
     goes in. Asking the data rather than guessing from the filter also covers
     a hand-picked selection, which has no segment at all. */
  const present = await query<{ segment: string }>(
    kind === "contacts"
      ? `select distinct segment from contacts where hr_id = any($1::text[])`
      : `select distinct segment from accounts where hr_id = any($1::text[])`,
    [ids],
  );
  const segments = present.map((r) => r.segment).filter((s) => s in SEGMENT_COLUMNS);

  const cols: [string, string][] = [
    ...(kind === "contacts" ? CONTACT_CORE : ACCOUNT_CORE),
    ...segments.flatMap((s) => SEGMENT_COLUMNS[s]),
  ];

  const select = cols.map(([label, expr]) => `${expr} as ${JSON.stringify(label)}`).join(", ");
  const rows = await query<Record<string, unknown>>(
    kind === "contacts"
      ? `select ${select}
         from contacts c
         left join accounts a on a.hr_id = c.account_id
         left join accounts acct on acct.hr_id = c.account_id
         ${ENRICHMENT_JOINS}
         where c.hr_id = any($1::text[])
         order by c.full_name nulls last, c.hr_id`
      : `select ${select}
         from accounts a
         left join accounts acct on acct.hr_id = a.hr_id
         ${ENRICHMENT_JOINS}
         where a.hr_id = any($1::text[])
         order by a.name`,
    [ids],
  );

  const header = cols.map(([label]) => csvCell(label)).join(",");
  const lines = rows.map((r) => cols.map(([label]) => csvCell(r[label])).join(","));
  // The byte-order mark is what makes Excel open this as UTF-8 rather than
  // mangling every accented name in the file.
  const csv = "﻿" + [header, ...lines].join("\r\n") + "\r\n";

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="Halden Ridge ${kind} ${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
