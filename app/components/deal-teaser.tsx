"use client";

import { useState, useTransition } from "react";
import { redraftTeaser } from "@/app/lib/deal/teaser-actions";
import type { Teaser } from "@/app/lib/deal/teaser";
import { Button } from "./ui";

/**
 * The teaser as it reads on screen, above the deal.
 *
 * IT IS THE SAME DOCUMENT, not a summary of it. Every section here is a section
 * of the PDF, in the same order and with the same words, because the whole
 * point is that somebody can look at what is about to go to investors before it
 * goes. A preview that showed less than the file would be worse than none — it
 * would be a place to look and be reassured by something you had not checked.
 *
 * It replaced the four figure tiles and the mandate write-up that used to open
 * this page (John, 2026-08-28). Those said the same things in a form nobody
 * sends; this is the form that is sent.
 *
 * THERE IS NO REWRITE BUTTON (John, 2026-08-28). One was built and removed the
 * same day: a second draft of the same documents is a different teaser rather
 * than a better one, and a button that silently replaces what somebody has
 * already read and approved is the wrong shape. Editing it is the right shape,
 * and is being thought about. A deal with NO teaser still gets the button
 * below — that is a first draft, not a replacement.
 *
 * A teaser is still rewritten on its own when more documents arrive for the
 * deal, which is correct: a term sheet that moved the raise amount has moved it
 * in the document Halden Ridge attaches to its emails too.
 */
