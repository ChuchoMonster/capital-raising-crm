import { describe, it, expect, vi, beforeEach } from "vitest";
import { zipSync, strToU8 } from "fflate";

/* previewImport is a server action: it checks the session and asks Postgres
   which addresses are already held. Both are replaced. */
vi.mock("@/app/lib/db", () => ({ query: vi.fn(), one: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ requireUser: vi.fn(async () => ({ name: "Demo User", email: "demo@example.com" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { query } from "@/app/lib/db";
import { parseCsv, parseXlsx, readSheet, UnreadableSheet, MAX_ROWS } from "@/app/lib/import/parse";
import { mapContacts, mapAccounts, readContact, readAccount, domainOf, looksLikeEmail } from "@/app/lib/import/map";
import { previewImport } from "@/app/lib/import/run";
import { buildXlsx } from "@/app/lib/xlsx";

const mQuery = vi.mocked(query);
const bytes = (s: string) => new TextEncoder().encode(s);

/** A minimal .xlsx: the shared-string table plus the first sheet. */
function workbook(sheetRows: string, shared: string[] = []): Uint8Array {
  return zipSync({
    "xl/workbook.xml": strToU8("<workbook/>"),
    "xl/sharedStrings.xml": strToU8(`<sst>${shared.join("")}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`),
  });
}

describe("parseCsv", () => {
  it("keeps commas, newlines and doubled quotes inside quoted fields", () => {
    const csv = 'Company,Note\n"Velmora, Quist & Co","Line one\nline two"\n"Says ""hello""",x';
    expect(parseCsv(csv)).toEqual([
      ["Company", "Note"],
      ["Velmora, Quist & Co", "Line one\nline two"],
      ['Says "hello"', "x"],
    ]);
  });

  it("drops an Excel byte-order mark so the first heading still matches", () => {
    expect(parseCsv("﻿Email,Name\r\na@b.example,Ana\r\n")[0][0]).toBe("Email");
  });

  it("handles Windows line endings and a missing final newline", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseXlsx", () => {
  it("places a value by its cell reference, so a blank cell does not shift the row left", () => {
    const xml = '<row r="1"><c r="A1" t="inlineStr"><is><t>Email</t></is></c><c r="C1" t="inlineStr"><is><t>Company</t></is></c></row>';
    expect(parseXlsx(workbook(xml))).toEqual([["Email", "", "Company"]]);
  });

  it("reads shared strings, joining rich-text runs and decoding entities", () => {
    const shared = [
      "<si><t>Velmora </t><r><t>Capital</t></r></si>",
      "<si><t>Smith &amp; Pell &lt;LLP&gt;</t></si>",
    ];
    const xml = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>42</v></c></row>';
    expect(parseXlsx(workbook(xml, shared))).toEqual([["Velmora Capital", "Smith & Pell <LLP>", "42"]]);
  });

  it("refuses a file that is not a readable zip", () => {
    expect(() => parseXlsx(bytes("PK not really a zip"))).toThrow(UnreadableSheet);
  });

  it("reads back a workbook written by the app's own exporter", () => {
    const out = buildXlsx([{ name: "Tier 1", rows: [["Firm", "Note"], ["Velmora Capital", "A & B <c>"], ["", "only B"]] }]);
    expect(parseXlsx(out)).toEqual([["Firm", "Note"], ["Velmora Capital", "A & B <c>"], ["", "only B"]]);
  });
});

describe("readSheet", () => {
  it("decides the format from the bytes, not the file name", () => {
    const xml = '<row r="1"><c r="A1" t="inlineStr"><is><t>Email</t></is></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>ana@velmora.example</t></is></c></row>';
    const sheet = readSheet("renamed.csv", workbook(xml));
    expect(sheet.rows).toEqual([{ Email: "ana@velmora.example" }]);
  });

  it("refuses the old .xls format with an instruction", () => {
    expect(() => readSheet("list.xls", bytes("x"))).toThrow(/save as \.xlsx or CSV/);
  });

  it("refuses an empty file", () => {
    expect(() => readSheet("empty.csv", bytes(",,\n , \n"))).toThrow("That file has nothing in it.");
  });

  it("keys rows by trimmed heading and drops blank rows", () => {
    const sheet = readSheet("a.csv", bytes(" Email , Name \nana@velmora.example , Ana \n,\n"));
    expect(sheet.headers).toEqual(["Email", "Name"]);
    expect(sheet.rows).toEqual([{ Email: "ana@velmora.example", Name: "Ana" }]);
  });

  it(`stops at ${MAX_ROWS} rows but reports how many there were`, () => {
    const csv = "Email\n" + Array.from({ length: MAX_ROWS + 3 }, (_, i) => `p${i}@velmora.example`).join("\n");
    const sheet = readSheet("big.csv", bytes(csv));
    expect(sheet.rows).toHaveLength(MAX_ROWS);
    expect(sheet.totalRows).toBe(MAX_ROWS + 3);
  });
});

describe("column mapping", () => {
  it("recognises the usual spellings of a heading", () => {
    const m = mapContacts(["E-mail Address", "Forename", "Surname", "Position", "Website"]);
    expect(m.fields).toEqual({
      email: "E-mail Address", firstName: "Forename", lastName: "Surname", jobTitle: "Position", domain: "Website",
    });
  });

  it('reads "Company Name" as the company, not the person', () => {
    const m = mapContacts(["Company Name", "Name"]);
    expect(m.fields.company).toBe("Company Name");
    expect(m.fields.name).toBe("Name");
  });

  it("names every column it could not place rather than dropping it silently", () => {
    expect(mapContacts(["Email", "Favourite Colour", "Shoe Size"]).ignored).toEqual(["Favourite Colour", "Shoe Size"]);
  });

  it("lets only the first matching heading claim a field", () => {
    const m = mapContacts(["Email", "Work Email"]);
    expect(m.fields.email).toBe("Email");
    expect(m.ignored).toEqual(["Work Email"]);
  });

  it("maps account sheets, with HQ as the country", () => {
    expect(mapAccounts(["Firm", "URL", "HQ", "Investor Type"]).fields)
      .toEqual({ name: "Firm", domain: "URL", country: "HQ", type: "Investor Type" });
  });
});

describe("reading a row through a mapping", () => {
  it("joins first and last name when there is no full-name column, and lower-cases the address", () => {
    const m = mapContacts(["Email", "First", "Last"]);
    const c = readContact({ Email: " Ana.Reyes@Velmora.Example ", First: "Ana", Last: " Reyes " }, m);
    expect(c.email).toBe("ana.reyes@velmora.example");
    expect(c.name).toBe("Ana Reyes");
    expect(c.domain).toBe("velmora.example");
  });

  it("prefers an explicit web-address column over the email domain", () => {
    const m = mapContacts(["Email", "Website"]);
    expect(readContact({ Email: "ana@mail.velmora.example", Website: "https://www.velmora.example/about" }, m).domain)
      .toBe("velmora.example");
  });

  it("normalises an account's web address", () => {
    const m = mapAccounts(["Company", "Website"]);
    expect(readAccount({ Company: "Velmora  Capital", Website: "HTTP://WWW.Velmora.Example/team?x=1" }, m))
      .toEqual({ name: "Velmora Capital", domain: "velmora.example", country: "", type: "", note: "" });
  });

  it("domainOf returns blank for something that is not a web address", () => {
    expect(domainOf("n/a")).toBe("");
    expect(domainOf("ana@velmora.example")).toBe("");
    expect(domainOf("velmora.example.")).toBe("velmora.example");
  });

  it("looksLikeEmail refuses what is obviously not an address", () => {
    expect(looksLikeEmail("ana@velmora.example")).toBe(true);
    expect(looksLikeEmail("ana@velmora")).toBe(false);
    expect(looksLikeEmail("Ana Reyes <ana@velmora.example>")).toBe(false);
    expect(looksLikeEmail("ana@velmora.example; jo@velmora.example")).toBe(false);
  });
});

/* ── The preview step: what would happen to every row ─────────────────────── */

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("previewImport — contacts", () => {
  beforeEach(() => {
    mQuery.mockReset();
    /* The database already holds one of the addresses. */
    mQuery.mockResolvedValue([{ email: "known@quistral.example" }] as never);
  });

  const CSV = [
    "Email,First Name,Last Name,Company Name,Job Title,Favourite Colour",
    "ana@velmora.example,Ana,Reyes,Velmora Capital,Partner,blue",
    "not-an-address,Jo,Pell,,,",
    ",No,Email,,,",
    "ANA@velmora.example,Ana,Again,,,",
    "known@quistral.example,Kim,Hale,Quistral,,",
    "ida@odrenna.example,,,,,",
  ].join("\n");

  it("refuses bad rows by line number, with the reason", async () => {
    const p = await previewImport("contacts", "list.csv", b64(CSV));
    expect(p.unusable).toEqual([
      { row: 3, why: '"not-an-address" is not an email address' },
      { row: 4, why: "no email address" },
      { row: 5, why: "ana@velmora.example appears twice in the file" },
    ]);
  });

  it("separates people already held from new ones", async () => {
    const p = await previewImport("contacts", "list.csv", b64(CSV));
    expect(p).toMatchObject({ ok: true, fileRows: 6, newRows: 2, knownRows: 1 });
    expect(p.message).toBe("2 new people to add.");
    expect(mQuery.mock.calls[0][1]).toEqual([["ana@velmora.example", "known@quistral.example", "ida@odrenna.example"]]);
  });

  it("shows the mapping and the unplaced columns before anything is written", async () => {
    const p = await previewImport("contacts", "list.csv", b64(CSV));
    expect(p.mapped).toMatchObject({ email: "Email", company: "Company Name" });
    expect(p.ignored).toEqual(["Favourite Colour"]);
    expect(p.sample?.[0]).toEqual({ Name: "Ana Reyes", Email: "ana@velmora.example", Company: "Velmora Capital", "Job title": "Partner" });
    expect(p.sample?.[1].Name).toBe("(no name)");
    expect(p.token).toBeTruthy();
  });

  it("refuses a sheet with no email column, naming the headings it did find", async () => {
    const p = await previewImport("contacts", "list.csv", b64("Name,Company\nAna,Velmora"));
    expect(p.ok).toBe(false);
    expect(p.message).toMatch(/No email column.*Name, Company/);
  });

  it("refuses a file over 4MB", async () => {
    const p = await previewImport("contacts", "big.csv", Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64"));
    expect(p.ok).toBe(false);
    expect(p.message).toMatch(/over 4MB/);
  });
});

describe("previewImport — accounts", () => {
  beforeEach(() => {
    mQuery.mockReset();
    mQuery.mockResolvedValue([] as never);
  });

  it("requires a web address and de-duplicates on it", async () => {
    const csv = [
      "Company,Website",
      "Velmora Capital,https://www.velmora.example",
      "Quistral Partners,",
      "Velmora Capital (dup),velmora.example/about",
      "Odrenna Fund,odrenna.example",
    ].join("\n");
    const p = await previewImport("accounts", "firms.csv", b64(csv));
    expect(p.unusable).toEqual([
      { row: 3, why: "Quistral Partners has no web address" },
      { row: 4, why: "velmora.example appears twice in the file" },
    ]);
    expect(p).toMatchObject({ newRows: 2, knownRows: 0, message: "2 new firms to add." });
  });
});
