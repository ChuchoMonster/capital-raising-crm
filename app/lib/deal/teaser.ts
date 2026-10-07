import "server-only";
import { shingles, supported } from "./draft";

/**
 * The two-page teaser Halden Ridge sends before it sends the deck.
 *
 * WHY IT EXISTS. A raise arrives as a 7MB deck and a term sheet, and those were
 * going out attached to every first email. A teaser is the thing an investor
 * actually opens cold: two pages, no download, enough to decide whether they
 * want the deck. So the deck stops being the opener and becomes the follow-up.
 *
 * THE SHAPE IS FIXED, THE CONTENT IS NOT. Every section below mirrors the
 * two-pager Halden Ridge already works from (Voltwick, Aug 2026): a headline and a figures
 * panel over a photograph, the problem in three, the answer in four, two
 * claims, then proof, economics, plan and team. A mining raise is not an EV
 * charging rollout, but the questions an investor asks in what order are the
 * same, and a house format is worth more than a bespoke one per deal.
 *
 * THE GUARD, AND IT IS THE POINT OF THIS FILE. Anything carrying a NUMBER must
 * come with the sentence it was taken from, and that sentence is checked
 * against the document AFTER the model answers. An unsupported figure is
 * dropped and the drop is recorded in `gaps` — never quietly kept, never
 * quietly lost. Prose without a figure is not quote-checked, because it is
 * writing about the document rather than a claim lifted out of it, and a guard
 * that strict has emptied pages on this project before.
 */

/* Same model as the write-up, for the same reason: this goes out under Halden Ridge's
   name to investors. */
const MODEL = "claude-opus-5";

export interface TeaserRow { label: string; value: string }
export interface TeaserItem { title: string; text: string }
export interface TeaserPerson { name: string; role: string; bio: string }
export interface TeaserTable {
  columns: string[];
  rows: { label: string; values: string[] }[];
}

export interface Teaser {
  company: string;
  /** The footer strip's middle phrase. Small caps, five words at most. */
  tagline: string;
  website: string;

  /* ── page one ── */
  headline: string;
  intro: string;
  panelTitle: string;
  panel: TeaserRow[];
  problemHeading: string;
  problems: TeaserItem[];
  solutionHeading: string;
  solutions: TeaserItem[];
  callouts: string[];

  /* ── page two ── */
  proofHeading: string;
  proofIntro: string;
  achievedHeading: string;
  achieved: string[];
  economicsHeading: string;
  economics: TeaserTable | null;
  planHeading: string;
  milestones: { when: string; what: string }[];
  plan: TeaserItem[];
  teamHeading: string;
  team: TeaserPerson[];

  /** What the document did not say, or said in a way the guard could not back. */
  gaps: string[];
  model: string;
  draftedAt: string;
}

export class TeaserFailed extends Error {}

