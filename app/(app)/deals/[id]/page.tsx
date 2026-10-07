import Link from "next/link";
import { notFound } from "next/navigation";
import { getDeal, getDealContacts, getAccount } from "@/app/lib/store";
import { getTeaser } from "@/app/lib/deal/teaser-store";
import { SegmentChip } from "@/app/components/ui";
import { RecordHero, BackLink, Card } from "@/app/components/record";
import { DealStatusChip } from "@/app/components/deal-bits";
import { DealActions } from "@/app/components/deal-actions";
import { DealTeaser } from "@/app/components/deal-teaser";
import { DealContacts } from "@/app/components/deal-contacts";

/**
 * One raise: the teaser that goes out about it, then the people it is going to.
 *
 * THE TEASER IS THE PAGE. It used to open with four figure tiles — raising,
 * sector, contacts, progress — over a "mandate" write-up, which between them
 * said what the deal was in a form nobody sends anywhere. The teaser says the
 * same things in the form that is actually attached to a first email, so what
 * is on the screen is what an investor will see (John, 2026-08-28).
 *
 * Nothing was lost by the swap: the raise, the valuation and the stage are the
 * teaser's figures panel, the write-up is its headline and standfirst, and how
 * far the outreach has got is the contacts table below, which always carried it.
 */
export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getDeal(id);
  if (!d) notFound();

  const [rows, account, stored] = await Promise.all([
    getDealContacts(d.id),
    d.accountId ? getAccount(d.accountId) : Promise.resolve(null),
    getTeaser(id),
  ]);

  const sent = rows.filter((r) => r.status === "Sent" || r.status === "Replied").length;
  const replied = rows.filter((r) => r.status === "Replied").length;

  return (
    <>
      <RecordHero
        image="/img/placeholder.svg"
        back={<BackLink href="/deals">All deals</BackLink>}
        name={d.name}
        website={
          account ? (
            <Link
              href={`/accounts/${account.id}`}
              className="text-[15px] text-white underline decoration-white/45 underline-offset-[5px] transition-colors hover:decoration-white"
            >
              {account.name}
            </Link>
          ) : (
            <span className="text-[15px] text-white/55">{d.website}</span>
          )
        }
        /* The status moved up here when the tiles went. It is one word about
           whether this raise is still being worked, and it belongs beside the
           name rather than in a tile of its own. */
        chip={
          <span className="flex items-center gap-2">
            <SegmentChip segment="Business" />
            <DealStatusChip status={d.status} />
          </span>
        }
        actions={
          <>
            {/* The way in to the tiered list, sitting immediately before
                "Draft an email" — find the firms, then write to them. */}
            <Link
              href={`/deals/${id}/targets`}
              className="rounded-md border border-white/25 px-3 py-[7px] text-[13px] font-medium text-white transition-colors hover:bg-white/15"
            >
              Matched Accounts
            </Link>
            <DealActions dealRef={id} contactIds={rows.map((r) => r.contactId)} status={d.status} />
          </>
        }
      />

      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 py-7">
        <DealTeaser dealRef={id} teaser={stored?.teaser ?? null} />

        <Card
          title="Contacts on this deal"
          right={sent ? <span>{sent} emailed · {replied} replied</span> : undefined}
          flush
        >
          {rows.length === 0 ? (
            <p className="px-5 py-6 text-body text-ink-2">
              Nobody on this deal yet. Add people from Matched Accounts, then draft from here.
            </p>
          ) : (
            <DealContacts
              dealRef={d.id}
              rows={rows.map((r) => ({
                contactId: r.contactId,
                personId: r.person.id,
                name: r.person.name,
                jobTitle: r.person.jobTitle,
                company: r.person.companyName,
                email: r.person.bestEmail,
                emailStatus: r.person.status,
                status: r.status,
                date: r.date,
                sender: r.sender,
              }))}
            />
          )}
        </Card>
      </div>
    </>
  );
}
