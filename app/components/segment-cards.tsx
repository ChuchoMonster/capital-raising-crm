"use client";

import type { ReactNode } from "react";

/**
 * The tab filters, as cards over the hero image.
 *
 * Exactly one can be active at a time — clicking the active one clears it and
 * returns to the full list. They are filters, not links: nothing navigates.
 *
 * THREE ACROSS, not four. With six tabs, four across leaves a widowed pair on
 * the second row and breaks the grouping that makes the set readable: the top
 * row is the three kinds of buyer — a fund, a family, a person — and the
 * bottom row is everybody else. Four columns would put a family office beside
 * a government ministry and split the buyers across two rows.
 *
 * The set-aside buckets reuse this component and there are three of them, so
 * they fill their single row exactly.
 */

export interface SegmentDef {
  /** The value stored in the data's Segment column. */
  id: string;
  label: string;
  blurb: string;
  icon: ReactNode;
}

export function SegmentCards({
  segments,
  active,
  counts,
  onChange,
}: {
  segments: SegmentDef[];
  active: string | null;
  counts: Record<string, number>;
  onChange: (id: string | null) => void;
}) {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      role="group"
      aria-label="Filter by segment"
    >
      {segments.map((s) => {
        const on = active === s.id;
        const n = counts[s.id] ?? 0;
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : s.id)}
            className={`group flex flex-col rounded-[9px] border p-4 text-left transition-all ${
              on
                ? "border-accent bg-accent shadow-[0_6px_20px_rgba(40,116,252,.4)]"
                : "border-white/12 bg-[rgba(8,14,26,0.82)] hover:-translate-y-0.5 hover:border-white/35 hover:bg-[rgba(12,20,36,0.9)]"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] ${
                  on ? "bg-white/20 text-white" : "bg-accent text-white"
                }`}
              >
                {s.icon}
              </span>
              <span className="text-[15px] font-medium text-white">{s.label}</span>
              {on && <span className="ml-auto text-[13px] text-white/80">✕</span>}
            </div>
            <p className="mt-2.5 text-[12px] leading-[1.45] text-white/60">{s.blurb}</p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/45">
              {n.toLocaleString()}
            </p>
          </button>
        );
      })}
    </div>
  );
}
