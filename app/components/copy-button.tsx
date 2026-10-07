"use client";

import { useState } from "react";

/**
 * Copy a value to the clipboard.
 *
 * Two overlapping squares, the shape people already read as "copy", swapping
 * to a tick for a moment after it works. The label is announced to screen
 * readers rather than drawn, so the button stays a 26px square.
 */
export function CopyButton({ value, what = "email" }: { value: string; what?: string }) {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // a browser that refuses the clipboard should not throw at the user
    }
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={done ? `${what} copied` : `Copy ${what}`}
      title={done ? "Copied" : `Copy ${what}`}
      className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[5px] border border-line text-ink-3 transition-colors hover:border-line-strong hover:bg-sunken hover:text-ink-2"
    >
      {done ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[13px] w-[13px] text-good" aria-hidden>
          <path d="m5 12.5 4.5 4.5L19 7" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-[13px] w-[13px]" aria-hidden>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" />
        </svg>
      )}
    </button>
  );
}
