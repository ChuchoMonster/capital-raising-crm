"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDeals, setDealStatus } from "@/app/lib/actions";
import { Panel, TableHead, Button } from "./ui";
import { DealStatusChip } from "./deal-bits";
import { Tick } from "./selectable-list";
import type { DealStatus } from "@/app/lib/types";

/**
 * The deals list, with tick-boxes so a deal can be removed.
 *
 * Removing is deliberately two steps. A deal carries its contact list and the
 * record of who was emailed on it, and the cascade takes all of that with it —
 * so the confirmation names the deals rather than counting them, and says what
 * else goes. The mailbox ledger is untouched: those emails still happened.
 *
 * MARKING COMPLETE IS ONE STEP, because it takes nothing away and can be undone
 * from the same button. That asymmetry is the point: a finished raise used to
 * have nowhere to go but deletion, so the record of who was emailed on it was
 * destroyed to get it off the list.
 *
 * A complete row greys out and STAYS USABLE — it opens, it ticks, it removes.
 * Dimming is how you see the raise is done, not a way of putting it out of reach.
 */

export interface DealRow {
  id: string;
  name: string;
  sector: string;
  countries: string;
  raising: string;
  status: DealStatus;
  people: number;
  sent: number;
  replied: number;
}

export function DealTable({ rows }: { rows: DealRow[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const chosen = rows.filter((r) => picked.has(r.id));
  const people = chosen.reduce((n, r) => n + r.people, 0);
  const sent = chosen.reduce((n, r) => n + r.sent, 0);

  function toggle(id: string) {
    setNote(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  /* Every chosen deal is live, or every one is complete. Neither is true of an
     empty selection, so both buttons stay hidden until something is ticked. */
  const allLive = chosen.length > 0 && chosen.every((r) => r.status === "Live");
  const allComplete = chosen.length > 0 && chosen.every((r) => r.status === "Complete");

  function move(status: DealStatus) {
    start(async () => {
      const r = await setDealStatus([...picked], status);
      setNote(r.message);
      setPicked(new Set());
      router.refresh();
    });
  }

  function remove() {
    start(async () => {
      const r = await deleteDeals([...picked]);
      setNote(r.message);
      setPicked(new Set());
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <>
      {(picked.size > 0 || note) && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[9px] border border-line bg-sunken px-4 py-3">
          {note && <span className="text-[13px] text-ink-2">{note}</span>}
          {picked.size > 0 && !confirming && (
            <>
              <span className="text-[13.5px] font-medium text-ink">
                {picked.size} {picked.size === 1 ? "deal" : "deals"} selected
              </span>
              <span className="ml-auto flex items-center gap-2">
                <Button onClick={() => { setPicked(new Set()); setNote(null); }}>Clear</Button>
                {/* Offered only when every selected deal is going the same way.
                    A mixed selection has no honest single label, and a button
                    that silently completes some rows and reopens others is how
                    somebody reopens a raise they meant to leave alone. */}
                {allLive && (
                  <Button onClick={() => move("Complete")} disabled={busy}>
                    {busy ? "Saving…" : "Mark complete"}
                  </Button>
                )}
                {allComplete && (
                  <Button onClick={() => move("Live")} disabled={busy}>
                    {busy ? "Saving…" : "Reopen"}
                  </Button>
                )}
                <Button onClick={() => setConfirming(true)}>Remove</Button>
              </span>
            </>
          )}
          {confirming && (
            <>
              {/* What actually disappears, in the words of the thing being
                  lost. A count of deals hides that a contact list and an
                  outreach history go with them. */}
              <span className="text-[13.5px] leading-[1.5] text-ink">
                Remove {chosen.map((c) => c.name).join(", ")}?
                {people > 0 && ` Their list of ${people.toLocaleString()} ${people === 1 ? "contact" : "contacts"} goes too`}
                {sent > 0 && `, including the record of ${sent.toLocaleString()} already emailed`}
                {people > 0 && ". The emails themselves stay in the mailbox history."}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <Button onClick={() => setConfirming(false)}>Keep them</Button>
                <Button variant="primary" onClick={remove} disabled={busy}>
                  {busy ? "Removing…" : "Yes, remove"}
                </Button>
              </span>
            </>
          )}
        </div>
      )}

      <Panel bodyClass="">
        <table className="w-full text-table">
          {/* Widths are set here because two of these fields are written by
              the extractor and can be a whole sentence. Morvane's "raising"
              runs to 130 characters, and with the old nowrap it pushed status
              and the three counts clean off the right of the page — they were
              rendering, just not on screen. */}
          <TableHead
            cols={[
              { label: "", width: "36px" },
              { label: "Deal", width: "22%" },
              { label: "Sector & countries", width: "26%" },
              { label: "Raising", width: "24%" },
              { label: "Status", width: "90px" },
              { label: "Contacts", align: "right", width: "80px" },
              { label: "Emailed", align: "right", width: "80px" },
              { label: "Replied", align: "right", width: "80px" },
            ]}
          />
          <tbody>
            {rows.map((d, i) => (
              <tr
                key={d.id}
                /* A complete deal is dimmed, not hidden and not disabled — the
                   tick box, the link and Remove all still work on it. The
                   selected tint wins over the dimming so a ticked complete row
                   is still obviously ticked. */
                className={`${i % 2 ? "bg-sunken/50" : ""} ${picked.has(d.id) ? "bg-accent/[0.07]" : ""} ${
                  d.status === "Complete" && !picked.has(d.id) ? "opacity-55" : ""
                }`}
              >
                <td className="px-4 py-[8px] align-top">
                  <Tick on={picked.has(d.id)} onChange={() => toggle(d.id)} label={`Select ${d.name}`} />
                </td>
                <td className="px-4 py-[8px] align-top">
                  <Link href={`/deals/${d.id}`} className="font-medium text-accent hover:underline">
                    {d.name}
                  </Link>
                </td>
                {/* Two lines each, with the whole value on hover. A deal is
                    identified by its name; the sector and the raise are here
                    to glance at, not to read in full. */}
                <td className="px-4 py-[8px] align-top text-ink-2">
                  <span className="line-clamp-2" title={[d.sector, d.countries].filter(Boolean).join(" · ")}>
                    {[d.sector, d.countries].filter(Boolean).join(" · ")}
                  </span>
                </td>
                <td className="px-4 py-[8px] align-top text-ink-2">
                  <span className="line-clamp-2" title={d.raising}>{d.raising}</span>
                </td>
                <td className="px-4 py-[8px] align-top"><DealStatusChip status={d.status} /></td>
                <td className="px-4 py-[8px] text-right align-top tabular-nums text-ink-2">{d.people || "—"}</td>
                <td className="px-4 py-[8px] text-right align-top tabular-nums text-ink-2">{d.sent || "—"}</td>
                <td className="px-4 py-[8px] text-right align-top tabular-nums">
                  {d.replied
                    ? <span style={{ color: "var(--color-good)" }}>{d.replied}</span>
                    : <span className="text-ink-3">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
          <span className="text-micro text-ink-2">
            Showing {rows.length} of {rows.length}
          </span>
        </div>
      </Panel>
    </>
  );
}
