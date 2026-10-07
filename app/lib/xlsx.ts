import "server-only";
import { zipSync, strToU8 } from "fflate";

/**
 * Writing a workbook with more than one sheet.
 *
 * WHY THIS EXISTS: a CSV is one table. Splitting an export into tabs is a
 * workbook feature and nothing else, so the choice was a real one — either the
 * file stays a CSV and the tiers stay in a column, or it becomes an .xlsx.
 *
 * An .xlsx is a zip of XML, and fflate is already here to read one, so writing
 * one adds no dependency.
 *
 * INLINE STRINGS, not a shared-string table. That table is how Excel avoids
 * storing the same word twice, and for an export read once and thrown away the
 * saving is worth nothing against a second index to keep in step. Every value
 * is written where it is used.
 *
 * EVERY CELL IS TEXT. A serial number that renders as a date, a leading zero
 * eaten off a phone number, a long id turned into scientific notation — all of
 * those come from letting a spreadsheet decide what a value is. This data is
 * names, addresses and identifiers.
 */

const CONTROL = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F]", "g");

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    /* Control characters are not legal in XML at all, and one in a cell makes
       Excel declare the whole file corrupt rather than skip the cell. Tab,
       newline and carriage return are legal and are kept. */
    .replace(CONTROL, "");

/** 0 -> A, 25 -> Z, 26 -> AA. */
function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export interface SheetData {
  /** Shown on the tab. Excel refuses some characters and caps it at 31. */
  name: string;
  /** Row 0 is the header. Everything is written as text. */
  rows: (string | number | null | undefined)[][];
}

/** Excel will not open a file whose tab name breaks its rules. */
function tabName(raw: string, used: Set<string>): string {
  let n = raw.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let i = 2;
  while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
}

function sheetXml(rows: SheetData["rows"]): string {
  const body = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const s = v === null || v === undefined ? "" : String(v);
      if (!s) return "";
      return `<c r="${colName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(s)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData>${body}</sheetData></worksheet>`;
}

export function buildXlsx(sheets: SheetData[]): Uint8Array {
  const used = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: tabName(s.name, used) }));

  const files: Record<string, Uint8Array> = {};

  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + named.map((_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
    + `</Types>`);

  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`);

  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
    + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`
    + named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")
    + `</sheets></workbook>`);

  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + named.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
    + `</Relationships>`);

  named.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows)); });

  return zipSync(files, { level: 6 });
}
