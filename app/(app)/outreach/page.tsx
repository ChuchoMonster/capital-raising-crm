import Link from "next/link";
import { getOutreach, outreachBoard } from "@/app/lib/store";
import { Panel, TableHead, StatusChip } from "@/app/components/ui";
import { SectionHero } from "@/app/components/section-hero";
import { OutreachChip } from "@/app/components/deal-bits";
import { formatDate } from "@/app/components/last-contact";
import { OutreachBoard } from "@/app/components/outreach-board";
import { VerdictCell } from "@/app/components/verdict-cell";
import { DealSwitcher } from "@/app/components/deal-picker";
import { BackLink } from "@/app/components/record";

/**
 * Outreach, one raise at a time.
 *
 * With no deal chosen this is a board of live raises showing where each one
 * stands. With one chosen it is that deal's list.
 *
 * It opens deal-first rather than showing every person on every deal together,
 * because that combined list stops being readable somewhere around the tenth
 * raise and nobody works that way in any case — a partner sits down to push one
 * deal along.
 *
 * How this differs from the deal's own page, which also lists its people: that
 * page is the ROSTER — the write-up, and where people are added and removed.
 * This is where the sending is worked and filtered by where each person got to.
 *
 * `Replied?` on the contact list is a third, unrelated fact: that person ever
 * wrote back to Halden Ridge in five years of email. This is about this pitch.
 */
export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<{ deal?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const deals = await outreachBoard();

  /* No deal chosen: the board, and nothing else. The counts live on the cards,
     so a summary line above them is the same numbers twice. */
  if (!sp.deal) {
    return (
      <>
        <SectionHero image="/img/placeholder.svg" title="Outreach" />
        <div className="mx-auto w-full max-w-[1180px] px-6 py-7">
          <OutreachBoard deals={deals} />
        </div>
      </>
    );
  }

  const deal = deals.find((d) => d.reference === sp.deal);
  /* "All" is the default and matches no filter branch, so it reads as everyone
     on the deal. It is a real chip rather than an absent one, because a filter
     row whose default state is nothing selected reads as broken. */
  const status = sp.status ?? "All";
  const rows = await getOutreach({ deal: sp.deal, status });

  return (
    <>
      <SectionHero
        image="/img/placeholder.svg"
        title={deal?.title ?? "Outreach"}
        back={<BackLink href="/outreach">All deals</BackLink>}
        subtitle={
          deal
            ? deal.people === 0
              ? "Nobody on this list yet"
              /* Contacts, sent and replied are people; accepted and passed are
                 FIRMS, because that is who decides. Labelled so the jump from
                 one unit to the other is stated rather than inferred. */
              : `${deal.people.toLocaleString()} contacts · ${deal.sent} sent · ${deal.replied} replied`
                + (deal.accepted || deal.passed
                    ? ` · ${deal.accepted} firms accepted · ${deal.passed} passed`
                    : "")
            : "Deal not found"
        }
      />

      <div className="mx-auto w-full max-w-[1180px] px-6 py-7">
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-micro">
          <DealSwitcher deals={deals} current={sp.deal} status={sp.status} />
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          {["All", "Not contacted", "Drafted", "Sent", "Replied"].map((s) => (
            <Chip
              key={s}
              href={`/outreach?${new URLSearchParams(
                s === "All" ? { deal: sp.deal! } : { deal: sp.deal!, status: s },
              )}`}
              on={status === s}
              label={s}
            />
          ))}
          {/* A rule, because what follows is a different question. The four
              above are how far the sending got; these three are what the firm
              said back, and "Open" deliberately overlaps Sent and Replied —
              it answers "who still owes us an answer". */}
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          {["Accepted", "Passed", "Open"].map((s) => (
            <Chip
              key={s}
              href={`/outreach?${new URLSearchParams({ deal: sp.deal!, status: s })}`}
              on={status === s}
              label={s}
            />
          ))}
          <Link
            href={`/deals/${sp.deal}`}
            className="ml-auto whitespace-nowrap text-micro text-ink-3 hover:text-accent"
          >
            Open the deal →
          </Link>
        </div>

        <Panel bodyClass="">
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-body text-ink-2">
              {deal?.people === 0
                ? "Nobody is on this deal yet. Add people from Matched Accounts, then draft from the deal's own page."
                : status === "Accepted" ? "No firm has accepted this deal yet."
                : status === "Passed" ? "No firm has passed on this deal."
                : status === "Open" ? "Nobody has been contacted on this deal yet."
                : "Nobody on this deal is at that stage."}
            </p>
          ) : (
            <>
              <table className="w-full text-table">
                <TableHead tight cols={["Person", "Job title", "Company", "Status", "Answer", "Sent", "Sender"]} />
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.contactId} className={i % 2 ? "bg-sunken/50" : ""}>
                      <td className="px-3 py-[8px]">
                        <Link
                          href={`/contacts/${r.contactId}`}
                          className="inline-flex items-center gap-2 text-accent hover:underline"
                        >
                          <StatusChip status="" bare />
                          <span className={r.nameInferred ? "italic" : ""}>{r.name}</span>
                        </Link>
                        <div className="font-mono text-[12px] text-ink-3">{r.email}</div>
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-[8px] text-ink-2" title={r.jobTitle}>
                        {r.jobTitle || <span className="text-ink-3">—</span>}
                      </td>
                      <td className="px-3 py-[8px] text-ink-2">
                        {r.companyId ? (
                          <Link href={`/accounts/${r.companyId}`} className="hover:underline">
                            {r.company || "—"}
                          </Link>
                        ) : (
                          r.company || "—"
                        )}
                      </td>
                      <td className="px-3 py-[8px]">
                        <OutreachChip status={r.status} />
                      </td>
                      <td className="px-3 py-[8px] align-top">
                        <VerdictCell
                          dealRef={r.dealRef}
                          accountId={r.companyId}
                          company={r.company}
                          verdict={r.verdict}
                          evidence={r.verdictEvidence}
                          source={r.verdictSource}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-[8px] text-micro text-ink-3">
                        {r.sentAt ? formatDate(r.sentAt.slice(0, 10)) : "—"}
                      </td>
                      <td className="px-3 py-[8px] text-micro text-ink-3">{r.sender || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center gap-4 border-t border-line px-5 py-3">
                <span className="text-micro text-ink-2">
                  Showing {rows.length.toLocaleString()} of {deal?.people.toLocaleString() ?? "—"} on this
                  deal
                </span>
              </div>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

function Chip({ href, on, label }: { href: string; on: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-2.5 py-[3px] transition-colors ${
        on ? "bg-accent text-white" : "border border-line bg-paper text-ink-2 hover:bg-sunken"
      }`}
    >
      {label}
    </Link>
  );
}
