"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { OutreachBoardRow } from "@/app/lib/store";
import { DealStatusChip } from "./deal-bits";

/**
 * Which raise are you working on?
 *
 * Outreach opens here rather than on every person on every deal. Halden Ridge works one
 * raise at a time, and at a hundred deals a combined list is not a screen
 * anybody reads — but a board of what is outstanding per deal is worth opening
 * first thing.
 *
 * The deal's name sits in a tab above its card. It is the thing being chosen,
 * so it reads as a label on the card rather than the first line inside it.
 *
 * Closed deals are behind a link because they are not work. They are not
 * dropped: a closed raise still holds who was pitched, and that is the record.
 */
export function OutreachBoard({ deals }: { deals: OutreachBoardRow[] }) {
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const closed = deals.filter((d) => !d.live);
  const pool = showClosed ? deals : deals.filter((d) => d.live);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? pool.filter((d) => d.title.toLowerCase().includes(t)) : pool;
  }, [pool, q]);

  // Searching earns its place once scrolling costs more than typing.
  const searchable = deals.length > 20;
  const controls = searchable || closed.length > 0;

  return (
    <div>
      {controls && (
        <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
          {searchable && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search deals…"
              className="w-[220px] rounded-[6px] border border-line-strong bg-paper px-3 py-[5px] text-[13px] outline-none placeholder:text-ink-3 focus:border-accent"
            />
          )}
          {closed.length > 0 && (
            <button
              type="button"
              onClick={() => setShowClosed(!showClosed)}
              className="text-micro font-medium text-ink-3 underline underline-offset-2 hover:text-accent"
            >
              {showClosed ? "Hide closed" : `Show closed (${closed.length})`}
            </button>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-[8px] border border-head-line bg-paper px-5 py-8 text-center text-body text-ink-2">
          {q.trim()
            ? "No deal matches that."
            : deals.length === 0
              ? "No deals yet. Upload one from the Deals section, then build its list from Contacts."
              : "No live deals. Show closed to see finished raises."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((d) => (
            <Link key={d.reference} href={`/outreach?deal=${encodeURIComponent(d.reference)}`} className="group block">
              {/* The tab. Bottom border dropped so it joins the card below it. */}
              <div className="flex items-end gap-2">
                <span className="max-w-full truncate rounded-t-[8px] border border-b-0 border-head-line bg-paper px-3.5 py-[7px] text-[14px] font-semibold text-ink transition-colors group-hover:border-accent group-hover:text-accent">
                  {d.title}
                </span>
                <span className="pb-[6px]">
                  <DealStatusChip status={d.status} />
                </span>
              </div>

              <div className="-mt-px rounded-[8px] rounded-tl-none border border-head-line bg-paper px-4 py-3.5 transition-colors group-hover:border-accent group-hover:bg-sunken/40">
                {d.people === 0 ? (
                  <p className="text-micro text-ink-3">
                    Nobody on this list yet — add people from Contacts.
                  </p>
                ) : (
                  /* On the list, emailed, replied — each one a subset of the
                     one before it, so the card reads left to right as how far
                     the raise has got. */
                  <div className="flex items-center gap-5">
                    <Count label="Contacts" value={d.people} />
                    <Count label="Sent" value={d.sent} />
                    <Count label="Replied" value={d.replied} tone={d.replied ? "good" : undefined} />
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  const color =
    tone === "good" ? "var(--color-good)" : tone === "warn" ? "var(--color-warn)" : "var(--color-ink)";
  return (
    <div>
      <div
        className="text-[19px] font-semibold leading-none tabular-nums"
        style={{ color: value ? color : "var(--color-ink-3)" }}
      >
        {value}
      </div>
      <div className="mt-1 text-label uppercase tracking-wide text-ink-3">{label}</div>
    </div>
  );
}
