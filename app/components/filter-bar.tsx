"use client";

import { useEffect, useRef, useState } from "react";
import type { FacetFilter, SegmentFacets, Selected } from "@/app/lib/types";

/**
 * Filters that change with the chosen segment.
 *
 * Every field a segment holds is filterable, including the thin ones — but
 * each option carries its count, and a filter covering less than half the
 * segment says so, because the failure mode here is silent: filter on AUM and
 * you get a short list with no sign that most investors were set aside for
 * having no figure rather than for being small.
 */

const THIN = 0.5; // below this share of the segment, warn

function Dropdown({
  filter,
  picked,
  total,
  onToggle,
  onClose,
}: {
  filter: FacetFilter;
  picked: string[];
  total: number;
  onToggle: (value: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — a panel you cannot dismiss reads as
  // a bug, and there are up to nine of these in a row.
  useEffect(() => {
    function away(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  // Locations run to a couple of hundred countries; a search box saves the scroll.
  const searchable = filter.options.length > 12;
  const shown = q.trim()
    ? filter.options.filter((o) => o.value.toLowerCase().includes(q.trim().toLowerCase()))
    : filter.options;

  const thin = total > 0 && filter.have / total < THIN;
  const setAside = total - filter.have;

  return (
    <div
      ref={ref}
      role="group"
      aria-label={filter.label}
      className="absolute left-0 top-full z-30 mt-1.5 w-[290px] overflow-hidden rounded-[8px] border border-line-strong bg-paper shadow-[0_8px_28px_rgba(16,32,64,.18)]"
    >
      {searchable && (
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${filter.label.toLowerCase()}…`}
          className="w-full border-b border-line bg-sunken px-3 py-2 text-[13px] outline-none placeholder:text-ink-3 focus:bg-paper"
        />
      )}

      <div className="max-h-[260px] overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-center text-micro text-ink-3">No match.</p>
        ) : (
          shown.map((o) => {
            const on = picked.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(o.value)}
                className="flex w-full items-center gap-2.5 border-b border-line px-3 py-[7px] text-left text-[13px] last:border-b-0 hover:bg-sunken"
              >
                <span
                  className={`flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border text-[9px] leading-none text-white ${
                    on ? "border-accent bg-accent" : "border-line-strong"
                  }`}
                >
                  {on ? "✓" : ""}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.value}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
                  {o.n.toLocaleString()}
                </span>
              </button>
            );
          })
        )}
      </div>

      {thin && (
        <p className="bg-warn-bg px-3 py-2 text-[11.5px] leading-[1.4] text-warn">
          We hold {filter.label.toLowerCase()} for {filter.have.toLocaleString()} of{" "}
          {total.toLocaleString()}. Filtering here sets the other{" "}
          {setAside.toLocaleString()} aside.
        </p>
      )}
    </div>
  );
}

export function FilterBar({
  facets,
  selected,
  onChange,
  onClearAll,
}: {
  /** Null until a segment is chosen — the filters depend on which one. */
  facets: SegmentFacets | null;
  selected: Selected;
  onChange: (next: Selected) => void;
  /** Clears every filter in one go — separate calls would be separate page
      loads. Ever replied is NOT one of these: it lives on its own column
      heading, where the answer it filters on is written. */
  onClearAll?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  // NB a segment change swaps the whole filter set, which would leave a stale
  // panel open. The parent remounts this component per segment (see the `key`
  // prop) rather than resetting state from an effect.
  const segmentFilters = facets?.filters ?? [];
  if (!segmentFilters.length) return null;

  function toggle(key: string, value: string) {
    const cur = selected[key] ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    const out = { ...selected };
    if (next.length) out[key] = next;
    else delete out[key];
    onChange(out);
  }

  const active = Object.entries(selected).filter(([, v]) => v.length);
  const activeCount = active.reduce((n, [, v]) => n + v.length, 0);
  const anyActive = active.length > 0;
  const labelFor = (key: string) => segmentFilters.find((f) => f.key === key)?.label ?? key;
  const clearAll = () => { if (onClearAll) onClearAll(); else onChange({}); };

  // A thin filter that is actually switched on: say what it excluded, up top,
  // where it cannot be missed.
  const segmentTotal = facets?.total ?? 0;
  const warnings = segmentTotal
    ? segmentFilters.filter((f) => (selected[f.key]?.length ?? 0) > 0 && f.have / segmentTotal < THIN)
    : [];

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-line-strong bg-paper px-3.5 py-3">
        <span className="mr-1 text-label uppercase tracking-wide text-ink-3">Filter</span>

        {segmentFilters.map((f) => {
          const picked = selected[f.key] ?? [];
          const on = picked.length > 0;
          return (
            <div key={f.key} className="relative">
              <button
                type="button"
                aria-expanded={open === f.key}
                onClick={() => setOpen(open === f.key ? null : f.key)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[6px] border px-2.5 py-[5px] text-[12.5px] transition-colors ${
                  on
                    ? "border-accent bg-accent font-semibold text-white"
                    : open === f.key
                      ? "border-accent bg-paper text-ink shadow-[0_0_0_2px_var(--color-accent-weak)]"
                      : "border-line-strong bg-paper text-ink-2 hover:border-ink-3"
                }`}
              >
                {f.label}
                {on && `: ${picked.length === 1 ? picked[0] : `${picked.length} picked`}`}
                <span className={`text-[8px] ${on ? "text-white/75" : "text-ink-3"}`}>▼</span>
              </button>

              {open === f.key && (
                <Dropdown
                  filter={f}
                  picked={picked}
                  total={segmentTotal}
                  onToggle={(v) => toggle(f.key, v)}
                  onClose={() => setOpen(null)}
                />
              )}
            </div>
          );
        })}

        {/* There WAS a Clear all here, as plain accent text pushed right by
            ml-auto — which put it at the end of whichever line the seven filter
            buttons happened to wrap onto, reading as a label rather than a
            control. It was reported as missing, which is the same as missing.
            Now bordered, counted, and repeated under the chips where the
            selections actually are. */}
        {anyActive && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-line-strong bg-paper px-2.5 py-[5px] text-[12.5px] font-medium text-ink-2 transition-colors hover:border-bad hover:text-bad"
          >
            Clear all
            <span className="text-[11px] opacity-70">✕</span>
          </button>
        )}
      </div>

      {anyActive && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {active.flatMap(([key, values]) =>
            values.map((v) => (
              <button
                key={`${key}:${v}`}
                type="button"
                onClick={() => toggle(key, v)}
                title={`Remove ${labelFor(key)}: ${v}`}
                className="inline-flex items-center gap-2 rounded-[6px] bg-accent-weak px-2.5 py-1 text-[12.5px] font-semibold text-accent hover:bg-accent hover:text-white"
              >
                {v}
                <span className="text-[11px] opacity-70">✕</span>
              </button>
            ))
          )}
          <button
            type="button"
            onClick={clearAll}
            className="text-[12px] font-medium text-ink-3 underline underline-offset-2 hover:text-bad"
          >
            Clear {activeCount === 1 ? "it" : `all ${activeCount}`}
          </button>
        </div>
      )}

      {warnings.map((f) => (
        <p
          key={f.key}
          className="mt-2.5 rounded-[7px] bg-warn-bg px-3.5 py-2.5 text-[12.5px] leading-[1.45] text-warn"
        >
          <strong className="font-semibold">
            {(segmentTotal - f.have).toLocaleString()} of {segmentTotal.toLocaleString()} have no{" "}
            {f.label.toLowerCase()} recorded and are not in this result.
          </strong>{" "}
          They are missing a value, which is not the same as failing the filter.
        </p>
      ))}
    </div>
  );
}
