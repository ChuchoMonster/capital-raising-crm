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
import { AccountTable } from "@/app/components/account-table";
import { searchAccounts, searchContacts, segmentCounts, facetOptions } from "@/app/lib/search";
import type { Selected } from "@/app/lib/types";
import { VIEWS, viewOf } from "@/app/lib/views";
import type { ReactNode } from "react";

/** Accounts. Same shape as Contacts, and for the same reasons — see that file. */

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

function pickFilters(sp: Params): Selected {
  const out: Selected = {};
  for (const key of FILTER_KEYS) {
    const raw = sp[`f.${key}`];
    const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    if (values.length) out[key] = values;
  }
  return out;
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const segment = viewOf(sp.segment);
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = pickFilters(sp);

  const [counts, facets, result, alsoContacts] = await Promise.all([
    segmentCounts(),
    segment ? facetOptions(segment, "accounts") : Promise.resolve(null),
    searchAccounts({ q, segment, filters, limit: PAGE * page, offset: 0 }),
    q.trim() ? searchContacts({ q, limit: 1 }) : Promise.resolve({ rows: [], total: 0 }),
  ]);

  const { rows, total } = result;
  const all = Object.values(counts.accounts).reduce((n, v) => n + v, 0);

  return (
    <>
      <SectionHero
        image="/img/placeholder.svg"
        title="Accounts"
        subtitle={`${all.toLocaleString()} organisations`}
        actions={<BulkUpload kind="accounts" />}
      >
        <SegmentPicker segments={SEGMENTS} active={segment} counts={counts.accounts} />
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
            placeholder={segment ? `Search within ${segment}…` : "Search by company name, web address, country…"}
          />
        </div>

        {q.trim() && alsoContacts.total > 0 && (
          <p className="mb-3 text-micro text-ink-2">
            <Link href={`/contacts?q=${encodeURIComponent(q)}`} className="font-medium text-accent hover:underline">
              {alsoContacts.total.toLocaleString()} contact{alsoContacts.total === 1 ? "" : "s"}
            </Link>{" "}
            also match “{q}”.
          </p>
        )}

        {total === 0 ? (
          <Panel bodyClass="">
            <p className="px-5 py-8 text-center text-body text-ink-2">
              Nothing matches{q.trim() && ` \u201c${q}\u201d`}
              {segment && ` in ${segment}`}
              {Object.keys(filters).length > 0 && " with these filters"}.
            </p>
          </Panel>
        ) : (
          <>
            <AccountTable
              rows={rows}
              total={total}
              ctx={{ q, segment, filters, total, kind: "accounts" }}
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
