import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  shingles, supported, cleanCompanyName, draftFromDocuments, DraftFailed,
} from "@/app/lib/deal/draft";

/* A fictional deck. Every check below is against this text. */
const DECK = [
  "Arkveld Zero Resources is advancing the Kessel Ridge copper project in Western Australia.",
  "The company is seeking to raise US$15 million through a private placement of new shares to fund the drilling program.",
  "A maiden resource of 1.2Mt at 1.8% Cu was declared in March following two seasons of step-out drilling across the eastern lode.",
  "Pre-money valuation of US$180 million.",
  "The first close is targeted for the fourth quarter of this year.",
].join("\n");
const SOURCE = shingles(DECK);
const ok = (quote: string) => supported(quote, SOURCE, DECK);

describe("shingles", () => {
  it("makes one six-word run per position", () => {
    expect([...shingles("one two three four five six seven")])
      .toEqual(["one two three four five six", "two three four five six seven"]);
  });

  it("keeps a passage shorter than six words as a single run", () => {
    expect([...shingles("Raising US$15 million")]).toEqual(["raising us$15 million"]);
  });

  it("flattens case and punctuation so two spellings compare equal", () => {
    expect(shingles("The Company, is SEEKING to raise!"))
      .toEqual(shingles("the company is seeking to raise"));
  });

  it("is empty for empty text", () => {
    expect(shingles("").size).toBe(0);
  });
});

describe("supported — a quote must really be in the document", () => {
  it("passes a verbatim sentence", () => {
    expect(ok("The company is seeking to raise US$15 million through a private placement of new shares")).toBe(true);
  });

  it("passes a quote with a leading clause dropped", () => {
    expect(ok("raise US$15 million through a private placement of new shares to fund the drilling program")).toBe(true);
  });

  it("passes two true fragments spliced together from different sentences", () => {
    expect(ok(
      "advancing the Kessel Ridge copper project in Western Australia. " +
      "A maiden resource of 1.2Mt at 1.8% Cu was declared in March",
    )).toBe(true);
  });

  it("fails an invented sentence", () => {
    expect(ok("The board has approved a special dividend of fifty cents per share payable in June")).toBe(false);
  });

  it("fails a real sentence with its central figure changed", () => {
    expect(ok("The company is seeking to raise US$25 million through a private placement of new shares")).toBe(false);
  });

  it("checks a short quote by direct containment, which six-word runs cannot do", () => {
    expect(ok("Pre-money valuation of US$180 million.")).toBe(true);
    expect(ok("Pre-money valuation of US$250 million.")).toBe(false);
  });

  it("ignores case and punctuation differences in a short quote", () => {
    expect(ok("PRE-MONEY VALUATION OF US$180 MILLION.")).toBe(true);
  });

  it("refuses an empty or trivially short quote", () => {
    expect(ok("")).toBe(false);
    expect(ok("US$15m")).toBe(false);
    expect(ok("   ")).toBe(false);
  });
});

describe("cleanCompanyName", () => {
  it("strips a bracketed listing", () => {
    expect(cleanCompanyName("Brevik Holdings Corp. (TSXV: QZX | OTCQX: QZXXF)")).toBe("Brevik Holdings Corp.");
  });

  it("strips a listing in a trailing dash or pipe clause, and both at once", () => {
    expect(cleanCompanyName("Kessel Gold - ASX: KGD")).toBe("Kessel Gold");
    expect(cleanCompanyName("Brevik Holdings Corp. (TSXV: QZX) | NYSE: QZ")).toBe("Brevik Holdings Corp.");
  });

  it("keeps brackets and dashes that are part of the name", () => {
    expect(cleanCompanyName("Acme (UK) Limited")).toBe("Acme (UK) Limited");
    expect(cleanCompanyName("Ostmark — Kessel Ridge")).toBe("Ostmark — Kessel Ridge");
  });
});

/* ── The whole drafting step, with the Anthropic API replaced ─────────────── */

