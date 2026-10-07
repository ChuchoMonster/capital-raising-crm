"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordVerdict } from "@/app/lib/deal/verdict-actions";

/**
 * What the firm said, and how to change it.
 *
 * ON A PERSON'S ROW, ABOUT THEIR FIRM. That looks like a mismatch and is the
 * point: if an analyst at Tarnwick passes, every Tarnwick person on this list shows
 * it, because the mistake this exists to stop is emailing their colleague the
 * next morning.
 *
 * The evidence sits under the verdict the way the email address sits under the
 * name — their own sentence when it was read from a reply, or whose word it is
 * when somebody typed it. A verdict nobody can check is a rumour.
 */
export function VerdictCell({
  dealRef,
  accountId,
  company,
  verdict,
  evidence,
  source,
}: {
  dealRef: string;
  accountId: string | null;
  company: string;
  verdict: "Accepted" | "Passed" | null;
  evidence: string;
  source: "email" | "manual" | null;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);

  /* A person with no firm has nothing to hold a verdict — it belongs to the
     house, and there is no house. */
  if (!accountId) return <span className="text-micro text-ink-3">—</span>;

  const set = (v: "Accepted" | "Passed" | "Open") =>
    start(async () => {
      setOpen(false);
      await recordVerdict({ dealRef, accountId, verdict: v });
      router.refresh();
    });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={busy}
        className={`rounded-full px-2 py-[2px] text-[11.5px] font-medium transition-colors disabled:opacity-50 ${
          verdict === "Accepted"
            ? "bg-[var(--color-good-bg)] text-[var(--color-good)] hover:brightness-95"
            : verdict === "Passed"
              ? "bg-[var(--color-bad-bg)] text-[var(--color-bad)] hover:brightness-95"
              : "border border-line text-ink-3 hover:bg-sunken"
        }`}
        title={evidence || undefined}
      >
        {verdict ?? "Open"}
      </button>

      {/* The sentence it rests on. Truncated to one line here; the whole of it
          is on hover, because a table row cannot hold a paragraph. */}
      {verdict && evidence && (
        <p className="mt-[3px] max-w-[220px] truncate text-[11px] leading-[1.35] text-ink-3" title={evidence}>
          {source === "email" ? `“${evidence}”` : evidence}
        </p>
      )}

      {open && (
        <>
          {/* Clicking anywhere else closes it. */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 top-[24px] z-20 flex min-w-[150px] flex-col overflow-hidden rounded-[7px] border border-line bg-paper shadow-lg">
            <p className="border-b border-line px-3 py-1.5 text-[11px] leading-[1.3] text-ink-3">
              {company || "this firm"}
            </p>
            {(["Accepted", "Passed", "Open"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => set(v)}
                className={`px-3 py-[6px] text-left text-[12.5px] transition-colors hover:bg-sunken ${
                  (verdict ?? "Open") === v ? "font-semibold text-ink" : "text-ink-2"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
