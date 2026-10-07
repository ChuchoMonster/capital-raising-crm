import { NextResponse } from "next/server";
import { requireUser } from "@/app/lib/session";
import { getDeal } from "@/app/lib/store";
import { askFromDeal, tierFirms } from "@/app/lib/tiering";
import { buildXlsx } from "@/app/lib/xlsx";

/**
 * The whole matched list for one deal, as a workbook with a tab per tier.
 *
 * EVERY firm on the list, all three tiers, whatever is filtered or open on
 * screen. A filter is a way of reading the list, not a decision about it, and
 * an export that quietly honoured the filter would hand somebody a file they
 * believed was the answer.
 *
 * SIX TABS: three of firms, three of the people at them, one pair per tier.
 * That is why this is an .xlsx and not a CSV — a CSV is one table and cannot
 * hold six. The tier is still a column on every row as well, so the file
 * survives being flattened, copied or filtered back into one sheet.
 *
 * The two halves answer different questions. "Which houses should see this"
 * is the firm list; "who do I actually write to" is the people list, and
 * folding the people into a cell on the firm row — which is what the firm tabs
 * do — makes the second question unanswerable in a spreadsheet.
 *
 * Recomputed here rather than posted up from the page: the browser holds a
 * rendering of the list, and the file should be the list itself. It is the same
 * tiering call the page makes, so the two cannot disagree — and firms ruled out
 * by hand are already gone from both.
 *
 * A GET, so it is a plain link. The selection export next door is a POST
 * because it carries thousands of ids; this carries a deal reference.
 */
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  await requireUser();
  const { ref } = await params;

  const deal = await getDeal(ref);
  if (!deal) return NextResponse.json({ message: "That deal no longer exists." }, { status: 404 });

  const firms = await tierFirms(deal.id, askFromDeal(deal), deal.accountId ?? null);

  /* One row per FIRM, with its people folded into two cells. The page is a
     list of firms and this is that list; a row per person would be a different
     document and would repeat every firm's details down the page. */
  const cols: [string, (f: (typeof firms)[number]) => unknown][] = [
    ["Tier", (f) => f.tier],
    ["Account Name", (f) => f.name],
    ["hr_id", (f) => f.id],
    ["Investor Type", (f) => f.type],
    ["AUM Range", (f) => f.aum],
    ["Office Locations", (f) => f.countries],
    ["Minerals", (f) => f.metals],
    ["Invests In", (f) => f.facets.sector ?? []],
    ["Invests In Countries", (f) => f.facets.invests_in ?? []],
    ["Investment Type", (f) => f.facets.via ?? []],
    /* The reason a firm is not tier 1, carried into the file. Without it the
       tier is a number nobody can act on. */
    ["Not Established", (f) => f.gaps],
    ["# Contacts", (f) => f.contacts.length],
    ["Contacts", (f) => f.contacts.map((c) => c.name).join("; ")],
    ["Contact Emails", (f) => f.contacts.map((c) => c.email).join("; ")],
    ["Ever Replied", (f) => (f.contacts.some((c) => c.replied) ? "TRUE" : "FALSE")],
    ["Already On Deal", (f) => f.contacts.filter((c) => c.onDeal).length],
  ];

  /* Arrays into one cell, and no line breaks inside one — 16 contact records
     held a mangled name with a real newline in it, which turns one row into
     several in anything reading the file a line at a time. */
  const flat = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.filter(Boolean).join("; ") : String(v);
    return s.replace(/[\r\n\t]+/g, " ").trim();
  };

  const header = cols.map(([label]) => label);
  const firmSheet = (tier: 1 | 2 | 3) => ({
    name: `Tier ${tier} firms`,
    rows: [
      header,
      ...firms
        .filter((f) => f.tier === tier)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => cols.map(([, read]) => flat(read(f)))),
    ],
  });

  /* One row per PERSON, carrying enough of their firm to be worked from on its
     own — a list of names with no firm beside them is not a call sheet. */
  const peopleCols: [string, (f: (typeof firms)[number], c: (typeof firms)[number]["contacts"][number]) => unknown][] = [
    ["Tier", (f) => f.tier],
    ["Name", (_f, c) => c.name],
    ["Job Title", (_f, c) => c.jobTitle],
    ["Email", (_f, c) => c.email],
    ["Account Name", (f) => f.name],
    ["Investor Type", (f) => f.type],
    ["AUM Range", (f) => f.aum],
    ["Office Locations", (f) => f.countries],
    ["Minerals", (f) => f.metals],
    ["Ever Replied", (_f, c) => (c.replied ? "TRUE" : "FALSE")],
    /* The date only — a person reading a call sheet wants "when", and the
       rest of the last-contact record is on their own page. */
    ["Last Contacted", (_f, c) => (c.lastContact?.date ?? "").slice(0, 10)],
    ["Last Replied", (_f, c) => (c.lastContact?.repliedDate ?? "").slice(0, 10)],
    ["Emailed By", (_f, c) => c.lastContact?.sender ?? ""],
    ["Already On Deal", (_f, c) => (c.onDeal ? "TRUE" : "FALSE")],
    ["hr_id", (_f, c) => c.id],
    ["Account hr_id", (f) => f.id],
  ];
  const peopleHeader = peopleCols.map(([label]) => label);
  const peopleSheet = (tier: 1 | 2 | 3) => ({
    name: `Tier ${tier} people`,
    rows: [
      peopleHeader,
      ...firms
        .filter((f) => f.tier === tier)
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((f) => f.contacts.map((c) => peopleCols.map(([, read]) => flat(read(f, c))))),
    ],
  });

  /* A tier with nobody in it still gets its tabs. An absent tab reads as "this
     export is broken"; an empty one reads as "nothing reached tier 1", which
     is a real and useful answer about a deal. */
  const book = buildXlsx([
    firmSheet(1), peopleSheet(1),
    firmSheet(2), peopleSheet(2),
    firmSheet(3), peopleSheet(3),
  ]);

  const safe = deal.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 60) || "deal";
  return new NextResponse(book as unknown as BodyInit, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      /* ASCII only. An HTTP header is latin-1, and an em dash in the file name
         threw before a byte of the file was written. */
      "content-disposition": `attachment; filename="${safe} matched accounts ${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