function apiReturns(...answers: Record<string, unknown>[]) {
  const fetchMock = vi.fn();
  for (const input of answers) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      content: [{ type: "tool_use", name: "write_up", input }],
    }), { status: 200 }));
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const GOOD_ANSWER = {
  title: "Arkveld Zero Resources (ASX: AZR)",
  website: "https://arkveld-zero.example/",
  sector: "Mining — Copper",
  countries: "AU",
  stage: "Exploration",
  raising: "US$15 million",
  valuation: "US$180 million",
  closing: "Q4",
  summary: "Arkveld Zero is drilling a copper project in Western Australia.",
  highlights: "<item>Maiden resource of 1.2Mt at 1.8% Cu</item><item>US$15m private placement</item>",
  evidence: {
    countries: "advancing the Kessel Ridge copper project in Western Australia.",
    stage: "two seasons of step-out drilling across the eastern lode",
    raising: "The company is seeking to raise US$15 million through a private placement of new shares",
    valuation: "Pre-money valuation of US$180 million.",
    closing: "The first close is targeted for the fourth quarter of this year.",
  },
};

describe("draftFromDocuments — fields are only kept with evidence", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  });

  it("keeps every field the document supports and tidies title and website", async () => {
    apiReturns(GOOD_ANSWER);
    const d = await draftFromDocuments([{ name: "deck.pdf", text: DECK }]);
    expect(d.title).toBe("Arkveld Zero Resources");
    expect(d.website).toBe("arkveld-zero.example");
    expect(d.raising).toBe("US$15 million");
    expect(d.valuation).toBe("US$180 million");
    expect(d.gaps).toEqual([]);
  });

  it("repairs highlights that arrive as <item> markup instead of a list", async () => {
    apiReturns(GOOD_ANSWER);
    const d = await draftFromDocuments([{ name: "deck.pdf", text: DECK }]);
    expect(d.highlights).toEqual(["Maiden resource of 1.2Mt at 1.8% Cu", "US$15m private placement"]);
  });

  it("drops a figure whose quote the document does not contain, and says so", async () => {
    apiReturns({
      ...GOOD_ANSWER,
      valuation: "US$300 million",
      evidence: { ...GOOD_ANSWER.evidence, valuation: "Post-money valuation of US$300 million." },
    });
    const d = await draftFromDocuments([{ name: "deck.pdf", text: DECK }]);
    expect(d.valuation).toBe("");
    expect(d.gaps).toEqual(["valuation (dropped — the document does not say it)"]);
  });

  it("records an unstated field as a plain gap rather than inventing one", async () => {
    apiReturns({ ...GOOD_ANSWER, closing: "", evidence: { ...GOOD_ANSWER.evidence, closing: "" } });
    const d = await draftFromDocuments([{ name: "deck.pdf", text: DECK }]);
    expect(d.closing).toBe("");
    expect(d.gaps).toEqual(["closing"]);
  });

  it("asks once more when the answer comes back without evidence", async () => {
    const fetchMock = apiReturns({ ...GOOD_ANSWER, evidence: {} }, GOOD_ANSWER);
    const d = await draftFromDocuments([{ name: "deck.pdf", text: DECK }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(d.raising).toBe("US$15 million");
  });

  it("blames the incomplete draft, not the document, when both attempts lack evidence", async () => {
    apiReturns({ ...GOOD_ANSWER, evidence: {} }, { ...GOOD_ANSWER, evidence: {} });
    const d = await draftFromDocuments([{ name: "deck.pdf", text: DECK }]);
    expect(d.raising).toBe("");
    expect(d.gaps).toContain("raising (the draft came back incomplete — re-upload to try again)");
  });

  it("refuses to run without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(draftFromDocuments([{ name: "deck.pdf", text: DECK }])).rejects.toBeInstanceOf(DraftFailed);
  });

  it("reports an out-of-credit account as a billing problem, not a bad file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response('{"error":{"message":"Your credit balance is too low"}}', { status: 400 })));
    await expect(draftFromDocuments([{ name: "deck.pdf", text: DECK }]))
      .rejects.toThrow(/out of credit\. The file is fine/);
  });
});
