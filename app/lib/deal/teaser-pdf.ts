import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { Teaser } from "./teaser";

/**
 * Typesetting the teaser onto two pages of paper.
 *
 * WHY IT IS DRAWN RATHER THAN PRINTED FROM HTML. The obvious route is a
 * headless browser rendering the same markup the deal page shows. That means
 * Chromium on a serverless function — a 50MB binary, a cold start measured in
 * seconds, and a dependency that breaks on a platform upgrade rather than on
 * anything we changed. This draws the page directly: no browser, no fonts to
 * ship, and the output is byte-identical every time, which matters because the
 * same file is attached to an email.
 *
 * THE LAYOUT IS FIXED AND THE CONTENT IS TRIMMED TO FIT. Two pages was the
 * instruction, and two pages is a promise about how long it takes to read.
 * Every block below is given a budget, and text that will not fit inside it is
 * cut at a word boundary rather than allowed to run over the next block. A
 * teaser with a sentence missing its tail is untidy; a teaser whose team names
 * are printed on top of the footer is unusable.
 *
 * The house colours are Halden Ridge's own — the deep blue of the app's panel headers
 * for the band, amber on the dark and the skyline blue on the white. The
 * company's name is the wordmark and Halden Ridge signs the foot of each page, because
 * this is Halden Ridge's document about somebody else's business.
 */

const PAGE_W = 612, PAGE_H = 792;   // US Letter
const M = 46;                        // margin
const COL = PAGE_W - M * 2;          // 520pt of usable width

const NAVY = rgb(0x17 / 255, 0x42 / 255, 0x7f / 255);
const NAVY_DEEP = rgb(0x0b / 255, 0x25 / 255, 0x4c / 255);
const INK = rgb(0x0a / 255, 0x0a / 255, 0x0a / 255);
const INK2 = rgb(0x45 / 255, 0x4a / 255, 0x51 / 255);
const INK3 = rgb(0x8a / 255, 0x90 / 255, 0x99 / 255);
const LINE = rgb(0xd8 / 255, 0xdd / 255, 0xe3 / 255);
const ACCENT = rgb(0x28 / 255, 0x74 / 255, 0xfc / 255);
const AMBER = rgb(0xe0 / 255, 0xa0 / 255, 0x4a / 255);
const WHITE = rgb(1, 1, 1);
const SUNKEN = rgb(0xf4 / 255, 0xf6 / 255, 0xf8 / 255);

/** The lowest a block may sit: the footer's rule, plus air. */
const FLOOR = 82;
/** The least space between two blocks before they read as one. */
const AIR_MIN = 20;

export interface TeaserAssets {
  /** The hero picture. JPEG bytes — from the deck where we found one. */
  hero?: Uint8Array;
  /** A second picture for page two. Falls back to the hero. */
  second?: Uint8Array;
}

/**
 * Make a string the standard fonts can actually set.
 *
 * Helvetica is encoded WinAnsi, and pdf-lib THROWS on a character outside it
 * rather than dropping it — so one stray arrow or minus sign out of a deck
 * fails the whole file, at attach time, on an email somebody is waiting to
 * send. The common offenders are mapped to their nearest real character and
 * anything still outside the range is dropped.
 */
const MAP: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"', "′": "'", "″": '"',
  "–": "–", "—": "—", "−": "-", "‐": "-", "‑": "-",
  "→": "->", "←": "<-", "⇒": "=>",
  "≥": ">=", "≤": "<=", "≈": "~", "≠": "!=",
  " ": " ", " ": " ", " ": " ", "​": "",
  "•": "·", "…": "...", "‰": "%o",
  "²": "2", "³": "3", "₂": "2", "₃": "3", "₄": "4",
  "Δ": "delta", "µ": "u", "μ": "u", "™": "(TM)",
};
function safe(s: string): string {
  let out = "";
  for (const ch of String(s ?? "")) {
    if (ch in MAP) { out += MAP[ch]; continue; }
    const c = ch.codePointAt(0)!;
    /* WinAnsi covers Latin-1 plus a handful in 0x80-0x9F that pdf-lib maps. */
    if (c === 10 || c === 13) { out += " "; continue; }
    if (c >= 32 && c <= 126) { out += ch; continue; }
    if (c >= 0xa1 && c <= 0xff) { out += ch; continue; }
    if (c === 0x2013 || c === 0x2014 || c === 0x20ac) { out += ch; continue; }
    /* Anything else is dropped rather than substituted — a wrong glyph in a
       figure would be worse than a missing one. */
  }
  return out.replace(/\s+/g, " ").trim();
}

