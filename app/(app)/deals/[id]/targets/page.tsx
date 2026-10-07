import { notFound } from "next/navigation";
import { getDeal, removedMatches } from "@/app/lib/store";
import { RecordHero, BackLink } from "@/app/components/record";
import { TargetGrid } from "@/app/components/target-grid";
import { askFromDeal, tierFirms } from "@/app/lib/tiering";

/**
 * The firms this raise should go to, worked out from the deal itself.
 *
 * Nothing here is stored — it is recomputed on every visit from the deal's own
 * sector, minerals, countries and raise size against the current investor
 * records. That is deliberate: enrichment improves weekly, and a list frozen
 * at upload would quietly go stale while looking authoritative.
 */
export default async function TargetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getDeal(id);
  if (!d) notFound();

  const ask = askFromDeal(d);
  const [firms, removed] = await Promise.all([
    tierFirms(d.id, ask, d.accountId ?? null),
    removedMatches(d.id),
  ]);

  return (
    <>
      <RecordHero
        image="/img/placeholder.svg"
        back={<BackLink href={`/deals/${id}`}>{d.name}</BackLink>}
        name="Matched Accounts"
        actions={
          /* A plain link, not a button that assembles a file in the page: the
             list is worked out on the server and the file should be too. It
             carries EVERY firm, whatever is filtered on screen, on a tab per
             tier. */
          firms.length > 0 ? (
            <a
              href={`/api/deals/${id}/targets`}
              className="rounded-md border border-white/25 px-3 py-[7px] text-[13px] font-medium text-white transition-colors hover:bg-white/15"
            >
              Export
            </a>
          ) : undefined
        }
      />

      <div className="mx-auto w-full max-w-[1180px] px-6 py-7">
        {/* The raise size is the only missing field worth a banner, because it
            is the only one that can rule a firm out — without it nothing is
            excluded on size and every fund from a boutique to BlackRock stays
            on the list. A missing mineral or country just skips its test and
            costs a tier, never a place on the list.

            The "Matched on" box that used to sit above this — sector, minerals,
            countries, the fund-size window — is gone (John, 2026-08-28). It
            explained the basis of the list before anyone had seen the list, and
            the tiers themselves are the answer to "on what basis". */}
        {!ask.raiseUsd && (
          <p className="mb-5 rounded-[9px] border border-[var(--color-warn)] bg-[var(--color-warn-bg)] px-5 py-3.5 text-[13.5px] leading-[1.55] text-ink">
            No fundraising amount mentioned in the attached docs.
          </p>
        )}

        {firms.length === 0 ? (
          <p className="rounded-md border border-line px-5 py-10 text-center text-body text-ink-2">
            Nothing matched this deal.
          </p>
        ) : (
          <TargetGrid dealRef={id} firms={firms} removed={removed} />
        )}
      </div>
    </>
  );
}
