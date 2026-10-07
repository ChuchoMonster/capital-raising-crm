import { getDeals, dealTally } from "@/app/lib/store";
import { SectionHero } from "@/app/components/section-hero";
import { DealUpload, type UploadTarget } from "@/app/components/deal-upload";
import { DealTable, type DealRow } from "@/app/components/deal-table";
import { Panel } from "@/app/components/ui";

/**
 * Every raise, one row each.
 *
 * The three counts are the whole point of the page: how many people are on the
 * deal, how many have actually been emailed, and how many answered. Anything
 * else belongs on the deal itself.
 *
 * The table is a client component only because removing a deal needs tick
 * boxes; the rows themselves are still fetched and rendered here.
 */
export default async function DealsPage() {
  const deals = await getDeals();
  /* Fetched together rather than one per row: a query inside a render loop is
     how a page with twenty deals makes twenty-one round trips. */
  const tallies = new Map(
    await Promise.all(deals.map(async (d) => [d.id, await dealTally(d.id)] as const)),
  );
  const live = deals.filter((d) => d.status === "Live").length;

  const targets: UploadTarget[] = deals.map((d) => ({ id: d.id, name: d.name, status: d.status }));

  const rows: DealRow[] = deals.map((d) => {
    const t = tallies.get(d.id)!;
    return {
      id: d.id, name: d.name, sector: d.sector, countries: d.countries,
      raising: d.raising, status: d.status,
      people: t.people, sent: t.sent, replied: t.replied,
    };
  });

  return (
    <>
      <SectionHero
        image="/img/placeholder.svg"
        title="Deals"
        subtitle={
          deals.length === 0
            ? "No deals yet"
            : `${deals.length} ${deals.length === 1 ? "deal" : "deals"} \u00b7 ${live} live`
        }
      />

      <div className="mx-auto w-full max-w-[1180px] px-6 py-7">
        {/* The deals the panel can add documents TO. Closed ones are offered as
            well — a document can land after a raise closes, and refusing it
            would send somebody to make a duplicate deal instead. */}
        <DealUpload deals={targets} />

        {rows.length === 0 ? (
          <Panel bodyClass="">
            <p className="px-5 py-8 text-center text-body text-ink-2">
              No deals yet. A deal holds its write-up and the people it is going to.
            </p>
          </Panel>
        ) : (
          <DealTable rows={rows} />
        )}
      </div>
    </>
  );
}
