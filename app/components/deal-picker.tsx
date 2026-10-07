"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OutreachBoardRow } from "@/app/lib/store";

/**
 * Move between deals without going back to the board.
 *
 * Deliberately one deal at a time, matching the way Outreach is worked. It was
 * briefly multi-select; that was the wrong shape once the section became
 * deal-first, because "Arkveld and Morvane together" is not a list anybody
 * sends out — it is two separate pieces of work.
 *
 * The choice stays in the URL, so a filtered view is still something one
 * partner can send another.
 */
export function DealSwitcher({
  deals,
  current,
  status,
}: {
  deals: OutreachBoardRow[];
  current: string;
  status?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function away(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  function go(reference: string) {
    const p = new URLSearchParams({ deal: reference });
    /* The status filter travels with you. Chasing replies on one raise and
       then switching deal is the same job, not a new one. */
    if (status) p.set("status", status);
    router.push(`/outreach?${p}`);
  }

  const searchable = deals.length > 12;
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const live = deals.filter((d) => d.live || d.reference === current);
    return t ? live.filter((d) => d.title.toLowerCase().includes(t)) : live;
  }, [deals, q, current]);

  const title = deals.find((d) => d.reference === current)?.title ?? "Deal";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[6px] border px-3 py-[5px] text-[13px] font-semibold transition-colors ${
          open
            ? "border-accent bg-paper text-ink shadow-[0_0_0_2px_var(--color-accent-weak)]"
            : "border-line-strong bg-paper text-ink hover:border-ink-3"
        }`}
      >
        <span className="max-w-[240px] truncate">{title}</span>
        <span className="text-[8px] text-ink-3">▼</span>
      </button>

      {open && (
        <div
          role="group"
          aria-label="Switch deal"
          className="absolute left-0 top-full z-30 mt-1.5 w-[300px] overflow-hidden rounded-[8px] border border-line-strong bg-paper shadow-[0_8px_28px_rgba(16,32,64,.18)]"
        >
          {searchable && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search deals…"
              className="w-full border-b border-line bg-sunken px-3 py-2 text-[13px] outline-none placeholder:text-ink-3 focus:bg-paper"
            />
          )}

          <div className="max-h-[280px] overflow-y-auto">
            {shown.length === 0 ? (
              <p className="px-3 py-4 text-center text-micro text-ink-3">No match.</p>
            ) : (
              shown.map((d) => {
                const on = d.reference === current;
                return (
                  <button
                    key={d.reference}
                    type="button"
                    onClick={() => (on ? setOpen(false) : go(d.reference))}
                    className={`flex w-full items-center gap-2.5 border-b border-line px-3 py-[7px] text-left text-[13px] last:border-b-0 hover:bg-sunken ${
                      on ? "bg-accent-weak font-semibold text-accent" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    {/* How many are on that deal, so the size of the next piece
                        of work is visible without leaving this one. */}
                    {d.people > 0 && (
                      <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
                        {d.people.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
