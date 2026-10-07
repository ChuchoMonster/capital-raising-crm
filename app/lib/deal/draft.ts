import "server-only";

/**
 * The deal's name is the company's name and nothing else.
 *
 * A corporate deck puts its listings in the title block — Brevik's reads
 * "Brevik Holdings Corp. (TSXV: QZX | OTCQX: QZXXF)" — and the model faithfully
 * returns the lot. Asking it not to in the prompt is a request; stripping them
 * here is a guarantee, and this project has been bitten enough times by rules
 * that lived only in a prompt.
 *
 * Deliberately narrow: it removes a trailing bracket or dash clause ONLY when
 * that clause names an exchange or a ticker. "Acme (UK) Limited" and
 * "Ostmark — Kessel Ridge" both survive, because a rule that ate every
 * parenthesis would quietly rename companies whose name contains one.
 */
const EXCHANGES =
  "TSXV?|NYSE|NASDAQ|ASX|LSE|AIM|OTCQX|OTCQB|OTCBB|OTC|CSE|NEO|JSE|SGX|SEHK|HKEX|" +
  "FSE|ETR|XETRA|EPA|AMS|STO|OSL|OSE|CPH|HEL|WSE|TASE|KRX|TYO|TSE|BIT|SWX|SIX|BVL|BMV|NSE|BSE";
const TICKERY = new RegExp(`\\b(?:${EXCHANGES})\\b\\s*[:.]|\\bticker\\b|\\bcusip\\b|\\bisin\\b`, "i");

export function cleanCompanyName(raw: string): string {
  let out = String(raw ?? "").trim();
  /* Loop: a title can carry both "(TSXV: CTH)" and a trailing "| NYSE: X". */
  for (let i = 0; i < 4; i++) {
    const before = out;
    out = out.replace(/[([{]([^()[\]{}]*)[)\]}]\s*$/, (m, inner) => (TICKERY.test(inner) ? "" : m)).trim();
    out = out.replace(/\s*[—–\-|,]\s*([^—–\-|,]*)$/, (m, tail) => (TICKERY.test(tail) ? "" : m)).trim();
    if (out === before) break;
  }
  /* A stray opener left behind by an unbalanced title, and trailing punctuation
     that is not part of a name. A full stop IS part of "Corp." so it stays. */
  return out.replace(/\s*[([{|,;:—–-]+$/, "").trim() || String(raw ?? "").trim();
}


/**
 * Turn a deck into the write-up Halden Ridge puts in front of investors.
 *
 * THE RULE THIS IS BUILT AROUND: a field is filled only when the document says
 * it. Everything else comes back blank and is listed in `gaps`, because a
 * guessed raise amount and a real one look identical on the deal page, and this
 * one goes into emails to investors.
 *
 * Every field is checked against the document AFTER the model answers — the
 * prompt asking for a quote is not the control, the code that tests the quote
 * is. That distinction has cost this project real coverage more than once, in
 * both directions: a check too strict binned correct answers, a check absent
 * let invented ones through.
 */

export interface DealDraft {
  title: string;
  website: string;
  sector: string;
  countries: string;
  stage: string;
  raising: string;
  valuation: string;
  closing: string;
  summary: string;
  highlights: string[];
  /** Fields the document did not state. Shown to the user, stored on the deal. */
  gaps: string[];
  model: string;
  /**
   * The text every quote was checked against, stored on the deal.
   *
   * Returned rather than re-derived by the caller because for an image-only PDF
   * it is a TRANSCRIPT produced here — the caller has no way to make it, and a
   * deal whose stored text is not the text the guard used cannot be audited.
   */
  text: string;
}

/* Opus, not Sonnet. Sonnet read the test deck perfectly and costs about half as
   much, but this write-up goes out under Halden Ridge's name to investors — client's call,
   2026-08-24, on a measured difference of roughly four cents a deck. */
const MODEL = "claude-opus-5";

/** The words of a passage, punctuation flattened, so two spellings of the same
    sentence compare equal. */
function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9$%.\s-]/g, " ").split(/\s+/).filter(Boolean);
}

