import type { DealStatus, OutreachStatus } from "@/app/lib/types";

/**
 * Where the raise itself has got to.
 *
 * Complete is grey on purpose — it is the same "this is done, stop reading" the
 * greyed-out row on the deals list says, and the two have to agree.
 */
export function DealStatusChip({ status }: { status: DealStatus }) {
  const tone: Record<DealStatus, { bg: string; fg: string }> = {
    Live: { bg: "var(--color-good-bg)", fg: "var(--color-good)" },
    Complete: { bg: "var(--color-sunken)", fg: "var(--color-ink-3)" },
  };
  /* A row written before the statuses were cut down still has to render. The
     migration moves them, but a chip that throws on an unexpected word would
     take the whole page with it. */
  const t = tone[status] ?? tone.Complete;
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-[1px] text-micro font-semibold"
      style={{ background: t.bg, color: t.fg }}
    >
      {status}
    </span>
  );
}

/**
 * Where one person has got to on one deal.
 *
 * Drafted is deliberately distinct from Sent: a draft sits in someone's Outlook
 * and may never go, so counting it as contact would overstate the outreach.
 */
export function OutreachChip({ status }: { status: OutreachStatus }) {
  if (status === "Replied")
    return (
      <span className="text-micro font-medium" style={{ color: "var(--color-good)" }}>
        ✓ Replied
      </span>
    );
  if (status === "Sent") return <span className="text-micro text-ink-2">Sent</span>;
  if (status === "Drafted")
    return (
      <span className="text-micro font-medium" style={{ color: "var(--color-warn)" }}>
        Draft waiting
      </span>
    );
  return <span className="text-micro text-ink-3">Not contacted</span>;
}
