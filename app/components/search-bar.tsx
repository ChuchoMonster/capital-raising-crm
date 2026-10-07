"use client";

import { useState } from "react";

/**
 * A plain search box. No typeahead dropdown.
 *
 * The dropdown used to overlay the list underneath it, and Enter opened the
 * top suggestion instead of running the search — so typing a name and pressing
 * Enter took you somewhere you had not asked to go. The list on the page is
 * the result surface; this only decides what it contains.
 *
 * Searching happens on Enter (or the button), not on every keystroke, so a
 * half-typed name never reshuffles the list under the cursor. Emptying the box
 * restores the full list immediately, because a filtered list behind an empty
 * box is the kind of thing people report as broken.
 */
export function SearchBar({
  placeholder,
  onSubmit,
  disabled,
  defaultValue = "",
}: {
  placeholder: string;
  onSubmit: (q: string) => void;
  disabled?: boolean;
  /** What is already being searched for. The results come from the server now,
      so on a fresh page load this is what keeps the box and the list agreeing. */
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [committed, setCommitted] = useState(defaultValue);

  /** Emptying the field resets the list without waiting for Enter. Handled on
   *  the change itself rather than in an effect, so the callback is never the
   *  stale one from a previous render. */
  function change(next: string) {
    setValue(next);
    if (next === "" && committed !== "") {
      setCommitted("");
      onSubmit("");
    }
  }

  function commit() {
    setCommitted(value);
    onSubmit(value.trim());
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      className="flex items-center gap-2"
      role="search"
    >
      <div className="flex flex-1 items-center gap-2.5 rounded-[8px] border border-line bg-paper px-3.5 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--color-accent-weak)]">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0 text-ink-3">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          value={value}
          onChange={(e) => change(e.target.value)}
          placeholder={disabled ? "Loading…" : placeholder}
          disabled={disabled}
          className="h-[42px] w-full bg-transparent text-body outline-none placeholder:text-ink-3"
          autoComplete="off"
          spellCheck={false}
          aria-label={placeholder}
        />
        {value && (
          <button
            type="button"
            onClick={() => change("")}
            className="shrink-0 text-ink-3 hover:text-ink"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* An explicit button, because "press Enter" is invisible. */}
      <button
        type="submit"
        disabled={disabled}
        className="h-[44px] shrink-0 rounded-[8px] bg-accent px-5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
      >
        Search
      </button>
    </form>
  );
}