/** Six-word runs, the same overlap test the research pipeline settled on. */
export function shingles(s: string): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + 6 <= w.length; i++) out.add(w.slice(i, i + 6).join(" "));
  if (!out.size && w.length) out.add(w.join(" "));
  return out;
}

/**
 * Is this quote really in the document?
 *
 * Not strict containment. A model quoting a deck routinely splices two true
 * fragments from one slide, or drops a leading clause — that is not fabrication
 * and rejecting it throws away correct answers. Overlap at 0.6 passes a spliced
 * quote and fails an invented one.
 *
 * ⚠️ A SHORT QUOTE IS TESTED DIFFERENTLY, and getting this wrong dropped real
 * figures. The overlap test compares six-word runs, so a quote of five words or
 * fewer produces one run of its own that six-word runs can never match — it
 * scored zero and was rejected however plainly the document said it. "Pre-money
 * valuation of US$180 million." is five words, and a term sheet states a
 * valuation, a stage and a closing date in exactly that many. Below the run
 * length the passage is looked for in the text directly, which is the right
 * test at that size: splicing needs room to splice.
 *
 * The eighth time a guard on this project has thrown away correct answers.
 * Read the rejects, never the count.
 */
export function supported(quote: string, source: Set<string>, text: string): boolean {
  if (!quote || quote.trim().length < 8) return false;
  const w = words(quote);
  if (!w.length) return false;
  if (w.length < 6) return words(text).join(" ").includes(w.join(" "));
  const q = shingles(quote);
  if (!q.size) return false;
  let hit = 0;
  for (const s of q) if (source.has(s)) hit++;
  return hit / q.size >= 0.6;
}

/**
 * Read a list that may not have arrived as one.
 *
 * Roughly one call in three comes back with `highlights` as a STRING holding
 * `<item>…</item>` markup rather than an array — measured, not guessed. The
 * content is right and only the container is wrong, so it is repaired rather
 * than thrown away.
 */
function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v !== "string") return [];
  const items = [...v.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const lines = items.length ? items : v.split(/\r?\n/);
  return lines.map((x) => x.replace(/^[\s•\-*]+/, "").trim()).filter(Boolean);
}

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "The company or project being raised for. Its actual name." },
    website: { type: "string", description: "The company's own web address, bare domain, or empty." },
    sector: { type: "string", description: "e.g. 'Mining — Copper', 'Energy - Renewables'. Empty if unclear." },
    countries: { type: "string", description: "ISO-3166 alpha-2 codes for where the project or company is, semicolon separated. Empty if not stated." },
    stage: { type: "string", description: "e.g. Exploration, Development, Feasibility, Construction, Producing, Growth. Empty if not stated." },
    raising: { type: "string", description: "The amount being raised, as written in the document." },
    valuation: { type: "string", description: "Pre- or post-money valuation, only if the document states one." },
    closing: { type: "string", description: "Timing of the raise or first close, if stated." },
    summary: { type: "string", description: "Three to five sentences an investor would read first. Plain English, no adjectives the document does not earn." },
    highlights: { type: "array", items: { type: "string" }, description: "Three to six short bullets. Each one a fact from the document." },
    evidence: {
      type: "object",
      description: "For each of raising, valuation, countries, stage, closing that you filled: the verbatim sentence from the document that states it.",
      additionalProperties: { type: "string" },
    },
  },
  required: ["title", "sector", "countries", "stage", "raising", "valuation", "closing", "summary", "highlights", "evidence"],
  additionalProperties: false,
} as const;

