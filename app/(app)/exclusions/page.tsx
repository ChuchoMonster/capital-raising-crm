import { SectionHero } from "@/app/components/section-hero";
import { type SegmentDef } from "@/app/components/segment-cards";
import { BucketPicker, Search, More } from "@/app/components/list-controls";
import { IconPending, IconBadEmail, IconExcluded } from "@/app/components/section-icons";
import { Panel } from "@/app/components/ui";
import { ExclusionTable } from "@/app/components/exclusion-table";
import { searchSetAside, setAsideCounts } from "@/app/lib/search";
import { SET_ASIDE } from "@/app/lib/scope";

/**
 * Exclusions — everybody the CRM sets aside, in one place, read-only.
 *
 * Why it exists: these 31,000 people were already kept out of every list,
 * search, count and draft, but there was nowhere to LOOK at them. Set aside is
 * not the same as thrown away — a firm Halden Ridge excluded two years ago can turn out
 * to matter, and a bouncing address still records a real relationship.
 *
 * Deliberately absent, all at the client's instruction (2026-08-26):
 *  - FILTERS. The facets describe enrichment nobody has done on these rows.
 *  - ACCOUNTS. Halden Ridge asked for people. The firms are set aside with them and are
 *    already out of every account count.
 *  - TICK-BOXES. Nothing here goes on a deal, and `resolveSelection` would
 *    refuse it anyway — so the component that ticks is not on the page at all.
 *
 * It is reached from the top bar, not from a fifth card on the landing page.
 */

const ICONS: Record<string, React.ReactNode> = {
  pending: <IconPending />,
  "bad-emails": <IconBadEmail />,
  exclusions: <IconExcluded />,
};

/* Built from SET_ASIDE so the cards and the queries can never name a different
   set of buckets. */
const BUCKETS: SegmentDef[] = SET_ASIDE.map((b) => ({
  id: b.id,
  label: b.label,
  blurb: b.blurb,
  icon: ICONS[b.id],
}));

const PAGE = 50;

type Params = Record<string, string | string[] | undefined>;

export default async function ExclusionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const asked = typeof sp.bucket === "string" ? sp.bucket : "";
  /* An unknown bucket in the address bar shows everything rather than nothing
     — a mistyped link should not look like an empty database. */
  const bucketId = SET_ASIDE.some((b) => b.id === asked) ? asked : null;
  const page = Math.max(1, Number(sp.page) || 1);

  const [counts, { rows, total }] = await Promise.all([
    setAsideCounts(),
    searchSetAside({ q, bucket: bucketId, limit: PAGE * page, offset: 0 }),
  ]);

  const all = Object.values(counts).reduce((n, v) => n + v, 0);
  const chosen = BUCKETS.find((b) => b.id === bucketId);

  return (
    <>
      <SectionHero
        image="/img/placeholder.svg"
        title="Exclusions"
        subtitle={`${all.toLocaleString()} people set aside — not counted anywhere else in the CRM`}
      >
        <BucketPicker buckets={BUCKETS} active={bucketId} counts={counts} />
      </SectionHero>

      <div className="mx-auto w-full max-w-[1180px] px-6 py-7">
        {/* No standing explanation of what this page is (John, 2026-08-27).
            The three cards say it. A selected group keeps its one line so the
            reader can see which of them they are inside. */}
        {chosen && (
          <p className="mb-4 max-w-[80ch] text-micro text-ink-2">{chosen.blurb}</p>
        )}

        <div className="mb-4">
          <Search
            initial={q}
            placeholder={
              chosen ? `Search within ${chosen.label.toLowerCase()}…` : "Search by name, email, company…"
            }
          />
        </div>

        {total === 0 ? (
          <Panel bodyClass="">
            <p className="px-5 py-8 text-center text-body text-ink-2">
              Nothing matches{q.trim() && ` “${q}”`}
              {chosen && ` in ${chosen.label.toLowerCase()}`}.
            </p>
          </Panel>
        ) : (
          <>
            <ExclusionTable rows={rows} />
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
