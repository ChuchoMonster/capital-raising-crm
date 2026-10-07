"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addToDeal, removeMatchedAccount, restoreMatchedAccount } from "@/app/lib/actions";
import { Button, RepliedChip, TableHead } from "./ui";
import { FilterBar } from "./filter-bar";
import type { SegmentFacets, Selected } from "@/app/lib/types";
import type { TierFirm } from "@/app/lib/tiering";

/**
 * The firms this deal should go to, as a grid you open one card at a time.
 *
 * The shape is the point. Halden Ridge looks at the FIRM first — is this the right
 * house — and only then at who they know there. So the grid is firms, and a
 * card opens in place to show its people rather than navigating away, because
 * the next thing they do is look at the firm beside it.
 *
 * Nobody is ticked for them. An earlier version pre-selected whoever had
 * replied before; the client's objection was that sometimes the point is to
 * reach somebody NEW at a firm they already know, and a default that quietly
 * picks the familiar name hides exactly that case. The reply history is shown
 * on every row instead, which informs the choice without making it.
 */

/* The Investors tab's filters, same keys, same labels, same order. Anything
   that reads differently here would be a second answer to the same question. */
const FILTERS = [
  { key: "type", label: "Investor type" },
  { key: "sector", label: "Invests in" },
  { key: "commodity", label: "Commodity" },
  { key: "aum", label: "AUM" },
  { key: "via", label: "Investment type" },
  { key: "invests_in", label: "Invests in country" },
  { key: "country", label: "Based in" },
];

const TIERS = [
  { n: 1 as const, label: "Tier 1", blurb: "Everything we check, checks out." },
  { n: 2 as const, label: "Tier 2", blurb: "One thing we have never established." },
  { n: 3 as const, label: "Tier 3", blurb: "Two or more things unestablished." },
];