const SYSTEM = `You read a capital-raising document and write the mandate summary a placement agent puts in front of investors.

Halden Ridge Advisors connects mining and energy companies with investors. The write-up you produce is dropped verbatim into emails, so it must be accurate before it is impressive.

Rules, in order of importance:
1. Fill a field ONLY if the document states it. If the document does not give a valuation, return an empty string. An empty field is a correct answer; an invented one is a serious error.
2. Never estimate, never infer a number from another number, never carry a figure over from a comparable company named in the document.
3. For every one of raising, valuation, countries, stage and closing that you fill, put the verbatim sentence you took it from in "evidence", keyed by the field name. Copy it exactly from the document.
4. "countries" is where the project or company is, as ISO-3166 alpha-2 codes, semicolon separated.
5. Highlights are facts, not selling lines. "Maiden resource of 1.2Mt at 1.8% Cu" is a highlight. "Exceptional growth potential" is not.
6. The summary is for someone who has never heard of the company. Say what it does, where, what stage, and what the money is for.
7. Write the summary as two or three SHORT paragraphs separated by a blank line, not one block. It is read on a screen and dropped into emails, and five sentences run together is a wall nobody finishes.`;

export class DraftFailed extends Error {}

/** One uploaded file, as the drafting step needs it. */
export interface SourceDoc {
  name: string;
  text: string;
  /** Set for a PDF with no extractable text — the model is given the file itself. */
  vision?: ArrayBuffer;
}

async function ask(docs: SourceDoc[], key: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // Raw HTTP takes beta flags as a HEADER. The SDKs accept a `betas` array in
        // the body and translate it; sending that array over plain fetch is rejected
        // as an unknown field.
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        /* A safety classifier can decline a request outright, which would leave the
           upload dead with nothing to show. The fallback re-runs the same request on
           another model inside the same call; it costs nothing unless it fires. */
        fallbacks: "default",
        system: SYSTEM,
        tools: [{ name: "write_up", description: "Return the mandate write-up.", input_schema: SCHEMA }],
        tool_choice: { type: "tool", name: "write_up" },
        /* A deal arrives as several files as often as one — a deck, a term
           sheet, a resource statement. They are ONE request rather than one
           each, because the write-up has to reconcile them: the raise amount is
           in the term sheet and the project detail is in the deck, and drafting
           them separately produces two half-answers nobody can merge.

           A PDF with no extractable text goes in as the FILE. That is not a
           fallback for broken documents — a mining deck exported as images is
           entirely ordinary, and it used to be refused outright. */
        messages: [{
          role: "user",
          content: [
            ...docs.filter((d) => d.vision).map((d) => ({
              type: "document" as const,
              source: {
                type: "base64" as const,
                media_type: "application/pdf" as const,
                data: Buffer.from(d.vision!).toString("base64"),
              },
              title: d.name,
            })),
            {
              type: "text" as const,
              text: docs.length === 1
                ? `File: ${docs[0].name}\n\n--- document text ---\n${docs[0].text || "(this file has no extractable text — read the attached PDF)"}`
                : `${docs.length} files for one raise. Read them together and produce ONE write-up.\n\n` +
                  docs.map((d) => `=== ${d.name} ===\n${d.text || "(no extractable text — read the attached PDF)"}`).join("\n\n"),
            },
          ],
        }],
      }),
    });
  } catch {
    throw new DraftFailed("Could not reach the drafting service. The file was not saved — try again.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    /* Credit exhaustion comes back as a 400, which otherwise reads as "your file
       was wrong" — it is not, and sending someone to re-export a perfectly good
       deck over a billing problem wastes their afternoon. */
    const credit = /credit balance is too low/i.test(body);
    throw new DraftFailed(
      credit ? "The drafting service is out of credit. The file is fine — this needs topping up on the Anthropic account before any deal can be drafted."
      : res.status === 401 ? "The drafting service rejected the server's key."
      : res.status === 429 ? "The drafting service is rate-limited right now. Try again in a minute."
      : `The drafting service returned ${res.status}. ${body.slice(0, 160)}`);
  }

  const payload = await res.json();
  const block = (payload.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  if (!block) throw new DraftFailed("The drafting service returned nothing usable.");
  return block.input as Record<string, unknown>;
}

/** Did the answer arrive with its evidence intact? */
function wellFormed(d: Record<string, unknown>): boolean {
  const ev = d.evidence;
  return !!ev && typeof ev === "object" && Object.keys(ev as object).length > 0;
}

/**
 * Read a PDF that has no extractable text, and write down what it says.
 *
 * WHY THIS EXISTS AS A SEPARATE STEP rather than just handing the file to the
 * drafting call: the guard that keeps invented figures off a deal page works by
 * checking every quoted sentence against the document's text. An image-only PDF
 * has no text, so the guard would drop every field and the deal page would come
 * back blank — which is exactly what a mining deck exported as pictures used to
 * produce.
 *
 * Transcribing first gives the guard something real to check, AND puts the text
 * on the deal where a person can read it back against the original. That
 * auditability is the whole reason `document_text` is stored at all.
 *
 * It is not a perfect check — the transcription and the draft come from the same
 * model, so a misread number could pass both. It is a far better one than none,
 * and the transcript is on the record for anyone who wants to look.
 */
async function transcribe(doc: SourceDoc, key: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: "You transcribe documents. Write out the text of every page exactly as it appears, in order, including numbers, units and table contents. Do not summarise, do not comment, do not correct anything. Prefix each page with [page N].",
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(doc.vision!).toString("base64") }, title: doc.name },
          { type: "text", text: "Transcribe this document." },
        ],
      }],
    }),
  });
  if (!res.ok) throw new DraftFailed("That PDF could not be read. Nothing was saved — try again.");
  const body = await res.json();
  const out = (body.content ?? []).filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text).join("\n").trim();
  if (out.length < 100) throw new DraftFailed("Almost nothing could be read from that PDF. If it is a scan, send a clearer copy or the term sheet instead.");
  return out;
}

