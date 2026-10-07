"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { SegmentCards, type SegmentDef } from "./segment-cards";
import { SearchBar } from "./search-bar";
import { FilterBar } from "./filter-bar";
import type { FacetFilter, Selected } from "@/app/lib/types";

/**
 * The controls, and only the controls.
 *
 * Everything these do ends up in the address bar, and the server reads it from
 * there. That is deliberate rather than incidental:
 *  - the results are rendered on the server, so no contact data has to be sent
 *    to the browser to be filtered there — which is what the old version did,
 *    and what made the whole list readable by anyone who knew the address;
 *  - a filtered view can be sent to a colleague as a link;
 *  - the back button behaves the way people expect.
 */

/**
 * Put a change in the address bar and let the server re-render.
 *
 * Exported because the contacts table's "Ever replied?" heading is a filter
 * too, and it must write to the same place these controls do — or the two
 * would fight over the address and each would undo the other.
 */
export function useSetParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  return useCallback(
    (changes: Record<string, string | string[] | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        next.delete(k);
        if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
        else if (v !== null && v !== "") next.set(k, v);
      }
      /* Any change starts at the top. Staying on page 12 of a list that has
         just been re-filtered shows an empty table and reads as a bug.
         UNLESS the change IS the page: this reset ran unconditionally, so
         "Show the next 50" set page=2 and then deleted it on the same line.
         The button did nothing at all, and looked like it was ignoring clicks. */
      if (!("page" in changes)) next.delete("page");
      startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
    },
    [params, pathname, router],
  );
}

export function SegmentPicker({ segments, active, counts }: {
  segments: SegmentDef[];
  active: string | null;
  counts: Record<string, number>;
}) {
  const setParams = useSetParams();
  return (
    <SegmentCards
      segments={segments}
      active={active}
      counts={counts}
      // Leaving a segment drops its filters: an investor's AUM band means
      // nothing on a mining company.
      onChange={(s) => setParams({ segment: s, ...Object.fromEntries(FILTER_KEYS.map((k) => [`f.${k}`, null])) })}
    />
  );
}

const FILTER_KEYS = ["country", "type", "sector", "commodity", "aum", "via", "invests_in", "stage", "project"];

/**
 * The three set-aside buckets. Same cards, a different address-bar key.
 *
 * It reuses SegmentCards rather than SegmentPicker because a segment carries
 * filters and a bucket does not — clearing filters that were never set would
 * be nine wasted keys in the URL of every click.
 */
export function BucketPicker({ buckets, active, counts }: {
  buckets: SegmentDef[];
  active: string | null;
  counts: Record<string, number>;
}) {
  const setParams = useSetParams();
  return (
    <SegmentCards
      segments={buckets}
      active={active}
      counts={counts}
      onChange={(b) => setParams({ bucket: b })}
    />
  );
}

export function Filters({ facets, selected }: {
  facets: { total: number; filters: FacetFilter[] } | null;
  selected: Selected;
}) {
  const setParams = useSetParams();
  const clearSegmentFilters = Object.fromEntries(FILTER_KEYS.map((k) => [`f.${k}`, null]));
  return (
    <FilterBar
      facets={facets}
      selected={selected}
      onChange={(next) =>
        setParams(Object.fromEntries(FILTER_KEYS.map((k) => [`f.${k}`, next[k]?.length ? next[k] : null])))
      }
      onClearAll={() => setParams({ ...clearSegmentFilters, replied: null })}
    />
  );
}

export function Search({ initial, placeholder }: { initial: string; placeholder: string }) {
  const setParams = useSetParams();
  const [value, setValue] = useState(initial);
  return (
    <SearchBar
      key={initial}
      defaultValue={value}
      placeholder={placeholder}
      onSubmit={(q: string) => { setValue(q); setParams({ q: q || null }); }}
    />
  );
}

/** Next page. A link, not a button, so it works before JavaScript loads. */
export function More({ page, remaining }: { page: number; remaining: number }) {
  const setParams = useSetParams();
  return (
    <button
      type="button"
      onClick={() => setParams({ page: String(page + 1) })}
      className="rounded-md border border-line px-3 py-1.5 text-micro font-medium text-ink hover:bg-sunken"
    >
      Show the next {remaining.toLocaleString()}
    </button>
  );
}