const SCHEMA = {
  type: "object",
  properties: {
    tagline: { type: "string", description: "Three to five words for the footer strip, in the company's own terms. e.g. 'ZERO-CARBON IRON'. No slogan the document does not support." },
    headline: { type: "string", description: "ONE sentence saying what the company does, in the form 'X builds/produces/develops Y for Z'. Under 14 words. This is the largest type on the page." },
    intro: { type: "string", description: "Two sentences under the headline. What the company is and how it works." },
    panelTitle: { type: "string", description: "The name of the small figures box, e.g. 'The raise' or 'Project economics'." },
    panel: {
      type: "array",
      description: "Two to four label/value pairs for the figures box. The raise, the valuation, the stage, the use of funds — whichever the document states. Values short enough to sit on one line.",
      items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"], additionalProperties: false },
    },
    problemHeading: { type: "string", description: "e.g. 'Steelmaking has a carbon problem.' A full sentence ending in a full stop." },
    problems: {
      type: "array",
      description: "EXACTLY three. The market problem this company exists to solve, as the document frames it.",
      items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"], additionalProperties: false },
    },
    solutionHeading: { type: "string", description: "e.g. 'The Arkveld Zero solution.' A full sentence ending in a full stop." },
    solutions: {
      type: "array",
      description: "EXACTLY four. What the company has that answers the problem — technology, resource, position, team, offtake.",
      items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"], additionalProperties: false },
    },
    callouts: { type: "array", items: { type: "string" }, description: "Exactly two short claims, one sentence each, from the document. These are set in boxes at the foot of page one." },
    proofHeading: { type: "string", description: "Page two's headline, e.g. 'Proof and economics.'" },
    proofIntro: { type: "string", description: "One sentence under it, saying what has been de-risked so far." },
    achievedHeading: { type: "string", description: "e.g. 'What has been achieved.'" },
    achieved: { type: "array", items: { type: "string" }, description: "Five to eight short bullets of what is already done — permits, resource, pilot, offtake, patents, funding to date." },
    economicsHeading: { type: "string", description: "e.g. 'Project economics.' Empty string if there is no table." },
    economics: {
      type: ["object", "null"],
      description: "A small comparison table, ONLY if the document gives figures across two or more cases, scenarios, phases or projects. Null otherwise — do not invent one.",
      properties: {
        columns: { type: "array", items: { type: "string" }, description: "Two to four column headings, e.g. 'Stage 1', 'Stage 2'." },
        rows: {
          type: "array",
          items: { type: "object", properties: { label: { type: "string" }, values: { type: "array", items: { type: "string" } } }, required: ["label", "values"], additionalProperties: false },
        },
      },
      required: ["columns", "rows"],
      additionalProperties: false,
    },
    planHeading: { type: "string", description: "e.g. 'The plan.'" },
    milestones: {
      type: "array",
      description: "Three to five dated milestones in order, only where the document dates them. 'when' is short: '2026', 'Q3 2027', 'H1 2028'.",
      items: { type: "object", properties: { when: { type: "string" }, what: { type: "string" } }, required: ["when", "what"], additionalProperties: false },
    },
    plan: {
      type: "array",
      description: "Two to four points about what this money does and where it leads.",
      items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"], additionalProperties: false },
    },
    teamHeading: { type: "string", description: "e.g. 'Team.'" },
    team: {
      type: "array",
      description: "Up to four people the document names, with their role and one line each. Empty if the document names nobody.",
      items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, bio: { type: "string" } }, required: ["name", "role", "bio"], additionalProperties: false },
    },
    evidence: {
      type: "object",
      description: "For EVERY item you wrote that contains a number, the verbatim sentence from the document that states it. Key it by the path shown in the instructions.",
      additionalProperties: { type: "string" },
    },
  },
  required: [
    "tagline", "headline", "intro", "panelTitle", "panel",
    "problemHeading", "problems", "solutionHeading", "solutions", "callouts",
    "proofHeading", "proofIntro", "achievedHeading", "achieved",
    "economicsHeading", "economics", "planHeading", "milestones", "plan",
    "teamHeading", "team", "evidence",
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `You write the two-page investor teaser a placement agent sends before it sends the deck.

Halden Ridge Advisors places capital for mining and energy companies. This teaser goes out attached to a cold email to institutional investors, so it must be accurate before it is impressive. An investor who spots one invented figure stops reading.

Rules, in order of importance:

1. EVERY NUMBER MUST COME FROM THE DOCUMENT. Never estimate, never round, never derive one figure from another, never carry a number across from a comparable company the document mentions. If the document gives no economics table, return null for economics — an empty section is a correct answer and an invented one ends the relationship.

2. For every item you write that CONTAINS A NUMBER, put the verbatim sentence you took it from in "evidence". Key it by path: "panel.0", "callouts.1", "achieved.3", "milestones.2", "plan.0", "economics.1", "problems.2", "solutions.0", "team.1", "headline", "intro", "proofIntro". Copy the sentence exactly from the document, including its units.

3. Write like a term sheet, not a brochure. "Maiden resource of 1.2Mt at 1.8% Cu" is a teaser line. "Exceptional growth potential in a rapidly expanding market" is not, and will be cut.

4. Fixed lengths, because this is typeset into a fixed layout and overflow is cut:
   - headline: under 14 words, one sentence.
   - intro: two sentences, under 40 words.
   - problems: exactly 3. Each title 1-3 words, each text under 28 words.
   - solutions: exactly 4. Each title 1-2 words, each text under 28 words.
   - callouts: exactly 2, each under 22 words.
   - achieved: 5 to 8 bullets, each under 16 words.
   - plan: 2 to 4 points, title under 5 words, text under 18 words.
   - team: up to 4, bio under 20 words.
   - panel values: under 6 words each.

5. The headings are sentences ending in a full stop, in the house style: "The charging experience is broken in three ways." / "The Voltwick solution." / "Platform proof + economics." Write the equivalent for this company.

6. Name the company by its real name throughout. Do not write "the Company".

7. If the document does not support a section at all, return empty arrays or empty strings for it. Do not pad.`;

/** A list that may have arrived as something else. Same repair as the write-up. */
function asList<T>(v: unknown, map: (x: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  return v.map(map).filter((x): x is T => x !== null);
}

/**
 * A string that may have arrived wrapped in an object.
 *
 * A list of plain strings comes back as `[{ "text": "..." }]` often enough to
 * be worth repairing rather than losing — and losing it is not loud: `String()`
 * on an object is "[object Object]", which SET TYPE ON THE PAGE and reached a
 * rendered teaser before anyone noticed. A bad value that renders is the whole
 * failure mode this file exists to prevent.
 */
function asText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object") {
    for (const k of ["text", "item", "value", "label", "title", "point", "bullet"]) {
      const got = (v as Record<string, unknown>)[k];
      if (typeof got === "string" && got.trim()) return got.trim();
    }
  }
  return "";
}

