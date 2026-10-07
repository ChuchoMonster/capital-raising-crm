import "server-only";
import { unzipSync, strFromU8 } from "fflate";

/**
 * A spreadsheet in, rows of named values out.
 *
 * TWO FORMATS, because that is what people have. A CSV is what a CRM exports
 * and an .xlsx is what somebody has been keeping the list in — telling them to
 * convert it first is a step that gets skipped, and then the file that arrives
 * is a CSV saved by Excel with whatever encoding the machine felt like.
 *
 * THE FIRST ROW IS THE HEADER. Everything below is a row keyed by it. Nothing
 * here interprets what a column MEANS — that is the next step, and keeping the
 * two apart is what lets the mapping be shown to a person and corrected
 * without re-reading the file.
 */

export class UnreadableSheet extends Error {}

export interface Sheet {
  /** The header row, in the order it appeared, trimmed. */
  headers: string[];
  /** One object per row, keyed by header. Blank rows are dropped. */
  rows: Record<string, string>[];
  /** Rows read before any limit was applied — so a truncation can be reported. */
  totalRows: number;
}

/** Beyond this a spreadsheet is a data migration, not a list somebody typed. */
export const MAX_ROWS = 20000;

/* ── CSV ─────────────────────────────────────────────────────────────────── */

/**
 * A real CSV reader, not a split on commas.
 *
 * Quoted fields hold commas, newlines and doubled quotes, and every one of
 * those appears in ordinary data — a company called "Smith, Jones & Co", an
 * address on two lines. Splitting on commas turns those into shifted columns,
 * which this project has already been bitten by once when a master file was
 * read that way and silently wrote "CRM" into an investor-type column.
 */
export function parseCsv(text: string): string[][] {
  /* A byte-order mark from Excel would otherwise become part of the first
     header, so "Email" never matches. */
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ",") { endField(); i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) endRow();
  return rows;
}

/* ── XLSX ────────────────────────────────────────────────────────────────── */

/** The text of one XML element, entities decoded. */
function xmlText(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** "BC7" -> 54. Which column a cell is in, whatever is missing before it. */
function columnOf(ref: string): number {
  const letters = ref.replace(/\d+$/, "");
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Read the first sheet of an .xlsx.
 *
 * An .xlsx is a zip of XML. Only two parts are needed: the shared-string table,
 * where every piece of text in the workbook actually lives, and the sheet
 * itself, which mostly holds indexes into it. A cell with `t="s"` is one of
 * those indexes; anything else is a literal, and `t="inlineStr"` carries its
 * own text.
 *
 * EMPTY CELLS ARE NOT WRITTEN AT ALL, which is the thing that catches people
 * out: a row whose second column is blank jumps straight from A to C, so the
 * position must be read off each cell's own reference rather than counted.
 * Counting is how a blank cell shifts every value after it one column left.
 *
 * Dates come back as the underlying serial number rather than a date. Nothing
 * this imports is a date, so they are left as they are rather than half-guessed.
 */
export function parseXlsx(buf: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, {
      filter: (f) => /^xl\/(sharedStrings\.xml|worksheets\/sheet1\.xml|workbook\.xml)$/.test(f.name),
    });
  } catch {
    throw new UnreadableSheet("That file could not be opened. If it is password-protected, remove the protection and try again.");
  }

  const sheetXml = files["xl/worksheets/sheet1.xml"];
  if (!sheetXml) throw new UnreadableSheet("That workbook has no readable first sheet. Save it as CSV and try again.");

  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    const xml = strFromU8(files["xl/sharedStrings.xml"]);
    for (const si of xml.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
      /* A string split across several runs — bold in the middle of a cell —
         arrives as several <t> and must be joined, not have the first one
         taken. */
      const runs = si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? [];
      shared.push(runs.map(xmlText).join(""));
    }
  }

  const xml = strFromU8(sheetXml);
  const out: string[][] = [];
  for (const rowXml of xml.match(/<row\b[\s\S]*?(?:\/>|<\/row>)/g) ?? []) {
    const row: string[] = [];
    for (const cell of rowXml.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) ?? []) {
      const ref = cell.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = cell.match(/\bt="([^"]+)"/)?.[1] ?? "n";
      const at = ref ? columnOf(ref) : row.length;
      let value = "";
      if (type === "s") {
        const idx = Number(xmlText(cell.match(/<v>[\s\S]*?<\/v>/)?.[0] ?? ""));
        value = shared[idx] ?? "";
      } else if (type === "inlineStr") {
        value = (cell.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map(xmlText).join("");
      } else {
        value = xmlText(cell.match(/<v>[\s\S]*?<\/v>/)?.[0] ?? "");
      }
      while (row.length < at) row.push("");
      row[at] = value;
    }
    out.push(row);
  }
  return out;
}

/* ── Either one ──────────────────────────────────────────────────────────── */

const looksXlsx = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b; // "PK"

export function readSheet(name: string, bytes: Uint8Array): Sheet {
  const ext = "." + (name.split(".").pop() ?? "").toLowerCase();
  if (ext === ".xls")
    throw new UnreadableSheet("That is the old Excel format. Open it and save as .xlsx or CSV, then try again.");

  /* The BYTES decide, not the extension. A file named .csv that is really a
     workbook is common — somebody renamed it — and reading a zip as text
     produces a header row of mojibake and a very confusing error. */
  const grid = looksXlsx(bytes)
    ? parseXlsx(bytes)
    : parseCsv(new TextDecoder("utf-8").decode(bytes));

  const nonEmpty = grid.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) throw new UnreadableSheet("That file has nothing in it.");

  const headers = nonEmpty[0].map((h) => h.trim());
  if (!headers.some(Boolean))
    throw new UnreadableSheet("The first row must be the column headings, and it is empty.");

  const body = nonEmpty.slice(1);
  const rows = body.slice(0, MAX_ROWS).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) o[h] = (r[i] ?? "").trim(); });
    return o;
  });

  return { headers: headers.filter(Boolean), rows, totalRows: body.length };
}
