"use client";

import { useState, useTransition } from "react";
import { addToDeal, listDeals } from "@/app/lib/actions";
import type { Selection } from "@/app/lib/selection";
import type { Filters, RepliedFilter } from "@/app/lib/search";

/**
 * Tick-boxes, and what you can do with what you tick.
 *
 * The important behaviour is the second line of the bar. Ticking the header
 * box selects the fifty rows on screen; it then offers to select all 11,357
 * that match instead. Those are genuinely different things, and a list that
 * silently means one when a person expects the other is how the wrong people
 * get emailed.
 *
 * "Everything matching" is held as the SEARCH, not as eleven thousand ids —
 * see lib/selection.ts. The count shown is the real one either way.
 */

export interface SelectionContext {
  q: string;
  segment: string | null;
  filters: Filters;
  /** Contacts only. Carried so "select all matching" cannot resolve wider
      than the list the person was looking at. */
  replied?: RepliedFilter;
  /** Every row matching the current search, not just the page. */
  total: number;
  kind: "contacts" | "accounts";
}

export function useRowSelection(pageIds: string[], ctx: SelectionContext) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());

  const isTicked = (id: string) => (allMatching ? !unticked.has(id) : ticked.has(id));

  const toggle = (id: string) => {
    if (allMatching) {
      const next = new Set(unticked);
      if (next.has(id)) next.delete(id); else next.add(id);
      setUnticked(next);
    } else {
      const next = new Set(ticked);
      if (next.has(id)) next.delete(id); else next.add(id);
      setTicked(next);
    }
  };

  const count = allMatching ? ctx.total - unticked.size : ticked.size;
  const pageAllTicked = pageIds.length > 0 && pageIds.every(isTicked);

  const togglePage = () => {
    if (allMatching) { setAllMatching(false); setUnticked(new Set()); setTicked(new Set()); return; }
    setTicked(pageAllTicked ? new Set() : new Set(pageIds));
  };

  const selectAllMatching = () => { setAllMatching(true); setUnticked(new Set()); setTicked(new Set()); };
  const clear = () => { setAllMatching(false); setUnticked(new Set()); setTicked(new Set()); };

  const selection: Selection = allMatching
    ? { mode: "all", q: ctx.q, segment: ctx.segment, filters: ctx.filters,
        replied: ctx.replied ?? null, except: [...unticked] }
    : { mode: "ids", ids: [...ticked] };

  return { isTicked, toggle, count, pageAllTicked, togglePage, selectAllMatching, clear, allMatching, selection };
}

export function Tick({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      checked={on}
      onChange={onChange}
      aria-label={label}
      className="h-[15px] w-[15px] cursor-pointer accent-[var(--color-accent)] align-middle"
    />
  );
}

export function SelectionBar({
  count, total, allMatching, onClear, selection, kind,
}: {
  count: number;
  total: number;
  allMatching: boolean;
  onClear: () => void;
  selection: Selection;
  kind: "contacts" | "accounts";
}) {
  const [busy, startBusy] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [deals, setDeals] = useState<{ reference: string; title: string; people: number }[] | null>(null);
  const [picking, setPicking] = useState(false);

  const noun = kind === "contacts" ? "contact" : "account";

  function download() {
    startBusy(async () => {
      setNote(null);
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selection, kind }),
      });
      if (!res.ok) { setNote("The export failed."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? "export.csv";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function openDeals() {
    startBusy(async () => { setDeals(await listDeals()); setPicking(true); });
  }

  function add(ref: string) {
    startBusy(async () => {
      const r = await addToDeal(ref, selection);
      setNote(r.message);
      setPicking(false);
      if (r.ok) onClear();
    });
  }

  /* The bar stays up while there is something to report, even though adding
     people clears the selection that put it there.
     It used to vanish the instant the work succeeded, taking the confirmation
     with it — so the screen went back to a plain list of contacts and the only
     honest reading was that nothing had happened. */
  if (count === 0 && !note) return null;

  if (count === 0) {
    return (
      <div className="sticky top-0 z-20 mb-3 flex items-center gap-3 rounded-md border border-accent/30 bg-accent/[0.06] px-4 py-2.5">
        <p className="text-body text-ink">{note}</p>
        <button
          type="button"
          onClick={() => setNote(null)}
          className="ml-auto shrink-0 text-micro text-ink-2 hover:underline"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-20 mb-3 rounded-md border border-accent/30 bg-accent/[0.06] px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-body font-medium text-ink">
          {count.toLocaleString()} {noun}
          {count === 1 ? "" : "s"} selected
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button" disabled={busy} onClick={download}
            className="rounded-md border border-line bg-white px-3 py-1.5 text-micro font-medium text-ink hover:bg-sunken disabled:opacity-50"
          >
            Export to spreadsheet
          </button>
          {kind === "contacts" && (
            <button
              type="button" disabled={busy} onClick={openDeals}
              className="rounded-md bg-accent px-3 py-1.5 text-micro font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Add to a deal
            </button>
          )}
          <button type="button" onClick={onClear} className="text-micro text-ink-2 hover:underline">
            Clear
          </button>
        </div>
      </div>

      {allMatching && (
        <p className="mt-1.5 text-micro text-ink-2">
          All {total.toLocaleString()} matching {noun}s are selected, including ones not on this page.
        </p>
      )}

      {picking && (
        <div className="mt-3 rounded-md border border-line bg-white p-3">
          <p className="mb-2 text-micro text-ink-2">
            Adding people to a deal does not draft or send anything. Drafting is a separate step.
          </p>
          {deals && deals.length > 0 ? (
            <ul className="divide-y divide-line">
              {deals.map((d) => (
                <li key={d.reference} className="flex items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-body text-ink">{d.title}</span>
                  <span className="shrink-0 text-micro text-ink-3">{d.people.toLocaleString()} on it</span>
                  {/* Add and Cancel sit together. Cancel was on its own line under
                      the list, which put the way out a long way from the thing
                      you were deciding about. */}
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      type="button" disabled={busy} onClick={() => add(d.reference)}
                      className="rounded-md border border-line px-2.5 py-1 text-micro font-medium text-accent hover:bg-sunken disabled:opacity-50"
                    >
                      Add
                    </button>
                    <button
                      type="button" onClick={() => setPicking(false)}
                      className="rounded-md border border-line bg-white px-2.5 py-1 text-micro font-medium text-ink-2 hover:bg-sunken"
                    >
                      Cancel
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="text-body text-ink-2">
                There are no deals yet. A deal is created by uploading its document on the Deals page.
              </p>
              <button type="button" onClick={() => setPicking(false)} className="mt-2 text-micro text-ink-2 hover:underline">
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {note && <p className="mt-2 text-body text-ink">{note}</p>}
    </div>
  );
}
