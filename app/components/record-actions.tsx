"use client";

import { useState, useTransition } from "react";
import { addToDeal, listDeals } from "@/app/lib/actions";
import { Button } from "./ui";
import type { Selection } from "@/app/lib/selection";

/**
 * Add to deal, and Export, for ONE record.
 *
 * These two buttons sat on every contact and account page since the pages were
 * built and did nothing at all — no handler, no message, no explanation. They
 * are the same two actions the selection bar offers on a list; the only
 * difference is that the selection here is a single id rather than a set of
 * ticks, so both call exactly the same server action and the same export route.
 * Two implementations of "add to deal" would eventually disagree about what it
 * means.
 */
export function RecordActions({ id, kind, canAddToDeal = true }: {
  id: string;
  kind: "contacts" | "accounts";
  /* An account page passes false. A deal's list is people, never firms — to
     put a whole firm on a deal you tick its people. */
  canAddToDeal?: boolean;
}) {
  const [busy, start] = useTransition();
  const [deals, setDeals] = useState<{ reference: string; title: string; people: number }[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const selection: Selection = { mode: "ids", ids: [id] };

  function openDeals() {
    start(async () => {
      const list = await listDeals();
      setDeals(list);
      setPicking(true);
      /* An empty deal list is the common case today and looks like a broken
         menu. Say what is actually true instead of opening nothing. */
      if (!list.length) { setPicking(false); setNote("There are no deals yet. Upload one first."); }
    });
  }

  function add(ref: string) {
    start(async () => {
      const r = await addToDeal(ref, selection);
      setNote(r.message);
      setPicking(false);
    });
  }

  function download() {
    start(async () => {
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

  return (
    <div className="relative flex items-center gap-2">
      {note && (
        <span className="max-w-[38ch] text-right text-[12.5px] leading-[1.4] text-white/75">{note}</span>
      )}
      {canAddToDeal && (
        <Button variant="primary" onClick={openDeals} disabled={busy}>
          {busy && !picking ? "…" : "Add to deal"}
        </Button>
      )}
      <Button onClick={download} disabled={busy}>Export</Button>

      {picking && deals && (
        <>
          {/* Clicking anywhere else closes it. Without this the only way out of
              the menu is to pick a deal, which is not a way out. */}
          <button
            type="button" aria-label="Close" onClick={() => setPicking(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-[300px] overflow-hidden rounded-md border border-line bg-white shadow-lg">
            <p className="border-b border-line px-3 py-2 text-micro font-medium text-ink-2">Add to which deal?</p>
            <ul className="max-h-[280px] overflow-y-auto">
              {deals.map((d) => (
                <li key={d.reference}>
                  <button
                    type="button" disabled={busy} onClick={() => add(d.reference)}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-sunken disabled:opacity-50"
                  >
                    <span className="truncate text-[13.5px] text-ink">{d.title}</span>
                    <span className="shrink-0 text-micro text-ink-3">{d.people}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
