import { describe, it, expect, vi, beforeEach } from "vitest";

/* tierFirms reads two queries: the investor firms, then their people. The
   database is replaced so the test supplies both, and everything else —
   scope, the last-contact helpers in store.ts — is the real code. */
vi.mock("@/app/lib/db", () => ({ query: vi.fn(), one: vi.fn() }));

import { query } from "@/app/lib/db";
import { askFromDeal, bandsFor, parseRaise, tierFirms, type DealAsk } from "@/app/lib/tiering";

const mockedQuery = vi.mocked(query);

interface FirmRow {
  id: string; name: string; type: string[] | null; aum: string | null;
  countries: string[] | null; investsIn: string[] | null;
  metals: string[] | null; via: string[] | null; sectors: string[] | null;
  sectorList: string[] | null; countryNames: string[] | null; investsInNames: string[] | null;
}

/** A firm that answers every question for a copper deal in Australia. */
function firm(over: Partial<FirmRow> & { id: string; name: string }): FirmRow {
  return {
    type: ["Private Equity"], aum: "$1bn - $10bn", countries: ["AU"], investsIn: [],
    metals: ["Copper"], via: ["Equity"], sectors: ["Mining — Copper"],
    sectorList: ["Mining"], countryNames: ["Australia"], investsInNames: [],
    ...over,
  };
}

function serve(firms: FirmRow[], people: Record<string, unknown>[] = []) {
  mockedQuery.mockImplementation(async (sql: string) =>
    (sql.includes("from accounts a") ? firms : people) as never);
}

const COPPER_AU: DealAsk = askFromDeal({ sector: "Mining — Copper", countries: "AU", raising: "Raising $15m" });

/* A block body: a function returned from beforeEach is run as a cleanup hook. */
beforeEach(() => { mockedQuery.mockReset(); });

describe("parseRaise", () => {
  it("reads millions and billions in the ways decks write them", () => {
    expect(parseRaise("US$15M")).toBe(15e6);
    expect(parseRaise("up to $15 million")).toBe(15e6);
    expect(parseRaise("$1.2bn")).toBe(1.2e9);
    expect(parseRaise("$2,500 mm")).toBe(2.5e9);
  });

  it("takes the first figure when there are several", () => {
    expect(parseRaise("$15m now and a further $40m at construction")).toBe(15e6);
  });

  it("refuses a figure with no unit or no dollar sign rather than guessing", () => {
    expect(parseRaise("$15,000,000")).toBeNull();
    expect(parseRaise("€15m")).toBeNull();
    expect(parseRaise("")).toBeNull();
  });
});

describe("askFromDeal — minerals are whole words only", () => {
  it('does not read "green" as REE (rare earths)', () => {
    const ask = askFromDeal({ sector: "Green hydrogen and clean iron", countries: "", raising: "" });
    expect(ask.minerals).not.toContain("Rare Earths");
    expect(ask.minerals).toEqual(["Iron Ore"]);
  });

  it('does not read tin inside "platinum", and maps platinum/palladium to PGM once', () => {
    const ask = askFromDeal({ sector: "Platinum and palladium", countries: "", raising: "" });
    expect(ask.minerals).toEqual(["PGM"]);
  });

  it("recognises a standalone REE and stated vocabulary words", () => {
    const ask = askFromDeal({ sector: "REE and tin exploration", countries: "", raising: "" });
    expect(ask.minerals).toEqual(expect.arrayContaining(["Rare Earths", "Tin"]));
    expect(ask.minerals).toHaveLength(2);
  });

  it("maps coking coal to Coal", () => {
    expect(askFromDeal({ sector: "Coking coal", countries: "", raising: "" }).minerals).toEqual(["Coal"]);
  });
});

