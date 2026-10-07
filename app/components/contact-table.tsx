"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { backParam } from "@/app/lib/back-link";
import { useSetParams } from "./list-controls";
import type { RepliedFilter } from "@/app/lib/search";

import Link from "next/link";
import { SegmentChip, StatusChip, RepliedChip, Panel, TableHead } from "./ui";
import { Tick, SelectionBar, useRowSelection, type SelectionContext } from "./selectable-list";
import type { ContactRow } from "@/app/lib/search";

/**
 * The "Ever replied?" heading, which is also the filter.
 *
 * It was a chip in the filter bar at the top of the page. The client's
 * objection, and it is right: the answer is written down this column, so the
 * way to narrow on it belongs at the top of the column and nowhere else.
 *
 * Unlike every other filter here it survives changing tab, because it is true
 * of everybody — an investor and a mining company both either wrote back or
 * did not — so it has its own key in the address bar rather than sitting with
 * the segment's own fields, which are cleared on the way out of a segment.
 */
const OPTIONS: { value: RepliedFilter; label: string }[] = [
  { value: null, label: "All" },
  { value: "yes", label: "Has replied" },
  { value: "no", label: "Never replied" },
];

function RepliedHeading({ value }: { value: RepliedFilter }) {
  const setParams = useSetParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  const on = value === "yes" || value === "no";
  const shown = OPTIONS.find((o) => o.value === (value ?? null)) ?? OPTIONS[0];

  return (
    <div ref={ref} className="relative inline-block text-right">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Filter by whether they have ever replied"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-[2px] text-label font-semibold uppercase tracking-wide transition-colors hover:bg-white/15 ${
          on ? "bg-white/20" : ""
        }`}
      >
        {on ? shown.label : "Ever replied?"}
        <span className="text-[8px] opacity-70">▼</span>
      </button>

      {open && (
        /* Hung from the right edge — this is the last column, and a panel
           opening leftward would run off the page. */
        <div
          role="radiogroup"
          aria-label="Ever replied?"
          className="absolute right-0 top-full z-30 mt-1 w-[170px] overflow-hidden rounded-[8px] border border-line-strong bg-paper text-left shadow-[0_8px_28px_rgba(16,32,64,.18)]"
        >
          {OPTIONS.map((o) => {
            const picked = (value ?? null) === o.value;
            return (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={picked}
                onClick={() => { setOpen(false); setParams({ replied: o.value }); }}
                className="flex w-full items-center gap-2.5 border-b border-line px-3 py-[7px] text-left text-[13px] normal-case tracking-normal text-ink last:border-b-0 hover:bg-sunken"
              >
                <span
                  className={`flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border text-[9px] leading-none text-white ${
                    picked ? "border-accent bg-accent" : "border-line-strong"
                  }`}
                >
                  {picked ? "•" : ""}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The contacts table, with tick-boxes.
 *
 * A client component because ticking is state, but it receives the rows as
 * props rather than fetching them: the fifty rows on screen are already in the
 * page, and nothing beyond them reaches the browser.
 */
export function ContactTable({ rows, total, ctx }: {
  rows: ContactRow[];
  total: number;
  ctx: SelectionContext;
}) {
  const sel = useRowSelection(rows.map((r) => r.id), ctx);
  /* Carried onto every row so a record page can send you back to this exact
     list — the search and filters you used to find them, not a bare index. */
  const back = backParam(useSearchParams().toString());

  return (
    <>
      <SelectionBar
        count={sel.count} total={total} allMatching={sel.allMatching} onClear={sel.clear}
        selection={sel.selection} kind="contacts"
      />
      <Panel bodyClass="">
        <table className="w-full text-table">
          <TableHead
            tight
            cols={[
              { label: <Tick on={sel.pageAllTicked} onChange={sel.togglePage} label="Select this page" />, width: "36px" },
              /* Job title sits with the name, before the firm: it is what
                 tells a partner whether this is the person who decides. */
              "Name", "Job title", "Company", "Segment", "Email",
              /* Last, and a word rather than a tick: "has replied" and "never
                 replied" are the difference between a relationship and a
                 one-way pitch. The heading is the filter — see above. */
              { label: <RepliedHeading value={ctx.replied ?? null} />, align: "right" },
            ]}
          />
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`${i % 2 ? "bg-sunken/50" : ""} ${sel.isTicked(r.id) ? "bg-accent/[0.07]" : ""}`}>
                <td className="px-3 py-[8px]">
                  <Tick on={sel.isTicked(r.id)} onChange={() => sel.toggle(r.id)} label={`Select ${r.name ?? r.email}`} />
                </td>
                <td className="px-3 py-[8px]">
                  <Link href={`/contacts/${r.id}${back}`} className="inline-flex items-center gap-2 font-medium text-accent hover:underline">
                    <StatusChip status={r.status ?? ""} bare />
                    {r.name ?? r.email}
                  </Link>
                </td>
                <td className="max-w-[190px] truncate px-3 py-[8px] text-ink-2" title={r.jobTitle ?? ""}>
                  {r.jobTitle || <span className="text-ink-3">—</span>}
                </td>
                {/* A company row only exists for a firm we hold. Someone on a
                    personal address has none, so it reads as plain text rather
                    than a link that goes nowhere. */}
                <td className="px-3 py-[8px] text-ink-2">
                  {r.companyId ? (
                    <Link href={`/accounts/${r.companyId}${back}`} className="text-accent hover:underline">{r.company}</Link>
                  ) : r.company}
                </td>
                <td className="px-3 py-[8px]"><SegmentChip segment={r.segment} /></td>
                <td className="px-3 py-[8px] font-mono text-[12px] text-ink-2">{r.email}</td>
                <td className="px-3 py-[8px] text-right"><RepliedChip replied={r.replied} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