export async function draftFromDocuments(docs: SourceDoc[]): Promise<DealDraft> {
  const fileName = docs[0]?.name ?? "document";
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new DraftFailed("ANTHROPIC_API_KEY is not set on the server, so the write-up cannot be drafted.");

  /* Any file with no extractable text is transcribed first, so the guard below
     has something real to check and the deal carries text a person can read
     back against the original. */
  for (const doc of docs) {
    if (doc.vision && !doc.text.trim()) doc.text = await transcribe(doc, key);
  }
  const text = docs.map((d) => d.text).filter(Boolean).join("\n\n");

  /* Ask twice at most. A malformed answer drops every checked field, and a deal
     page reading "the document did not state the raise amount" when the deck
     plainly does is worse than a slow upload. One retry takes the failure rate
     from about one in three to about one in nine. */
  let d = await ask(docs, key);
  if (!wellFormed(d)) d = await ask(docs, key);
  const malformed = !wellFormed(d);

  const str = (k: string) => String(d[k] ?? "").trim();
  const source = shingles(text);
  const evidence = (d.evidence ?? {}) as Record<string, string>;
  const gaps: string[] = [];

  /* The guard. A field that carries a quote the document does not support is
     dropped, not shown — and the drop is recorded so the gap is visible rather
     than silent. Summary and highlights are not quote-checked: they are written
     prose about the document, not claims lifted out of it. */
  const checked = (k: string, label: string): string => {
    const v = str(k);
    if (!v) { gaps.push(label); return ""; }
    if (!supported(evidence[k] ?? "", source, text)) {
      /* Two different reasons, and conflating them misleads. A missing quote
         because the draft came back broken is our problem; a quote the document
         does not support is the document's. */
      gaps.push(malformed
        ? `${label} (the draft came back incomplete — re-upload to try again)`
        : `${label} (dropped — the document does not say it)`);
      return "";
    }
    return v;
  };

  const highlights = asList(d.highlights).slice(0, 6);

  const title = cleanCompanyName(str("title") || fileName.replace(/\.[^.]+$/, ""));
  const summary = str("summary");
  if (!summary) gaps.push("summary");
  if (!highlights.length) gaps.push("highlights");

  return {
    title,
    website: str("website").replace(/^https?:\/\//, "").replace(/\/$/, ""),
    sector: str("sector"),
    countries: checked("countries", "countries"),
    stage: checked("stage", "stage"),
    raising: checked("raising", "raising"),
    valuation: checked("valuation", "valuation"),
    closing: checked("closing", "closing"),
    summary,
    highlights,
    gaps,
    model: MODEL,
    text,
  };
}