describe("askFromDeal — sectors, countries and the fund-size range", () => {
  it("adds Battery & Critical Minerals when a battery metal is named", () => {
    const ask = askFromDeal({ sector: "Mining — Lithium", countries: "", raising: "" });
    expect(ask.sectors).toEqual(["Mining", "Battery & Critical Minerals"]);
  });

  it("falls back to Mining when nothing in the sector text is recognised", () => {
    expect(askFromDeal({ sector: "", countries: "", raising: "" }).sectors).toEqual(["Mining"]);
  });

  it("splits countries on commas and semicolons and upper-cases them", () => {
    expect(askFromDeal({ sector: "Mining", countries: "au; ca , gh", raising: "" }).countries)
      .toEqual(["AU", "CA", "GH"]);
  });

  it("sets the fund floor at 10x and the ceiling at 650x the raise", () => {
    expect(COPPER_AU.raiseUsd).toBe(15e6);
    expect(COPPER_AU.fundFloor).toBe(150e6);
    expect(COPPER_AU.fundCeiling).toBe(15e6 * 650);
  });

  it("leaves the range open when the raise could not be read", () => {
    const ask = askFromDeal({ sector: "Mining", countries: "", raising: "to be confirmed" });
    expect(ask.fundFloor).toBeNull();
    expect(ask.fundCeiling).toBeNull();
  });
});

describe("bandsFor", () => {
  it("keeps only the fund sizes that can realistically write the cheque", () => {
    expect(bandsFor(COPPER_AU)).toEqual(["$100m - $1bn", "$1bn - $10bn"]);
  });

  it("allows every band when the raise is unknown — absence never rules anyone out", () => {
    const ask = askFromDeal({ sector: "Mining", countries: "", raising: "" });
    expect(bandsFor(ask)).toHaveLength(5);
  });
});

