import Link from "next/link";
import { SectionHero } from "@/app/components/section-hero";
import { type SegmentDef } from "@/app/components/segment-cards";
import { SegmentPicker, Filters, Search, More } from "@/app/components/list-controls";
import {
  IconInvestors, IconFamilyOffice, IconIndividual,
  IconBusinesses, IconGovernment, IconIntermediaries,
} from "@/app/components/section-icons";
import { Panel } from "@/app/components/ui";
import { BulkUpload } from "@/app/components/bulk-upload";
import { ContactTable } from "@/app/components/contact-table";
import { searchContacts, searchAccounts, segmentCounts, facetOptions } from "@/app/lib/search";
import type { Selected } from "@/app/lib/types";
import type { RepliedFilter } from "@/app/lib/search";
import { VIEWS, viewOf } from "@/app/lib/views";
import type { ReactNode } from "react";

/**
 * Contacts.
 *
 * Rendered on the server, one page at a time. What that replaces: the browser
 * used to download the entire list — every name and every address — and search
 * it locally. That file sat under public/, where no sign-in check can reach,
 * so anyone who knew its address could take the lot. Nothing about the data
 * now leaves the server except the fifty rows being shown.
 *
 * The other thing it fixes: the count is real. The old one asked for at most
 * 500 matches and then reported 500 as the total, so a broad search said
 * "showing 100 of 500" when there were three thousand — and there was no way
 * to reach the rest.
 */

/**
 * Six tabs, two rows of three: the ways to be a buyer on top, everybody else
 * below. Labels and order come from views.ts so this page and Contacts cannot
 * drift apart, and only the drawing is chosen here.
 */
const ICONS: Record<string, ReactNode> = {
  Investors: <IconInvestors />,
  "Family Offices": <IconFamilyOffice />,
  "High Net Worth": <IconIndividual />,
  Business: <IconBusinesses />,
  "Government/Strategic": <IconGovernment />,
  Intermediaries: <IconIntermediaries />,
};
const SEGMENTS: SegmentDef[] = VIEWS.map((v) => ({ ...v, icon: ICONS[v.id] }));

const PAGE = 50;
const FILTER_KEYS = ["country", "type", "sector", "commodity", "aum", "via", "invests_in", "stage", "project"];

type Params = Record<string, string | string[] | undefined>;

/** Pull the chosen filters out of the address bar, ignoring anything unknown. */
function pickFilters(sp: Params): Selected {
  const out: Selected = {};
  for (const key of FILTER_KEYS) {
    const raw = sp[`f.${key}`];
    const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    if (values.length) out[key] = values;
  }
  return out;
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const segment = viewOf(sp.segment);
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = pickFilters(sp);
  /* Its own key rather than one of the `f.` filters, so that changing tab —
     which clears those — leaves it alone. Anything but yes or no is All. */
  const replied: RepliedFilter = sp.replied === "yes" || sp.replied === "no" ? sp.replied : null;

  const [counts, facets, result, alsoAccounts] = await Promise.all([
    segmentCounts(),
    segment ? facetOptions(segment, "contacts") : Promise.resolve(null),
    searchContacts({ q, segment, filters, replied, limit: PAGE * page, offset: 0 }),
    q.trim() ? searchAccounts({ q, limit: 1 }) : Promise.resolve({ rows: [], total: 0 }),
  ]);

  const { rows, total } = result;
  const reachable = Object.entries(counts.contacts)
    .filter(([s]) => s !== "Pending")
    .reduce((n, [, v]) => n + v, 0);

  return (
    <>
      <SectionHero
        actions={<BulkUpload kind="contacts" />}
        image="/img/placeholder.svg"
        title="Contacts"
        subtitle={`${reachable.toLocaleString()} contacts`}
      >
        <SegmentPicker segments={SEGMENTS} active={segment} counts={counts.contacts} />
      </SectionHero>

      <div className="mx-auto w-full max-w-[1180px] px-6 py-7">
        {!segment && (
          <p className="mb-4 text-micro text-ink-2">
            Choose a segment above to filter by type, sector, country and the rest.
          </p>
        )}
        <Filters facets={facets} selected={filters} />

        <div className="mb-4">
          <Search
            initial={q}
            placeholder={segment ? `Search within ${segment}…` : "Search by name, email, company, country…"}
          />
        </div>

        {q.trim() && alsoAccounts.total > 0 && (
          <p className="mb-3 text-micro text-ink-2">
            <Link href={`/accounts?q=${encodeURIComponent(q)}`} className="font-medium text-accent hover:underline">
              {alsoAccounts.total.toLocaleString()} account{alsoAccounts.total === 1 ? "" : "s"}
            </Link>{" "}
            also match “{q}”.
          </p>
        )}

        {total === 0 ? (
          <Panel bodyClass="">
            <p className="px-5 py-8 text-center text-body text-ink-2">
              Nothing matches{q.trim() && ` \u201c${q}\u201d`}
              {segment && ` in ${segment}`}
              {(Object.keys(filters).length > 0 || replied) && " with these filters"}.
            </p>
          </Panel>
        ) : (
          <>
            <ContactTable
              rows={rows}
              total={total}
              ctx={{ q, segment, filters, replied, total, kind: "contacts" }}
            />
            <div className="flex items-center justify-between gap-4 rounded-b-md border border-t-0 border-line px-5 py-3">
              <span className="text-micro text-ink-2">
                Showing {rows.length.toLocaleString()} of {total.toLocaleString()}
              </span>
              {rows.length < total && (
                <More page={page} remaining={Math.min(PAGE, total - rows.length)} />
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
