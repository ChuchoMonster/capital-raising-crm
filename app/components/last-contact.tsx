import Link from "next/link";
import type { LastContact } from "@/app/lib/types";

/**
 * "12 Aug 2026" — the year matters here, since a stale pitch is the point.
 *
 * Takes anything and always returns a string. It used to return its own
 * argument when it could not parse it, which was safe only while every caller
 * really did pass a string: a Postgres timestamp arrives as a Date, came
 * straight back out, and React refuses to render an object — one contact with
 * a recorded send took the whole deal page down.
 */
export function formatDate(iso: unknown): string {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(String(iso) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return typeof iso === "string" ? iso : "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The last time anyone emailed this person, in a table cell.
 *
 * Replied is shown as loudly as the date because it is the part that decides
 * what to do: someone who answered can be contacted again, someone who went
 * quiet should probably be left to the partner who already pitched them.
 *
 * The deal is OPTIONAL. Most email is not about a raise, and where it is, the
 * system can only name the deal when there was one obvious candidate — so the
 * link appears when the deal is known and is simply absent when it is not.
 * Saying nothing about the deal is honest; guessing one would not be.
 */
export function LastContactCell({ last }: { last?: LastContact | null }) {
  if (!last)
    return (
      <span className="text-micro text-ink-3" title="No email either way since the mailbox sync was switched on">
        Not contacted
      </span>
    );

  const when = (
    <span className="flex items-center gap-1.5">
      <span className="text-micro text-ink-2">
        {last.date ? formatDate(last.date) : "Wrote to us first"}
      </span>
      {last.replied ? (
        <span className="text-micro font-medium" style={{ color: "var(--color-good)" }}>
          ✓ replied
        </span>
      ) : (
        <span className="text-micro text-ink-3">no reply</span>
      )}
    </span>
  );

  if (!last.dealId)
    return (
      <span className="flex flex-col gap-[1px] leading-tight" title="Not tied to a particular raise">
        {when}
        {last.sender && <span className="text-micro text-ink-3">{last.sender}</span>}
      </span>
    );

  return (
    <Link
      href={`/deals/${last.dealId}`}
      className="group flex flex-col gap-[1px] leading-tight"
      title={`Opens ${last.deal}`}
    >
      {when}
      <span className="text-micro text-accent group-hover:underline">
        {last.deal}
        {last.sender && <span className="text-ink-3"> · {last.sender}</span>}
      </span>
    </Link>
  );
}

/**
 * The same fact as a one-line value, for the record pages' signal row.
 *
 * "Not contacted", not "Never contacted". The difference matters because this
 * reads only what the mailbox sync has watched since it was switched on, while
 * the Ever replied tick beside it is five years of imported history — so the
 * two can honestly disagree, and the word "never" turned that into what looked
 * like a bug.
 */
export function lastContactValue(last?: LastContact | null): string {
  if (!last) return "Not contacted";
  if (!last.date) return `They wrote in ${formatDate(last.repliedDate)}`;
  return `${formatDate(last.date)} — ${last.replied ? `replied ${formatDate(last.repliedDate)}` : "no reply"}`;
}

/**
 * Who sent it and what it was about, under the signal.
 *
 * Where the raise is not known this still says who was in touch, because that
 * is the part a partner needs before emailing somebody a colleague already has.
 */
export function LastContactSub({ last }: { last?: LastContact | null }) {
  if (!last) return null;
  if (!last.dealId)
    return last.sender ? <span>with {last.sender}</span> : null;
  return (
    <span>
      <Link href={`/deals/${last.dealId}`} className="text-accent hover:underline">
        {last.deal}
      </Link>
      {last.sender && ` · sent by ${last.sender}`}
    </span>
  );
}