describe("tierFirms — ruled out by evidence, never by absence", () => {
  it("drops a firm whose known fund size is outside the range", async () => {
    serve([firm({ id: "A1", name: "Velmora Capital", aum: "$100bn+" })]);
    expect(await tierFirms("D-1", COPPER_AU, null)).toEqual([]);
  });

  it("drops a firm known to do debt only", async () => {
    serve([firm({ id: "A1", name: "Quistral Credit", via: ["Debt"] })]);
    expect(await tierFirms("D-1", COPPER_AU, null)).toEqual([]);
  });

  it("keeps a firm with every field blank, and puts it in Tier 3 with the gaps named", async () => {
    serve([firm({
      id: "A1", name: "Odrenna Partners", aum: null, via: null, sectors: null,
      metals: null, countries: null, investsIn: null,
    })]);
    const [f] = await tierFirms("D-1", COPPER_AU, null);
    expect(f.tier).toBe(3);
    /* A blank office location is not a geography gap. */
    expect(f.gaps).toEqual(["sector", "minerals", "fund size", "equity"]);
  });

  it("does not run the people query when no firm survives", async () => {
    serve([firm({ id: "A1", name: "Velmora Capital", aum: "$100bn+" })]);
    await tierFirms("D-1", COPPER_AU, null);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it("passes the issuer and the deal reference to the firm query", async () => {
    serve([]);
    await tierFirms("D-7", COPPER_AU, "ISSUER-1");
    expect(mockedQuery.mock.calls[0][1]).toEqual(["ISSUER-1", "D-7"]);
  });
});

describe("tierFirms — tiers count what is still unknown", () => {
  it("puts a firm that answers everything in Tier 1", async () => {
    serve([firm({ id: "A1", name: "Velmora Capital" })]);
    const [f] = await tierFirms("D-1", COPPER_AU, null);
    expect(f.tier).toBe(1);
    expect(f.gaps).toEqual([]);
  });

  it("treats a fund size of N/A as a pass — a strategic buyer is not a fund", async () => {
    serve([firm({ id: "A1", name: "Tarnholt Metals", type: ["Corporate/Strategic"], aum: "N/A" })]);
    const [f] = await tierFirms("D-1", COPPER_AU, null);
    expect(f.tier).toBe(1);
  });

  it("drops one tier for one unknown", async () => {
    serve([firm({ id: "A1", name: "Velmora Capital", metals: ["Gold"] })]);
    const [f] = await tierFirms("D-1", COPPER_AU, null);
    expect(f.gaps).toEqual(["minerals"]);
    expect(f.tier).toBe(2);
  });

  it("caps at Tier 3 however many questions are open", async () => {
    serve([firm({ id: "A1", name: "Velmora Capital", metals: ["Gold"], sectors: ["Generalist"], aum: null, countries: ["CA"] })]);
    const [f] = await tierFirms("D-1", COPPER_AU, null);
    expect(f.gaps).toHaveLength(4);
    expect(f.tier).toBe(3);
  });

  it("matches a sector on the head of a qualified value", async () => {
    serve([firm({ id: "A1", name: "Velmora Capital", sectors: ["Mining — Gold", "Energy - Oil & Gas"] })]);
    const [f] = await tierFirms("D-1", COPPER_AU, null);
    expect(f.gaps).not.toContain("sector");
  });
});

describe("tierFirms — geography", () => {
  it("counts an office elsewhere as a geography gap", async () => {
    serve([firm({ id: "A1", name: "Velmora Capital", countries: ["CA"] })]);
    const [f] = await tierFirms("D-1", COPPER_AU, null);
    expect(f.gaps).toEqual(["geography"]);
  });

  it("accepts where a firm invests even when its office is elsewhere", async () => {
    serve([firm({ id: "A1", name: "Velmora Capital", countries: ["HK"], investsIn: ["AU", "SG"] })]);
    const [f] = await tierFirms("D-1", COPPER_AU, null);
    expect(f.gaps).toEqual([]);
    expect(f.countries).toEqual(["HK", "AU", "SG"]);
  });

  it("asks no geography question when the deal names no countries", async () => {
    const anywhere = askFromDeal({ sector: "Mining — Copper", countries: "", raising: "$15m" });
    serve([firm({ id: "A1", name: "Velmora Capital", countries: ["CA"] })]);
    const [f] = await tierFirms("D-1", anywhere, null);
    expect(f.tier).toBe(1);
  });
});

describe("tierFirms — people and ordering", () => {
  it("orders by tier, then by how many people at the firm have replied", async () => {
    serve(
      [
        firm({ id: "A1", name: "Aldervane Capital" }),
        firm({ id: "A2", name: "Brisk Hollow Partners" }),
        firm({ id: "A3", name: "Cendral Fund", metals: ["Gold"] }),
      ],
      [
        { accountId: "A1", id: "C1", name: "Mara Ellison", email: "mara@aldervane.example", replied: false },
        { accountId: "A2", id: "C2", name: "Jonas Pell", email: "jonas@briskhollow.example", replied: true },
        { accountId: "A3", id: "C3", name: "Ida Wren", email: "ida@cendral.example", replied: true },
      ],
    );
    const firms = await tierFirms("D-1", COPPER_AU, null);
    expect(firms.map((f) => f.name)).toEqual(["Brisk Hollow Partners", "Aldervane Capital", "Cendral Fund"]);
  });

  it("counts a reply that arrived after the import as a reply", async () => {
    serve(
      [firm({ id: "A1", name: "Aldervane Capital" })],
      [{
        accountId: "A1", id: "C1", name: "Mara Ellison", email: "mara@aldervane.example",
        replied: false, sent_at: "2026-09-01T10:00:00Z", reply_at: "2026-09-02T09:00:00Z",
        lc_sender: "partner@halden-ridge.example", deal_title: "Arkveld Zero", deal_ref: "D-1",
      }],
    );
    const [f] = await tierFirms("D-1", COPPER_AU, null);
    const [c] = f.contacts;
    expect(c.replied).toBe(true);
    expect(c.lastContact).toEqual({
      date: "2026-09-01", repliedDate: "2026-09-02", deal: "Arkveld Zero",
      dealId: "D-1", sender: "partner@halden-ridge.example", replied: true,
    });
  });

  it("exposes facet values from the stored columns, with no empty AUM option", async () => {
    serve([firm({ id: "A1", name: "Velmora Capital", aum: null })]);
    const [f] = await tierFirms("D-1", COPPER_AU, null);
    expect(f.facets.aum).toEqual([]);
    expect(f.facets.commodity).toEqual(["Copper"]);
  });
});
