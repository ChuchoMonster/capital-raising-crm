"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { setDealStatus } from "@/app/lib/actions";
import { Button } from "./ui";
import type { DealStatus } from "@/app/lib/types";

/**
 * Draft an email, Export, and finish a deal.
 *
 * Export sends the deal's own contacts through the same route the list uses, so
 * the spreadsheet has the same columns wherever it came from.
 *
 * MARK COMPLETE IS NOT REMOVE, and sits well away from it for that reason —
 * removing a deal takes its contact list and the record of who was emailed on
 * it, completing one keeps every bit of that. It is reversible from the same
 * spot: a complete deal offers Reopen.
 */
export function DealActions(
  { dealRef, contactIds, status }: { dealRef: string; contactIds: string[]; status: DealStatus },
) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const done = status === "Complete";

  function move(to: DealStatus) {
    setNote(null);
    start(async () => {
      const r = await setDealStatus([dealRef], to);
      if (!r.ok) setNote(r.message);
      router.refresh();
    });
  }

  function download() {
    if (!contactIds.length) { setNote("Nobody is on this deal yet."); return; }
    setNote(null);
    start(async () => {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selection: { mode: "ids", ids: contactIds }, kind: "contacts" }),
      });
      if (!res.ok) { setNote("The export failed."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? `${dealRef}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {note && <span className="text-[12.5px] text-white/75">{note}</span>}
      {/* "Add contacts" stood here and only went to the contacts list, which
          is a click away in the top bar anyway (John, 2026-08-27). Matched
          Accounts is now the way people get onto a deal. */}
      {/* The primary action on a deal, once people are on it. A link rather
          than a button — it goes to a page of its own. */}
      <Link
        href={`/deals/${dealRef}/draft`}
        className="inline-flex items-center gap-1.5 rounded-[6px] bg-accent px-3 py-[7px] text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
      >
        Draft an email
      </Link>
      <Button onClick={download} disabled={busy}>{busy ? "Exporting…" : "Export"}</Button>
      {/* Last, and deliberately quiet. Finishing a raise is a once-per-deal
          action; it should not compete with the thing people come here to do. */}
      <button
        onClick={() => move(done ? "Live" : "Complete")}
        disabled={busy}
        title={done
          ? "Put this raise back on the live list. Replies to it start being checked again."
          : "Keep the deal and everything on it, but grey it out as finished. Replies to it stop being checked."}
        className="rounded-md border border-white/25 px-3 py-[7px] text-[13px] font-medium text-white transition-colors hover:bg-white/15 disabled:opacity-40"
      >
        {busy ? "Saving…" : done ? "Reopen" : "Mark complete"}
      </button>
    </div>
  );
}

/**
 * A write-up, broken where it should breathe.
 *
 * The drafting step returns one block of prose, and four or five sentences run
 * together is a wall nobody reads to the end of — which matters here, because
 * this text is what goes into the emails.
 *
 * Split on the model's own paragraph breaks when it left any; otherwise group
 * the sentences in pairs. Sentence splitting is deliberately conservative about
 * full stops that are not sentence ends — "US$45m." is, "A$1.2m" and "Inc." are
 * not, and breaking mid-figure would be worse than the wall.
 */
export function Paragraphs({ text }: { text: string }) {
  const paras = toParagraphs(text);
  return (
    <div className="flex max-w-[85ch] flex-col gap-3">
      {paras.map((p, i) => (
        <p key={i} className="text-body text-ink-2">{p}</p>
      ))}
    </div>
  );
}

function toParagraphs(text: string, per = 2): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];

  const given = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (given.length > 1) return given;

  /* Break after . ! or ? followed by a space and a capital — but not after a
     known abbreviation, and not where the full stop sits inside a number. */
  const ABBR = /(?:\b(?:Inc|Ltd|Plc|Corp|Co|No|Mt|Mr|Ms|Dr|St|Approx|Est|vs|e\.g|i\.e|U\.S|U\.K)\.)$/i;
  const out: string[] = [];
  let current: string[] = [];
  const parts = t.split(/(?<=[.!?])\s+(?=[A-Z(“"])/);

  for (const raw of parts) {
    const s = raw.trim();
    if (!s) continue;
    if (current.length && ABBR.test(current[current.length - 1])) {
      current[current.length - 1] += ` ${s}`;      // that stop ended an abbreviation
      continue;
    }
    current.push(s);
    if (current.length >= per) { out.push(current.join(" ")); current = []; }
  }
  if (current.length) {
    /* A single trailing sentence reads as an orphan; give it to the paragraph
       above rather than leaving it alone. */
    if (current.length === 1 && out.length) out[out.length - 1] += ` ${current[0]}`;
    else out.push(current.join(" "));
  }
  return out.length ? out : [t];
}