export function TargetGrid({ dealRef, firms, removed }: {
  dealRef: string; firms: TierFirm[];
  /** Firms ruled out of this deal by hand, offered back in the dropdown. */
  removed: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tier, setTier] = useState<1 | 2 | 3>(1);
  const [picks, setPicks] = useState<Selected>({});
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  /**
   * Firms, or the people at them.
   *
   * The same list read two ways rather than two lists. Halden Ridge looks at the FIRM
   * first — is this the right house — and then at who they know there, which
   * is why firms is the default. But once the houses are agreed the question
   * becomes "who do I write to", and answering that by opening 113 cards one
   * at a time is not answering it.
   *
   * Everything else is shared deliberately: the same tiers, the same filters,
   * the same selection, the same Add button. A second page would have had to
   * reproduce all four and could then disagree with this one.
   */
  const [view, setView] = useState<"firms" | "people">("firms");

  /* Options are counted over EVERY firm on the deal, not the tier on screen,
     so choosing "Venture Capital" does not make the option vanish from the
     tier you switch to next. */
  const facets: SegmentFacets = useMemo(() => ({
    total: firms.length,
    filters: FILTERS.map((f) => {
      const tally = new Map<string, number>();
      let have = 0;
      for (const firm of firms) {
        const vals = firm.facets[f.key] ?? [];
        if (vals.length) have++;
        for (const v of vals) tally.set(v, (tally.get(v) ?? 0) + 1);
      }
      return {
        key: f.key, label: f.label, have,
        options: [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([value, n]) => ({ value, n })),
      };
    }).filter((f) => f.options.length > 0),
  }), [firms]);

  /* Filters cut across all three tiers on purpose: the useful question is
     "how many venture firms are in each tier", which a filter confined to the
     tier on screen could not answer. */
  const matching = useMemo(() => firms.filter((f) =>
    Object.entries(picks).every(([k, want]) =>
      !want.length || want.some((w) => (f.facets[k] ?? []).includes(w)))), [firms, picks]);

  const shown = useMemo(() => matching.filter((f) => f.tier === tier), [matching, tier]);

  /* Everyone at the firms on screen, firm by firm so the order means
     something. Capped for rendering only — the count above it is the real
     one, and the export carries all of them. */
  const roster = useMemo(
    () => shown.flatMap((f) => f.contacts.map((c) => ({ firm: f, c }))),
    [shown]);
  /* How much of the people list is on screen.
     Back to the first page whenever the list underneath changes — staying on
     "showing 600 of 900" after switching tier shows a page of a list that is
     no longer there. Held AGAINST the list it belongs to rather than reset by
     an effect: an effect that resets state runs after a render that already
     showed the wrong thing, and React rightly complains about both that and
     setting state while rendering. */
  const listKey = `${view}:${tier}:${JSON.stringify(picks)}`;
  const [page, setPage] = useState({ key: listKey, limit: 200 });
  const limit = page.key === listKey ? page.limit : 200;
  const showMore = () => setPage({ key: listKey, limit: limit + 200 });
  const counts = useMemo(
    () => TIERS.map((t) => ({
      ...t,
      firms: matching.filter((f) => f.tier === t.n).length,
      people: matching.filter((f) => f.tier === t.n).reduce((n, f) => n + f.contacts.length, 0),
    })),
    [matching],
  );
  const filtered = Object.values(picks).some((v) => v.length);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleFirm(f: TierFirm) {
    const ids = f.contacts.filter((c) => !c.onDeal).map((c) => c.id);
    const allOn = ids.every((id) => picked.has(id));
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (allOn) next.delete(id); else next.add(id); }
      return next;
    });
  }

  /* Removing and restoring both refresh from the server rather than editing
     the list here. The tiers, their counts and the filter options are all
     derived from the firms on the page, and a locally spliced list would leave
     every one of those saying something slightly untrue. */
  function drop(id: string, name: string) {
    start(async () => {
      const r = await removeMatchedAccount(dealRef, id);
      setNote(r.message);
      setOpen((o) => (o === id ? null : o));
      router.refresh();
      void name;
    });
  }
  function restore(id: string) {
    start(async () => {
      const r = await restoreMatchedAccount(dealRef, id);
      setNote(r.message);
      router.refresh();
    });
  }

  function add() {
    start(async () => {
      const r = await addToDeal(dealRef, { mode: "ids", ids: [...picked] });
      setNote(r.message);
      setPicked(new Set());
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <FilterBar
            facets={facets}
            selected={picks}
            onChange={(next) => { setPicks(next); setOpen(null); }}
          />
        </div>
        {/* Only where there is something in it. An always-present "0 removed"
            control is a permanent reminder of a thing nobody did. */}
        {removed.length > 0 && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowRemoved((v) => !v)}
              aria-expanded={showRemoved}
              className="rounded-[7px] border border-line bg-paper px-3 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent/50 hover:text-ink"
            >
              {removed.length} removed
              <span className="ml-1.5 text-ink-3" aria-hidden>{showRemoved ? "\u25b4" : "\u25be"}</span>
            </button>
            {showRemoved && (
              <div className="absolute right-0 z-30 mt-1 max-h-[320px] w-[290px] overflow-y-auto rounded-[8px] border border-line bg-paper py-1 shadow-lg">
                {removed.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-[6px] text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-ink-2">{r.name}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => restore(r.id)}
                      className="shrink-0 text-micro font-medium text-accent hover:underline disabled:opacity-40"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Which tier, and which way to read it. ONE ROW, because they are the
          same kind of choice — what is on screen, not what is in the list —
          and because a small pair of buttons UNDERNEATH three large cards is
          where a control goes to be missed. */}
      <div className="mb-5 flex flex-wrap items-stretch justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {counts.map((t) => (
          <button
            key={t.n}
            type="button"
            onClick={() => { setTier(t.n); setOpen(null); }}
            className={`rounded-[8px] border px-4 py-2.5 text-left transition-colors ${
              tier === t.n ? "border-accent bg-accent/[0.07]" : "border-line hover:bg-sunken"
            }`}
          >
            <span className="block text-[14px] font-medium text-ink">
              {t.label}
              <span className="ml-2 font-normal text-ink-3">
                {t.firms.toLocaleString()} {t.firms === 1 ? "firm" : "firms"}
              </span>
            </span>
            <span className="mt-0.5 block text-micro text-ink-2">{t.blurb}</span>
          </button>
        ))}
      </div>

        <div className="flex flex-col justify-center gap-1.5 rounded-[8px] border border-line px-3 py-2.5">
          <span className="text-label uppercase tracking-wide text-ink-3">Show</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Show firms or people">
            {(["firms", "people"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => { setView(v); setOpen(null); }}
                className={`rounded-[6px] border px-3 py-[5px] text-[13px] font-medium transition-colors ${
                  view === v ? "border-accent bg-accent text-white" : "border-line bg-paper text-ink-2 hover:border-accent/50 hover:text-ink"
                }`}
              >
                {v === "firms" ? "Firms" : "People"}
              </button>
            ))}
          </div>
          <span className="text-micro text-ink-2">
            {view === "firms"
              ? `${shown.length.toLocaleString()} in tier ${tier}`
              : `${roster.length.toLocaleString()} at ${shown.length.toLocaleString()} firms`}
          </span>
        </div>
      </div>

      {view === "people" ? (
        roster.length === 0 ? (
          <p className="rounded-md border border-line px-5 py-8 text-center text-body text-ink-2">
            {filtered ? "Nobody at the firms matching those filters." : "Nobody in this tier."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-table">
              {/* Last contact went (client, 2026-09-01): this list is for
                  choosing who to put on a raise, and the job title is what
                  answers that. When they were last emailed is on their own
                  record and on Outreach. */}
              <TableHead cols={["", "Name", "Job title", "Firm", "Email", "Ever replied?", ""]} />
              <tbody>
                {roster.slice(0, limit).map(({ firm, c }, i) => (
                  <tr key={`${firm.id}-${c.id}`} className={i % 2 ? "bg-sunken/50" : ""}>
                    <td className="w-[40px] py-[7px] pl-4">
                      <input
                        type="checkbox"
                        checked={c.onDeal || picked.has(c.id)}
                        disabled={c.onDeal}
                        onChange={() => toggle(c.id)}
                        aria-label={`Add ${c.name}`}
                        className="h-[15px] w-[15px] accent-[var(--color-accent)] disabled:opacity-40"
                      />
                    </td>
                    <td className="py-[7px] pr-3">
                      <Link href={`/contacts/${c.id}`} className="font-medium text-accent hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="max-w-[200px] truncate py-[7px] pr-3 text-ink-2" title={c.jobTitle ?? ""}>
                      {c.jobTitle || <span className="text-ink-3">—</span>}
                    </td>
                    <td className="max-w-[220px] truncate py-[7px] pr-3">
                      <Link href={`/accounts/${firm.id}`} className="text-ink hover:underline">{firm.name}</Link>
                      {firm.type && <span className="ml-2 text-micro text-ink-3">{firm.type}</span>}
                    </td>
                    <td className="py-[7px] pr-3 font-mono text-[12px] text-ink-2">{c.email}</td>
                    <td className="py-[7px] pr-3"><RepliedChip replied={c.replied} /></td>
                    <td className="py-[7px] pr-4 text-right">
                      {c.onDeal && <span className="text-micro text-ink-3">on the deal</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Rendered in pages; the count above and the export are the whole
                list. Tier 3 on a big deal is four thousand people and putting
                them all in the DOM makes the page unusable. */}
            {roster.length > limit && (
              <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
                <span className="text-micro text-ink-2">
                  Showing {limit.toLocaleString()} of {roster.length.toLocaleString()}
                </span>
                <div className="flex gap-2">
                  <Button onClick={showMore}>Show 200 more</Button>
                  <Button onClick={() => setPicked((prev) => {
                    const next = new Set(prev);
                    for (const { c } of roster) if (!c.onDeal) next.add(c.id);
                    return next;
                  })}>
                    Select all {roster.length.toLocaleString()}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      ) : shown.length === 0 ? (
        <p className="rounded-md border border-line px-5 py-8 text-center text-body text-ink-2">
          {filtered ? "No firms in this tier match those filters." : "No firms in this tier."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((f) => {
            const isOpen = open === f.id;
            const on = f.contacts.filter((c) => picked.has(c.id)).length;
            const already = f.contacts.filter((c) => c.onDeal).length;
            return (
              <div
                key={f.id}
                /* The open card spans the whole row and pushes the rest down,
                   rather than floating over them — the list you were reading
                   stays where it was. */
                className={isOpen ? "sm:col-span-2 lg:col-span-3 xl:col-span-4" : ""}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(isOpen ? null : f.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : f.id); }
                  }}
                  aria-expanded={isOpen}
                  /* A div, not a button. Ruling a firm out is a control INSIDE
                     the card, and a button nested in a button is invalid HTML —
                     the inner one simply stops working in some browsers. */
                  className={`flex w-full cursor-pointer flex-col rounded-[9px] border p-4 text-left transition-all ${
                    isOpen
                      ? "rounded-b-none border-accent bg-accent/[0.05]"
                      : on > 0
                        ? "border-accent/60 bg-accent/[0.03] hover:border-accent"
                        : "border-line hover:-translate-y-0.5 hover:border-ink-3"
                  }`}
                >
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink">{f.name}</span>
                    {/* An X, not a minus: on an open panel the question is
                        "how do I close this", and a minus reads as a control
                        rather than an exit (John, 2026-08-27). */}
                    <span
                      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[15px] leading-none ${
                        isOpen ? "bg-ink/10 text-ink" : "text-ink-3"
                      }`}
                      aria-hidden
                    >
                      {isOpen ? "\u00d7" : "+"}
                    </span>
                  </span>
                  <span className="mt-1 truncate text-micro text-ink-2">
                    {f.type || "Investor"}{f.aum && f.aum !== "N/A" ? ` · ${f.aum}` : ""}
                  </span>
                  {f.metals.length > 0 && (
                    <span className="mt-2 truncate text-micro text-ink-3">{f.metals.join(", ")}</span>
                  )}
                  <span className="mt-3 flex items-center gap-2 text-micro">
                    <span className="text-ink-2">
                      {f.contacts.length} {f.contacts.length === 1 ? "contact" : "contacts"}
                    </span>
                    {on > 0 && <span className="font-medium text-accent">· {on} picked</span>}
                    {already > 0 && <span className="text-ink-3">· {already} already on</span>}
                  </span>
                  {/* What we never established, said plainly — this is the
                      reason the firm is in tier 2 or 3 rather than tier 1. */}
                  {f.gaps.length > 0 && (
                    <span className="mt-2 truncate text-micro text-ink-3">
                      Not established: {f.gaps.join(", ")}
                    </span>
                  )}

                  {/* Bottom right of the card, open or closed — the whole point
                      is to rule a firm out while scanning the grid, without
                      having to open it first. */}
                  <span className="mt-3 flex justify-end">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); drop(f.id, f.name); }}
                      className="rounded-md px-2 py-[3px] text-micro font-medium text-ink-3 transition-colors hover:bg-bad/10 hover:text-bad disabled:opacity-40"
                      title={`Take ${f.name} off this deal's matched list`}
                    >
                      Remove
                    </button>
                  </span>
                </div>

                {isOpen && (
                  <div className="rounded-b-[9px] border border-t-0 border-accent bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                      <span className="text-micro text-ink-2">
                        {f.countries.length ? f.countries.join(", ") : "Office country not recorded"}
                        {f.aum ? ` · ${f.aum}` : " · fund size not recorded"}
                      </span>
                      <span className="flex items-center gap-3">
                        <Link href={`/accounts/${f.id}`} className="text-micro text-accent hover:underline">
                          Open firm →
                        </Link>
                        <button
                          type="button"
                          onClick={() => toggleFirm(f)}
                          className="rounded-md border border-line px-2.5 py-1 text-micro font-medium text-ink hover:bg-sunken"
                        >
                          Select everyone here
                        </button>

                      </span>
                    </div>
                    <table className="w-full text-table">
                      <TableHead
                        light
                        /* Last contact is gone from here too (client,
                           2026-09-01) — same reason as the people view above:
                           this is for choosing who to put on a raise. */
                        cols={["", "Name", "Job title", "Email", "Ever replied?", ""]}
                      />
                      <tbody>
                        {f.contacts.map((c, i) => (
                          <tr key={c.id} className={i % 2 ? "bg-sunken/50" : ""}>
                            <td className="w-[40px] py-[7px] pl-4">
                              <input
                                type="checkbox"
                                checked={c.onDeal || picked.has(c.id)}
                                disabled={c.onDeal}
                                onChange={() => toggle(c.id)}
                                aria-label={`Add ${c.name}`}
                                className="h-[15px] w-[15px] accent-[var(--color-accent)] disabled:opacity-40"
                              />
                            </td>
                            <td className="py-[7px] pr-3">
                              <Link href={`/contacts/${c.id}`} className="font-medium text-accent hover:underline">
                                {c.name}
                              </Link>
                            </td>
                            <td className="max-w-[200px] truncate py-[7px] pr-3 text-ink-2" title={c.jobTitle ?? ""}>
                              {c.jobTitle || <span className="text-ink-3">—</span>}
                            </td>
                            <td className="py-[7px] pr-3 font-mono text-[12px] text-ink-2">{c.email}</td>
                            <td className="py-[7px] pr-3"><RepliedChip replied={c.replied} /></td>
                            <td className="py-[7px] pr-4 text-right">
                              {c.onDeal && <span className="text-micro text-ink-3">on the deal</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Only appears once something is ticked, and follows you down the page,
          because the grid is longer than a screen. */}
      {(picked.size > 0 || note) && (
        <div className="sticky bottom-4 z-20 mt-5 flex flex-wrap items-center gap-3 rounded-[9px] border border-accent bg-white px-4 py-3 shadow-lg">
          {note && <span className="text-[13px] text-ink-2">{note}</span>}
          {picked.size > 0 && (
            <>
              <span className="text-[13.5px] font-medium text-ink">
                {picked.size.toLocaleString()} {picked.size === 1 ? "person" : "people"} selected
              </span>
              <span className="ml-auto flex items-center gap-2">
                <Button onClick={() => { setPicked(new Set()); setNote(null); }}>Clear</Button>
                <Button variant="primary" onClick={add} disabled={busy}>
                  {busy ? "Adding…" : "Add to this deal"}
                </Button>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