const str = (v: unknown) => asText(v);

/**
 * Does this line make a numeric claim?
 *
 * The dividing line the guard runs on. A sentence with a figure in it is a
 * claim that can be wrong in a way an investor will catch; a sentence without
 * one is prose about the document. Quote-checking the prose too was tried on
 * the research side and it binned correct answers eight times over — so the
 * strict test goes where the harm is.
 *
 * A bare year on its own does not count. "Founded in 2019" is not the kind of
 * number that loses a mandate, and demanding a quote for every date pushed
 * whole sections off the page.
 */
function numeric(s: string): boolean {
  const withoutYears = s.replace(/\b(19|20)\d{2}\b/g, " ");
  return /\d/.test(withoutYears);
}

/** Every figure in a passage, commas flattened so 3,650 and 3650 are one number. */
function figures(s: string): string[] {
  return [...String(s).replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

/**
 * The fallback when the model quoted nothing for a line.
 *
 * It happens on a couple of items in every draft — the answer is right and the
 * evidence key was simply not filled in — and dropping those is the eighth
 * over-rejection this project would have paid for. So instead of trusting the
 * line, its NUMBERS are checked: every figure in it must appear in the
 * document. That tests exactly the harm worth testing. A sentence rephrased
 * from the deck survives, and a figure that was never in the deck cannot,
 * whatever the words around it say.
 *
 * Deliberately NOT used when a quote WAS given and failed. That is a different
 * situation — the model produced a sentence the document does not contain —
 * and it is the case the guard exists for.
 */
function figuresHold(text: string, docFigures: Set<string>): boolean {
  const want = figures(text);
  if (!want.length) return true;
  return want.every((f) => docFigures.has(f));
}

async function ask(brief: string, key: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        fallbacks: "default",
        system: SYSTEM,
        tools: [{ name: "teaser", description: "Return the two-page teaser.", input_schema: SCHEMA }],
        tool_choice: { type: "tool", name: "teaser" },
        messages: [{ role: "user", content: brief }],
      }),
    });
  } catch {
    throw new TeaserFailed("Could not reach the drafting service.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TeaserFailed(
      /credit balance is too low/i.test(body)
        ? "The drafting service is out of credit."
        : res.status === 429 ? "The drafting service is rate-limited right now. Try again in a minute."
        : `The drafting service returned ${res.status}. ${body.slice(0, 160)}`);
  }
  const payload = await res.json();
  const block = (payload.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  if (!block) throw new TeaserFailed("The drafting service returned nothing usable.");
  return block.input as Record<string, unknown>;
}

/**
 * Did the answer arrive whole?
 *
 * One run in perhaps five comes back structurally right and substantively
 * empty — an eight-bullet list returned as a single object with no keys, every
 * other list missing. Nothing about it fails the schema, and the teaser it
 * produces is a page of headings with no page under them. Asking again is
 * cheaper than shipping that.
 */
/**
 * Filler the model writes when it has stopped answering.
 *
 * A real teaser never contains these words, and a page of them is not a thin
 * answer — it is no answer wearing the shape of one. Arkveld Zero's teaser was
 * overwritten by a draft whose every heading was the literal word
 * "placeholder" (2026-08-28), and it reached the deal page looking like a
 * document.
 */
const FILLER = /^\s*(placeholder|tbd|to be determined|lorem ipsum|n\/a|none|example|text here|your (company|text) here|\.{2,}|-+)\s*[.!]?\s*$/i;