interface Ctx { page: PDFPage; reg: PDFFont; bold: PDFFont }

const width = (f: PDFFont, s: string, size: number) => f.widthOfTextAtSize(safe(s), size);

/** Break text to a column. */
function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const words = safe(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (width(font, next, size) <= max || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Cut a wrapped block to a number of lines, marking the cut.
 *
 * The ellipsis is not decoration. A sentence that simply stops mid-clause
 * reads as a broken file; one that stops with a mark reads as a summary, which
 * is what a teaser is. Every column on these pages goes through this.
 */
function clip(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const out = lines.slice(0, max);
  out[max - 1] = `${out[max - 1].replace(/[,;:.\s]+$/, "")}...`;
  return out;
}

/**
 * Set a line at the largest of the given sizes that fits, rather than cut it.
 *
 * For the handful of places where the text is a NAME. Everything else on these
 * pages may be trimmed; a person's name may not.
 */
function shrinkToFit(s: string, font: PDFFont, max: number, sizes: number[]): [string, number] {
  const clean = safe(s);
  for (const size of sizes) if (width(font, clean, size) <= max) return [clean, size];
  const last = sizes[sizes.length - 1];
  return [wrap(clean, font, last, max)[0] ?? clean, last];
}

/**
 * Draw wrapped text, never past `maxLines`.
 *
 * The cut is the point. Every block on these two pages has a fixed height, and
 * a paragraph one line too long would print over whatever is beneath it. When
 * it has to cut, it cuts at a word and marks it, so the reader can see the
 * sentence was trimmed rather than wondering whether that was the whole thought.
 */
function text(
  c: Ctx, s: string,
  o: { x: number; y: number; size: number; max: number; font?: PDFFont; color?: RGB; lead?: number; maxLines?: number },
): number {
  const font = o.font ?? c.reg;
  const lead = o.lead ?? o.size * 1.32;
  let lines = wrap(s, font, o.size, o.max);
  if (o.maxLines && lines.length > o.maxLines) {
    lines = lines.slice(0, o.maxLines);
    const last = lines[lines.length - 1].replace(/[,;:.\s]+$/, "");
    lines[lines.length - 1] = `${last}...`;
  }
  let y = o.y;
  for (const line of lines) {
    c.page.drawText(line, { x: o.x, y, size: o.size, font, color: o.color ?? INK });
    y -= lead;
  }
  return y + lead - o.size * 0.28; // the baseline-to-bottom of the block
}

/**
 * A section heading with a coloured full stop.
 *
 * Lifted straight from the reference two-pager, where every heading is a
 * sentence and the stop is picked out in the brand colour. It is one small
 * mark and it is most of what makes the page look designed rather than typed.
 */
function heading(c: Ctx, s: string, x: number, y: number, size: number, color: RGB, dot: RGB, max = COL): number {
  const clean = safe(s);
  const stop = clean.endsWith(".") ? "." : "";
  const body = stop ? clean.slice(0, -1) : clean;
  const lines = wrap(body, c.bold, size, max);
  let cy = y;
  lines.forEach((line, i) => {
    c.page.drawText(line, { x, y: cy, size, font: c.bold, color });
    if (i === lines.length - 1 && stop) {
      c.page.drawText(".", { x: x + width(c.bold, line, size), y: cy, size, font: c.bold, color: dot });
    }
    cy -= size * 1.2;
  });
  return cy + size * 1.2;
}

/** A rounded rectangle, which pdf-lib has no primitive for. */
function roundRect(
  c: Ctx,
  o: { x: number; y: number; w: number; h: number; r?: number; fill?: RGB; border?: RGB; thickness?: number; opacity?: number },
) {
  const r = Math.min(o.r ?? 6, o.w / 2, o.h / 2);
  const { w, h } = o;
  /* drawSvgPath puts the path's origin at the given point and runs y DOWNWARD,
     so the origin is the TOP-left corner, not the bottom-left that every other
     pdf-lib call takes. Getting that backwards silently draws off the page. */
  const d =
    `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} ` +
    `A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} ` +
    `V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  c.page.drawSvgPath(d, {
    x: o.x, y: o.y + h,
    color: o.fill, borderColor: o.border,
    borderWidth: o.border ? (o.thickness ?? 1) : undefined,
    opacity: o.opacity, borderOpacity: o.opacity,
  });
}

/**
 * The photograph behind the hero band, with the blue laid over it.
 *
 * The overlay is drawn as a run of thin strips because a PDF has no gradient
 * primitive that pdf-lib exposes. Forty strips at 8pt is indistinguishable
 * from a real gradient at reading distance and costs nothing.
 *
 * It is DARKEST ON THE LEFT, where the headline sits, and thinnest on the
 * right, where the picture is meant to show. That is the reference layout and
 * it is also the only way white type stays readable over an unknown photograph
 * — we cannot know what is in the picture, so the type side is covered.
 */
function heroBand(c: Ctx, img: { width: number; height: number } | null, drawImage: (x: number, y: number, w: number, h: number) => void, top: number, h: number) {
  const y = top - h;
  c.page.drawRectangle({ x: 0, y, width: PAGE_W, height: h, color: NAVY_DEEP });

  if (img) {
    /* Cover, not fit: a letterboxed photograph in a coloured band looks like a
       mistake. The overflow is cropped by the band, which is what a CSS
       background-size: cover does and what the eye expects. */
    const scale = Math.max(PAGE_W / img.width, h / img.height);
    const w = img.width * scale, ih = img.height * scale;
    drawImage((PAGE_W - w) / 2, y + (h - ih) / 2, w, ih);
  }

  const strips = 44;
  for (let i = 0; i < strips; i++) {
    const t = i / (strips - 1);
    /* 0.95 at the left, 0.32 at the right. Eased so the fall is gentle across
       the middle rather than a visible band edge. */
    const opacity = 0.95 - 0.63 * Math.pow(t, 0.85);
    c.page.drawRectangle({
      x: (PAGE_W / strips) * i, y,
      width: PAGE_W / strips + 0.6, height: h,
      color: NAVY, opacity,
    });
  }
  /* A hairline of amber along the foot, the one warm mark on the page. */
  c.page.drawRectangle({ x: 0, y, width: PAGE_W, height: 2.5, color: AMBER });
}

/**
 * Letterspaced text, drawn a character at a time.
 *
 * pdf-lib has no character-spacing option, and tracking is what makes a name
 * read as a wordmark rather than as a word. Returns the width it drew, because
 * the caller cannot work it out from the font any more.
 */
function tracked(c: Ctx, s: string, o: { x: number; y: number; size: number; font: PDFFont; color: RGB; track: number }): number {
  let x = o.x;
  for (const ch of safe(s)) {
    c.page.drawText(ch, { x, y: o.y, size: o.size, font: o.font, color: o.color });
    x += o.font.widthOfTextAtSize(ch, o.size) + o.track;
  }
  return x - o.x - o.track;
}

const trackedWidth = (f: PDFFont, s: string, size: number, track: number) =>
  width(f, s, size) + Math.max(0, safe(s).length - 1) * track;

/** Company name top-left, set as a wordmark. */
function wordmark(c: Ctx, name: string, y: number, color: RGB) {
  tracked(c, name.toUpperCase(), { x: M, y, size: 13, font: c.bold, color, track: 1.6 });
}

function footer(c: Ctx, t: Teaser) {
  const y = 34;
  c.page.drawRectangle({ x: M, y: y + 16, width: COL, height: 0.75, color: LINE });
  const name = safe(t.company).toUpperCase();
  let x = M + tracked(c, name, { x: M, y, size: 8, font: c.bold, color: INK2, track: 1.1 }) + 12;
  if (t.tagline) {
    c.page.drawText("|", { x, y, size: 8, font: c.reg, color: INK3 });
    tracked(c, t.tagline, { x: x + 10, y, size: 8, font: c.reg, color: INK3, track: 1.1 });
  }
  /* Halden Ridge signs it. The company is the subject of this document; Halden Ridge is the
     sender, and an investor needs to know in one glance which is which. */
  const sign = "HALDEN RIDGE ADVISORS";
  x = PAGE_W - M - trackedWidth(c.bold, sign, 8, 1.1);
  tracked(c, sign, { x, y, size: 8, font: c.bold, color: NAVY, track: 1.1 });
}

/** A numbered marker standing in for the reference's line-drawn icons. */
function marker(c: Ctx, n: number, x: number, y: number, color: RGB) {
  c.page.drawCircle({ x: x + 7, y: y + 4, size: 7.5, borderColor: color, borderWidth: 1, color: undefined });
  const label = String(n);
  c.page.drawText(label, { x: x + 7 - width(c.bold, label, 8) / 2, y: y + 1.3, size: 8, font: c.bold, color });
}

export async function renderTeaserPdf(t: Teaser, assets: TeaserAssets = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${t.company} — investor teaser`);
  doc.setAuthor("Halden Ridge Advisors");
  doc.setSubject(safe(t.headline));
  doc.setProducer("Halden Ridge Advisors CRM");

  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  /* A picture that will not embed must not fail the file. It is decoration;
     the figures are the document. */
  const embed = async (bytes?: Uint8Array) => {
    if (!bytes?.length) return null;
    try { return await doc.embedJpg(bytes); } catch { return null; }
  };
  const hero = await embed(assets.hero);
  const second = (await embed(assets.second)) ?? hero;

  /* ── PAGE ONE ─────────────────────────────────────────────────────────── */
  const p1 = doc.addPage([PAGE_W, PAGE_H]);
  const c1: Ctx = { page: p1, reg, bold };

  const TITLE = 10.5, BODY = 8.8, LEAD = 12, HEAD = 15.5;

  const probGap = 18;
  const probW = t.problems.length ? (COL - probGap * (t.problems.length - 1)) / t.problems.length : COL;
  const probLines = t.problems.map((p) => clip(wrap(p.text, reg, BODY, probW - 14), 5));
  const probBody = probLines.length ? Math.max(...probLines.map((l) => l.length)) * LEAD : 0;
  const probH = t.problems.length ? HEAD * 1.2 + 20 + TITLE + 5 + probBody : 0;

  const solGap = 16;
  const solW = t.solutions.length ? (COL - solGap * (t.solutions.length - 1)) / t.solutions.length : COL;
  const solLines = t.solutions.map((p) => clip(wrap(p.text, reg, BODY, solW), 5));
  const solBody = solLines.length ? Math.max(...solLines.map((l) => l.length)) * LEAD : 0;
  const solH = t.solutions.length ? HEAD * 1.2 + 22 + TITLE + 10 + solBody : 0;

  const callGap = 14;
  const callW = t.callouts.length ? (COL - callGap * (t.callouts.length - 1)) / t.callouts.length : COL;
  const callH = t.callouts.length
    ? Math.max(...t.callouts.map((line) => wrap(line, bold, 9.2, callW - 44).length)) * 12.6 + 24
    : 0;

  /* The band is sized to what goes in it, between a floor and a ceiling. A
     fixed depth meant either a company whose standfirst got cut in half or a
     company whose two-line headline floated in a sea of blue — and the deals
     vary that much: a term sheet gives four panel rows and a deck gives two. */
  const headW = 330;
  const headSize = safe(t.headline).length > 68 ? 21 : 24;
  const headLines = clip(wrap(t.headline.replace(/\.$/, ""), bold, headSize, headW), 4);
  const panelRow = 15;
  const panelH = t.panel.length ? 26 + t.panel.length * panelRow + 10 : 0;
  const introLines = clip(wrap(t.intro, reg, 9.5, 268), 4);
  /* What the band WANTS, against what the white half can spare. The white half
     is fixed — those blocks are the deal — so the band takes what is left,
     never the other way round. Before this the band was sized on its own and a
     wordy deck pushed the solution heading into the problems above it. */
  const bandWants =
    52 + headLines.length * headSize * 1.22 + (panelH ? 16 + panelH : 0) +
    (introLines.length ? 20 + introLines.length * 13.4 : 0) + 20;
  const bandCanHave = PAGE_H - (probH + solH + callH + 36 + AIR_MIN * 2 + FLOOR);
  const BAND = Math.max(288, Math.min(384, bandWants, bandCanHave));

  heroBand(c1, hero, (x, y, w, h) => p1.drawImage(hero!, { x, y, width: w, height: h }), PAGE_H, BAND);
  wordmark(c1, t.company, PAGE_H - 44, WHITE);

  let y = PAGE_H - 92;
  headLines.forEach((line, i) => {
    p1.drawText(line, { x: M, y, size: headSize, font: bold, color: WHITE });
    if (i === headLines.length - 1) {
      p1.drawText(".", { x: M + width(bold, line, headSize), y, size: headSize, font: bold, color: AMBER });
    }
    y -= headSize * 1.22;
  });
  y += headSize * 0.3;

  /* The figures box. Bordered rather than filled so the photograph stays
     visible through the band and the box reads as an overlay. */
  if (t.panel.length) {
    y -= 14;
    const boxY = y - panelH;
    roundRect(c1, { x: M, y: boxY, w: 264, h: panelH, r: 4, fill: NAVY_DEEP, opacity: 0.72 });
    roundRect(c1, { x: M, y: boxY, w: 264, h: panelH, r: 4, border: WHITE, thickness: 0.9, opacity: 0.55 });
    p1.drawText(safe(t.panelTitle), { x: M + 13, y: y - 17, size: 9.5, font: bold, color: WHITE });
    p1.drawRectangle({ x: M + 13, y: y - 24, width: 238, height: 0.6, color: WHITE, opacity: 0.45 });
    let ry = y - 37;
    for (const row of t.panel) {
      const [lab, labSize] = shrinkToFit(row.label, reg, 112, [8.8, 8.2, 7.6]);
      p1.drawText(lab, { x: M + 13, y: ry, size: labSize, font: reg, color: WHITE });
      /* Set smaller rather than cut: this is the raise amount, and half a raise
         amount is worse than a small one. "$15m raised; extension of" was what
         truncation produced. */
      const [v, vSize] = shrinkToFit(row.value, bold, 251 - 13 - 112 - 8, [8.8, 8.2, 7.6, 7]);
      p1.drawText(v, { x: M + 251 - width(bold, v, vSize), y: ry, size: vSize, font: bold, color: AMBER });
      ry -= panelRow;
    }
    y = boxY;
  }

  /* The standfirst, under a short amber rule — the reference's one flash of
     colour in the band, and it separates the prose from the figures above it. */
  if (introLines.length) {
    y -= 18;
    p1.drawRectangle({ x: M, y: y + 12, width: 34, height: 1.6, color: AMBER });
    let iy = y;
    for (const line of introLines) {
      p1.drawText(line, { x: M, y: iy, size: 9.5, font: reg, color: rgb(0.90, 0.93, 0.98) });
      iy -= 13.4;
    }
  }

  /* ── the white half ─────────────────────────────────────────────────────
     MEASURED BEFORE IT IS DRAWN. The three blocks below are short for one deal
     and long for the next — a term sheet gives four crisp strengths, a resource
     statement gives four paragraphs — and a layout that just flows downwards
     leaves either a third of the page empty or the callouts on top of the
     footer. So every block's height is worked out first and the space left over
     is shared between them. */
  const top1 = PAGE_H - BAND - 36;
  const air = Math.max(AIR_MIN, Math.min(72, (top1 - FLOOR - (probH + solH + callH)) / 2));

  let wy = top1;

  if (t.problems.length) {
    wy = heading(c1, t.problemHeading, M, wy, HEAD, INK, ACCENT) - 20;
    t.problems.forEach((p, i) => {
      const x = M + i * (probW + probGap);
      /* A keyline down the left of each column, as the reference has, run to
         the depth of the tallest column so the three read as one row. */
      p1.drawRectangle({ x, y: wy - probBody - 4, width: 1.4, height: probBody + TITLE + 6, color: ACCENT, opacity: 0.5 });
      p1.drawText(wrap(p.title, bold, TITLE, probW - 14)[0] ?? "", { x: x + 11, y: wy, size: TITLE, font: bold, color: INK });
      let ly = wy - 15;
      for (const line of probLines[i]) {
        p1.drawText(line, { x: x + 11, y: ly, size: BODY, font: reg, color: INK2 });
        ly -= LEAD;
      }
    });
    wy -= probBody + 5 + air;
  }

  if (t.solutions.length) {
    wy = heading(c1, t.solutionHeading, M, wy, HEAD, INK, ACCENT) - 22;
    t.solutions.forEach((sol, i) => {
      const x = M + i * (solW + solGap);
      marker(c1, i + 1, x, wy + 2, ACCENT);
      p1.drawText(wrap(sol.title, bold, TITLE, solW - 24)[0] ?? "", { x: x + 21, y: wy, size: TITLE, font: bold, color: INK });
      let ly = wy - 20;
      for (const line of solLines[i]) {
        p1.drawText(line, { x, y: ly, size: BODY, font: reg, color: INK2 });
        ly -= LEAD;
      }
    });
    wy -= 10 + solBody + air;
  }

  if (t.callouts.length) {
    /* Anchored to the foot of the page. These are the last thing read on page
       one and they should sit on the baseline of the page rather than wherever
       the block above happened to finish. */
    const boxY = Math.max(FLOOR, Math.min(wy - callH, FLOOR + 6));
    t.callouts.forEach((line, i) => {
      const x = M + i * (callW + callGap);
      roundRect(c1, { x, y: boxY, w: callW, h: callH, r: 7, fill: SUNKEN });
      roundRect(c1, { x, y: boxY, w: callW, h: callH, r: 7, border: ACCENT, thickness: 0.9 });
      p1.drawCircle({ x: x + 18, y: boxY + callH - 17, size: 6.5, color: ACCENT });
      text(c1, line, { x: x + 31, y: boxY + callH - 20, size: 9.2, max: callW - 44, font: bold, color: NAVY, lead: 12.6, maxLines: 5 });
    });
  }

  footer(c1, t);

  /* ── PAGE TWO ─────────────────────────────────────────────────────────── */
  const p2 = doc.addPage([PAGE_W, PAGE_H]);
  const c2: Ctx = { page: p2, reg, bold };

  wordmark(c2, t.company, PAGE_H - 52, NAVY);

  /* A small picture at the top right, the reference's second image. */
  const imgW = 196, imgH = 108;
  if (second) {
    const sc = Math.max(imgW / second.width, imgH / second.height);
    const w = second.width * sc, h = second.height * sc;
    const x = PAGE_W - M - imgW, ytop = PAGE_H - 46;
    p2.drawRectangle({ x, y: ytop - imgH, width: imgW, height: imgH, color: NAVY_DEEP });
    p2.drawImage(second, { x: x + (imgW - w) / 2, y: ytop - imgH + (imgH - h) / 2, width: w, height: h });
    /* pdf-lib has no clipping path, so the overspill is COVERED: white blocks
       either side put the picture back inside its frame. Scaling it to fit
       instead would letterbox it, which looks like a mistake. */
    const over = (w - imgW) / 2;
    if (over > 0) {
      p2.drawRectangle({ x: x - over - 1, y: ytop - imgH - 1, width: over + 1, height: imgH + 2, color: WHITE });
      p2.drawRectangle({ x: x + imgW, y: ytop - imgH - 1, width: over + 1, height: imgH + 2, color: WHITE });
    }
    const overV = (h - imgH) / 2;
    if (overV > 0) {
      p2.drawRectangle({ x: x - 1, y: ytop, width: imgW + 2, height: overV + 1, color: WHITE });
      p2.drawRectangle({ x: x - 1, y: ytop - imgH - overV - 1, width: imgW + 2, height: overV + 1, color: WHITE });
    }
    p2.drawRectangle({ x, y: ytop - imgH, width: imgW, height: 2, color: AMBER });
  }

  /* Stopped short of the picture. At full column width the heading ran under
     it — the one overlap a fixed image position makes inevitable unless the
     text is told the picture is there. */
  let y2 = heading(c2, t.proofHeading, M, PAGE_H - 96, 21, INK, ACCENT, second ? COL - imgW - 26 : COL) - 22;
  if (t.proofIntro) {
    y2 = text(c2, t.proofIntro, { x: M, y: y2, size: 9.6, max: second ? COL - imgW - 26 : COL, color: INK2, lead: 13.2, maxLines: 3 }) - 26;
  } else y2 -= 12;

  /* ── page two, measured the same way ──────────────────────────────────────
     There is more that WANTS to be on this page than fits on it: eight things
     achieved, a table, a dated plan, four points about the money and four
     people. Rather than let the last of them print over the footer, the blocks
     are measured and the least load-bearing is dropped first. The plan points
     go before the milestones do, because the milestones say the same thing
     with dates on it; the team goes last because an investor reads the names.  */
  const twoUp = !!t.economics;
  const leftW = twoUp ? 250 : COL;

  let achieved = t.achieved;
  const achievedBox = (rows: string[]) => {
    const ls = rows.map((a) => clip(wrap(a, reg, 9, leftW - 44), 3));
    return { ls, h: 34 + ls.reduce((n, l) => n + l.length * 11.6 + 7, 0) };
  };
  const tableH = t.economics ? 24 + 26 + t.economics.rows.length * 21 : 0;

  const mileH = t.milestones.length
    ? HEAD * 1.2 + 22 + 17 + (Math.max(...t.milestones.map((m) =>
        clip(wrap(m.what, reg, 8.4, COL / t.milestones.length - 14), 3).length)) - 1) * 11 + AIR_MIN
    : 0;
  const planLines = t.plan.map((p) =>
    clip(wrap(p.text, reg, 8.4, (COL - 16 * (t.plan.length - 1)) / Math.max(1, t.plan.length)), 3));
  const planH = t.plan.length
    ? 36 + Math.max(...planLines.map((l) => l.length)) * 11 + 24 + (mileH ? 0 : HEAD * 1.2 + 22)
    : 0;

  const teamW = t.team.length ? (COL - 12 * (t.team.length - 1)) / t.team.length : COL;
  const teamBios = t.team.map((p) => clip(wrap(p.bio, reg, 8, teamW - 22), 5));
  const teamBoxH = t.team.length ? 52 + Math.max(...teamBios.map((b) => b.length)) * 10.4 : 0;
  const teamH = t.team.length ? HEAD * 1.2 + 20 + teamBoxH : 0;

  /* Trim until it fits: the plan points first, then bullets off the end of the
     achieved list. Both are ordered most-important-first by the drafting step,
     so what goes is what was least worth the space. */
  let showPlan = t.plan.length > 0;
  const blockH = () =>
    Math.max(achievedBox(achieved).h, tableH) + AIR_MIN + mileH + (showPlan ? planH : 0) + teamH;
  if (y2 - blockH() < FLOOR && showPlan) showPlan = false;
  while (y2 - blockH() < FLOOR && achieved.length > 3) achieved = achieved.slice(0, -1);

  /* Whatever survived the trim now gets the room the trim freed. Without this
     the page ends a third of the way up with an empty foot, having just cut
     content to make space it then did not use — which is the worst of both. */
  const air2 = Math.max(AIR_MIN, Math.min(64, (y2 - blockH() - FLOOR) / 2 + AIR_MIN));

  const { ls: achievedLines, h: achievedH } = achievedBox(achieved);
  let leftBottom = y2, rightBottom = y2;

  if (achieved.length) {
    roundRect(c2, { x: M, y: y2 - achievedH, w: leftW, h: achievedH, r: 7, fill: SUNKEN });
    roundRect(c2, { x: M, y: y2 - achievedH, w: leftW, h: achievedH, r: 7, border: LINE, thickness: 0.9 });
    p2.drawText(safe(t.achievedHeading).replace(/\.$/, ""), { x: M + 16, y: y2 - 21, size: 10, font: bold, color: NAVY });
    let ay = y2 - 42;
    for (const l of achievedLines) {
      p2.drawCircle({ x: M + 20, y: ay + 3, size: 2.4, color: ACCENT });
      for (const line of l) {
        p2.drawText(line, { x: M + 30, y: ay, size: 9, font: reg, color: INK2 });
        ay -= 11.6;
      }
      ay -= 7;
    }
    leftBottom = y2 - achievedH;
  }

  if (t.economics) {
    const x0 = M + leftW + 20;
    const w = COL - leftW - 20;
    const labelW = w * 0.42;
    const cellW = (w - labelW) / t.economics.columns.length;
    p2.drawText(safe(t.economicsHeading).replace(/\.$/, ""), { x: x0, y: y2 - 10, size: 10, font: bold, color: NAVY });
    let ty = y2 - 24;
    const headH = 26;
    p2.drawRectangle({ x: x0, y: ty - headH, width: w, height: headH, color: NAVY });
    t.economics.columns.forEach((col, i) => {
      const cx = x0 + labelW + cellW * i;
      const size = width(bold, col, 7.6) <= (cellW - 6) * 2 ? 7.6 : 6.8;
      clip(wrap(col, bold, size, cellW - 5), 2).forEach((line, li) => {
        p2.drawText(line, { x: cx + (cellW - width(bold, line, size)) / 2, y: ty - 12 - li * (size * 1.13), size, font: bold, color: WHITE });
      });
    });
    ty -= headH;
    t.economics.rows.forEach((row, i) => {
      const rh = 21;
      if (i % 2 === 1) p2.drawRectangle({ x: x0, y: ty - rh, width: w, height: rh, color: SUNKEN });
      p2.drawRectangle({ x: x0, y: ty - rh, width: w, height: 0.6, color: LINE });
      const [rl, rlSize] = shrinkToFit(row.label, bold, labelW - 10, [8, 7.4, 6.9]);
      p2.drawText(rl, { x: x0 + 8, y: ty - 14, size: rlSize, font: bold, color: INK });
      row.values.forEach((v, j) => {
        const cx = x0 + labelW + cellW * j;
        const vv = wrap(v, reg, 8.4, cellW - 4)[0] ?? "";
        p2.drawText(vv, { x: cx + (cellW - width(reg, vv, 8.4)) / 2, y: ty - 14, size: 8.4, font: reg, color: INK2 });
      });
      ty -= rh;
    });
    p2.drawRectangle({ x: x0, y: ty, width: w, height: 0.6, color: LINE });
    rightBottom = ty;
  }

  let y3 = Math.min(leftBottom, rightBottom) - air2;

  /* The plan: a dated line across the page where the document dates things,
     and the points beneath it. The reference has a chart here; a chart drawn
     from figures the document did not give would be the one thing on this
     page that is invented. */
  if (t.milestones.length || (showPlan && t.plan.length)) {
    y3 = heading(c2, t.planHeading, M, y3, HEAD, INK, ACCENT) - 22;

    if (t.milestones.length) {
      const n = t.milestones.length;
      const step = COL / n;
      p2.drawRectangle({ x: M, y: y3 - 3, width: COL - step * 0.35, height: 1, color: LINE });
      let lowest = y3;
      t.milestones.forEach((m, i) => {
        const x = M + step * i;
        p2.drawCircle({ x: x + 3.5, y: y3 - 2.5, size: 3.5, color: ACCENT });
        p2.drawText(safe(m.when), { x, y: y3 + 8, size: 8.6, font: bold, color: NAVY });
        const end = text(c2, m.what, { x, y: y3 - 17, size: 8.4, max: step - 14, color: INK2, lead: 11, maxLines: 3 });
        lowest = Math.min(lowest, end);
      });
      y3 = lowest - (showPlan && t.plan.length ? 22 : air2);
    }

    if (showPlan && t.plan.length) {
      const gap = 16;
      const w = (COL - gap * (t.plan.length - 1)) / t.plan.length;
      t.plan.forEach((p, i) => {
        const x = M + i * (w + gap);
        p2.drawRectangle({ x, y: y3 - 4, width: 22, height: 1.6, color: AMBER });
        p2.drawText(wrap(p.title, bold, 9.6, w)[0] ?? "", { x, y: y3 - 22, size: 9.6, font: bold, color: INK });
        let ly = y3 - 36;
        for (const line of planLines[i]) {
          p2.drawText(line, { x, y: ly, size: 8.4, font: reg, color: INK2 });
          ly -= 11;
        }
      });
      y3 -= 36 + Math.max(...planLines.map((l) => l.length)) * 11 + air2;
    }
  }

  if (t.team.length) {
    /* In flow, not pinned to the foot. Pinning it pulled the heading UP over
       the plan points when the page was full, which is the one collision a
       measured layout is supposed to make impossible. */
    /* PINNED TO THE FOOT, with the heading tucked above it. Left in flow the
       page ended a quarter of the way up with white beneath, which reads as
       something that failed to render rather than as a designed margin. The
       heading follows the box rather than the box following the heading, so
       the two can never come apart. */
    const boxY = FLOOR;
    heading(c2, t.teamHeading, M, Math.min(y3, boxY + teamBoxH + 20), HEAD, INK, ACCENT);
    t.team.forEach((p, i) => {
      const x = M + i * (teamW + 12);
      roundRect(c2, { x, y: boxY, w: teamW, h: teamBoxH, r: 6, fill: SUNKEN });
      roundRect(c2, { x, y: boxY, w: teamW, h: teamBoxH, r: 6, border: LINE, thickness: 0.9 });
      /* "Konstanty Wierzbinski-Adamczyk, PhD" does not fit a quarter-page column at 9.6pt,
         and truncating a person's name to "Konstanty Wierzbinski-Adamczyk," in a document
         going to investors is not acceptable. It is set smaller instead. */
      const [nm, nmSize] = shrinkToFit(p.name, bold, teamW - 22, [9.6, 9, 8.4, 7.8]);
      p2.drawText(nm, { x: x + 11, y: boxY + teamBoxH - 20, size: nmSize, font: bold, color: INK });
      p2.drawText(wrap(p.role, reg, 8.2, teamW - 22)[0] ?? "", { x: x + 11, y: boxY + teamBoxH - 32, size: 8.2, font: reg, color: ACCENT });
      let by = boxY + teamBoxH - 47;
      for (const line of teamBios[i]) {
        p2.drawText(line, { x: x + 11, y: by, size: 8, font: reg, color: INK2 });
        by -= 10.4;
      }
    });
  }

  footer(c2, t);

  return doc.save();
}