export function DealTeaser({
  dealRef,
  teaser,
  drafting,
}: {
  dealRef: string;
  teaser: Teaser | null;
  /** True while a first draft is still being written by the upload step. */
  drafting?: boolean;
}) {
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const redraft = () =>
    start(async () => {
      setNote(null);
      const r = await redraftTeaser(dealRef);
      setNote(r.message);
    });

  if (!teaser) {
    return (
      <section className="overflow-hidden rounded-[8px] border border-head-line bg-paper">
        <header className="flex items-center gap-3 bg-head px-5 py-[10px]">
          <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-head-ink">Teaser</h2>
        </header>
        <div className="flex flex-col items-start gap-3 px-5 py-6">
          <p className="max-w-[70ch] text-body text-ink-2">
            {drafting
              ? "The teaser is being written from the uploaded documents."
              : "This deal has no teaser yet. It is written from the documents already on the deal — two pages an investor can read cold, and what gets attached to a first email."}
          </p>
          <Button variant="primary" onClick={redraft} disabled={busy}>
            {busy ? "Writing it…" : "Draft the teaser"}
          </Button>
          {note && <p className="text-micro text-ink-2">{note}</p>}
        </div>
      </section>
    );
  }

  const t = teaser;

  return (
    <section className="overflow-hidden rounded-[8px] border border-head-line bg-paper">
      <header className="flex items-center gap-3 bg-head px-5 py-[10px]">
        <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-head-ink">Teaser</h2>
        <div className="ml-auto flex items-center gap-2">
          {/* A plain link. The file is drawn on the server, so the browser
              should ask for it rather than assemble one of its own. */}
          <a
            href={`/api/deals/${dealRef}/teaser`}
            className="rounded-[6px] bg-white/15 px-2.5 py-[5px] text-[12.5px] font-medium text-white transition-colors hover:bg-white/25"
          >
            Download PDF
          </a>
        </div>
      </header>

      <div className="flex flex-col gap-6 px-5 py-5">
        {/* ── the headline and the figures, as page one opens ── */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
          <div className="min-w-0 flex-1">
            <h3 className="max-w-[24ch] text-[22px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink">
              {t.headline.replace(/\.$/, "")}
              <span className="text-amber">.</span>
            </h3>
            {t.intro && <p className="mt-3 max-w-[62ch] text-body text-ink-2">{t.intro}</p>}
          </div>

          {t.panel.length > 0 && (
            <dl className="w-full shrink-0 rounded-[7px] border border-line bg-sunken px-4 py-3 md:w-[280px]">
              <p className="text-label uppercase tracking-wide text-ink-3">{t.panelTitle}</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {t.panel.map((r) => (
                  <div key={r.label} className="flex items-baseline gap-3">
                    <dt className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{r.label}</dt>
                    <dd className="shrink-0 text-[12.5px] font-semibold text-ink">{r.value}</dd>
                  </div>
                ))}
              </div>
            </dl>
          )}
        </div>

        <Columns heading={t.problemHeading} items={t.problems} />
        <Columns heading={t.solutionHeading} items={t.solutions} numbered />

        {t.callouts.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {t.callouts.map((line) => (
              <p
                key={line}
                className="rounded-[7px] border border-accent/60 bg-accent-weak px-4 py-3 text-[13px] font-medium leading-[1.5] text-head"
              >
                {line}
              </p>
            ))}
          </div>
        )}

        {/* ── page two, behind a disclosure: it is the detail, and the top of
              this page should stay the pitch ── */}
        <div>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="text-[12.5px] font-medium text-accent hover:underline"
          >
            {open ? "Hide page two" : `Page two — proof, economics, plan${t.team.length ? " and team" : ""}`}
          </button>

          {open && (
            <div className="mt-4 flex flex-col gap-6 border-t border-line pt-5">
              {t.proofIntro && <p className="max-w-[80ch] text-body text-ink-2">{t.proofIntro}</p>}

              <div className="grid items-start gap-6 lg:grid-cols-2">
                {t.achieved.length > 0 && (
                  <div>
                    <p className="text-h2 text-ink">{t.achievedHeading.replace(/\.$/, "")}</p>
                    <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-body text-ink-2">
                      {t.achieved.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  </div>
                )}

                {t.economics && (
                  <div className="min-w-0">
                    <p className="text-h2 text-ink">{t.economicsHeading.replace(/\.$/, "")}</p>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full border-collapse text-table">
                        <thead>
                          <tr>
                            <th className="border-b border-line px-2 py-1.5 text-left text-label uppercase tracking-wide text-ink-3" />
                            {t.economics.columns.map((c) => (
                              <th key={c} className="border-b border-line px-2 py-1.5 text-right text-label uppercase tracking-wide text-ink-3">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {t.economics.rows.map((r) => (
                            <tr key={r.label}>
                              <td className="border-b border-line px-2 py-1.5 font-medium text-ink">{r.label}</td>
                              {r.values.map((v, i) => (
                                <td key={i} className="border-b border-line px-2 py-1.5 text-right text-ink-2">{v}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {t.milestones.length > 0 && (
                <div>
                  <p className="text-h2 text-ink">{t.planHeading.replace(/\.$/, "")}</p>
                  <ol className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {t.milestones.map((m) => (
                      <li key={m.when} className="border-t-2 border-accent/50 pt-2">
                        <p className="text-[12.5px] font-semibold text-head">{m.when}</p>
                        <p className="mt-1 text-[12.5px] leading-[1.45] text-ink-2">{m.what}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {t.plan.length > 0 && <Columns heading="" items={t.plan} />}

              {t.team.length > 0 && (
                <div>
                  <p className="text-h2 text-ink">{t.teamHeading.replace(/\.$/, "")}</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {t.team.map((p) => (
                      <div key={p.name} className="rounded-[7px] border border-line bg-sunken px-3.5 py-3">
                        <p className="text-[13px] font-semibold text-ink">{p.name}</p>
                        <p className="text-[12px] text-accent">{p.role}</p>
                        <p className="mt-1.5 text-[12px] leading-[1.45] text-ink-2">{p.bio}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* What the documents did not support, said plainly. It is the
                  same discipline as the deal's own gaps: a line the guard
                  dropped must never be invisible, or nobody knows to go and
                  find it. */}
              {t.gaps.length > 0 && (
                <p className="max-w-[80ch] text-micro text-ink-3">
                  Left out because the documents do not state it: {t.gaps.join("; ")}.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** A row of short columns — the problem in three, the answer in four. */
function Columns({
  heading,
  items,
  numbered = false,
}: {
  heading: string;
  items: { title: string; text: string }[];
  numbered?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div>
      {heading && (
        <p className="text-[15px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">
          {heading.replace(/\.$/, "")}
          <span className="text-accent">.</span>
        </p>
      )}
      <div
        className={`mt-3 grid gap-x-5 gap-y-4 sm:grid-cols-2 ${items.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
      >
        {items.map((it, i) => (
          <div key={it.title} className={numbered ? "" : "border-l-2 border-accent/40 pl-3"}>
            <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              {numbered && (
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-accent text-[10px] text-accent">
                  {i + 1}
                </span>
              )}
              {it.title}
            </p>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-ink-2">{it.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