function wellFormed(d: Record<string, unknown>): boolean {
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const real = (v: unknown) => {
    const t = asText(v);
    return !!t && !FILLER.test(t);
  };
  const filled = (v: unknown, keys: string[]) =>
    list(v).filter((x) => x && typeof x === "object" && keys.every((k) => real((x as Record<string, unknown>)[k]))).length;
  return (
    real(d.headline) &&
    real(d.problemHeading) &&
    real(d.solutionHeading) &&
    filled(d.problems, ["title", "text"]) >= 2 &&
    filled(d.solutions, ["title", "text"]) >= 2 &&
    list(d.achieved).filter(real).length >= 2
  );
}

export async function draftTeaser(input: {
  company: string;
  website: string;
  /** The audited text the write-up was checked against. */
  text: string;
  /** The already-drafted fields, so the teaser agrees with the deal page. */
  known: { raising: string; valuation: string; stage: string; sector: string; countries: string; closing: string; summary: string; highlights: string[] };
}): Promise<Teaser> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new TeaserFailed("ANTHROPIC_API_KEY is not set on the server, so the teaser cannot be drafted.");
  if (!input.text || input.text.trim().length < 200)
    throw new TeaserFailed("There is no document text on this deal to write a teaser from.");

  const brief =
    `Company: ${input.company}\n` +
    `Sector: ${input.known.sector || "not stated"}\n` +
    `Where: ${input.known.countries || "not stated"}\n` +
    `Stage: ${input.known.stage || "not stated"}\n` +
    `Raising: ${input.known.raising || "not stated"}\n` +
    `Valuation: ${input.known.valuation || "not stated"}\n` +
    `Timing: ${input.known.closing || "not stated"}\n\n` +
    `The mandate summary already written for this raise, for tone and for what matters:\n${input.known.summary}\n\n` +
    (input.known.highlights.length ? `Highlights already drawn out:\n${input.known.highlights.map((h) => `- ${h}`).join("\n")}\n\n` : "") +
    `--- the document ---\n${input.text}`;

  /**
   * Ask twice, then REFUSE.
   *
   * ⚠️ THIS USED TO CARRY ON. It asked twice and then drafted from whatever
   * came back, so a hollow answer was stored, overwrote a good teaser, and
   * appeared on the deal page as a document reading "placeholder" (Element
   * Zero, 2026-08-28). Nothing anywhere reported a problem, because nothing
   * had failed — which is the failure mode this project keeps paying for.
   *
   * Throwing is what makes the caller's non-fatal handling correct: an upload
   * that cannot produce a teaser leaves the deal's existing one alone, and
   * says so, rather than replacing it with a shell.
   */
  let d = await ask(brief, key);
  /* Three attempts, not two. Measured on Arkveld Zero's deck, which is mostly
     pictures and trips this more than the others: two consecutive hollow
     answers happen, a third attempt then succeeded. Each retry costs a few
     cents against a person watching a deal page. */
  for (let attempt = 1; attempt < 3 && !wellFormed(d); attempt++) d = await ask(brief, key);
  if (!wellFormed(d))
    throw new TeaserFailed("The teaser came back empty three times — nothing was changed. Try again in a moment.");
  if (process.env.TEASER_DEBUG === "raw") console.error(JSON.stringify(d, null, 1));

  /* ── the guard ──────────────────────────────────────────────────────────
     Applied here, in code, over the whole answer. The prompt asking for a
     quote is not the control; this is. */
  const source = shingles(input.text);
  const evidence = (d.evidence ?? {}) as Record<string, string>;
  const gaps: string[] = [];

  /**
   * Keep this line, or drop it and say so.
   *
   * `TEASER_DEBUG=1` prints every rejection with the quote that failed.
   * Eight guards on this project have thrown away correct answers, every one
   * of them found by reading the rejects rather than counting them, so the way
   * to read them is part of the code rather than something to rebuild each time.
   */
  const docFigures = new Set(figures(input.text));
  const keep = (text: string, path: string, what: string): boolean => {
    if (!text) return false;
    if (!numeric(text)) return true;
    const quote = evidence[path] ?? "";
    if (supported(quote, source, input.text)) return true;
    if (!quote && figuresHold(text, docFigures)) return true;
    if (process.env.TEASER_DEBUG) {
      console.error(`  REJECT ${path.padEnd(14)} ${text.slice(0, 88)}`);
      console.error(`         quote: ${(evidence[path] ?? "(none given)").slice(0, 120)}`);
    }
    gaps.push(`${what} (dropped — the document does not say it)`);
    return false;
  };

  const items = (v: unknown, path: string, what: string, limit: number): TeaserItem[] =>
    asList<TeaserItem>(v, (x) => {
      const o = x as Record<string, unknown>;
      return { title: str(o?.title), text: str(o?.text) };
    })
      .filter((it, i) => it.title && it.text && keep(`${it.title} ${it.text}`, `${path}.${i}`, `${what} — ${it.title}`))
      .slice(0, limit);

  const panel = asList<TeaserRow>(d.panel, (x) => {
    const o = x as Record<string, unknown>;
    return { label: str(o?.label), value: str(o?.value) };
  })
    .filter((r, i) => r.label && r.value && keep(r.value, `panel.${i}`, `the ${r.label.toLowerCase()} figure`))
    .slice(0, 4);

  const achieved = asList<string>(d.achieved, (x) => asText(x) || null)
    .filter((t, i) => keep(t, `achieved.${i}`, "an achievement"))
    .slice(0, 8);

  const callouts = asList<string>(d.callouts, (x) => asText(x) || null)
    .filter((t, i) => keep(t, `callouts.${i}`, "a headline claim"))
    .slice(0, 2);

  const milestones = asList<{ when: string; what: string }>(d.milestones, (x) => {
    const o = x as Record<string, unknown>;
    return { when: str(o?.when), what: str(o?.what) };
  })
    .filter((m, i) => m.when && m.what && keep(m.what, `milestones.${i}`, `the ${m.when} milestone`))
    .slice(0, 5);

  const team = asList<TeaserPerson>(d.team, (x) => {
    const o = x as Record<string, unknown>;
    return { name: str(o?.name), role: str(o?.role), bio: str(o?.bio) };
  })
    .filter((p, i) => p.name && keep(p.bio, `team.${i}`, `${p.name}'s line`))
    .slice(0, 4);

  /* The table is all or nothing. A table with a row silently removed reads as
     complete and is not — worse than no table, which reads as no table. */
  let economics: TeaserTable | null = null;
  const raw = d.economics as { columns?: unknown; rows?: unknown } | null;
  if (raw && Array.isArray(raw.columns) && Array.isArray(raw.rows)) {
    const columns = asList<string>(raw.columns, (x) => asText(x) || null).slice(0, 4);
    const rows = asList<{ label: string; values: string[] }>(raw.rows, (x) => {
      const o = x as Record<string, unknown>;
      return { label: str(o?.label), values: asList<string>(o?.values, (v) => asText(v)) };
    }).filter((r) => r.label && r.values.length);
    const backed = rows.every((r, i) => {
      const quote = evidence[`economics.${i}`] ?? "";
      if (supported(quote, source, input.text)) return true;
      return !quote && figuresHold(r.values.join(" "), new Set(figures(input.text)));
    });
    if (columns.length >= 2 && rows.length >= 2 && backed) {
      economics = { columns, rows: rows.slice(0, 6).map((r) => ({ ...r, values: r.values.slice(0, columns.length) })) };
    } else if (rows.length) {
      gaps.push("the economics table (dropped — the document does not state it as a table)");
    }
  }

  const problems = items(d.problems, "problems", "a problem", 3);
  const solutions = items(d.solutions, "solutions", "a strength", 4);
  const plan = items(d.plan, "plan", "a plan point", 4);

  if (!problems.length) gaps.push("the problem section");
  if (!solutions.length) gaps.push("the solution section");
  if (!team.length) gaps.push("the team");

  return {
    company: input.company,
    tagline: str(d.tagline).toUpperCase().slice(0, 40),
    website: input.website,
    headline: str(d.headline),
    intro: str(d.intro),
    panelTitle: str(d.panelTitle) || "The raise",
    panel,
    problemHeading: str(d.problemHeading),
    problems,
    solutionHeading: str(d.solutionHeading),
    solutions,
    callouts,
    proofHeading: str(d.proofHeading) || "Proof and economics.",
    proofIntro: str(d.proofIntro),
    achievedHeading: str(d.achievedHeading) || "What has been achieved.",
    achieved,
    economicsHeading: str(d.economicsHeading) || "Project economics.",
    economics,
    planHeading: str(d.planHeading) || "The plan.",
    milestones,
    plan,
    teamHeading: str(d.teamHeading) || "Team.",
    team,
    gaps,
    model: MODEL,
    draftedAt: new Date().toISOString(),
  };
}
