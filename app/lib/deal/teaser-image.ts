import "server-only";

/**
 * A photograph for the teaser, taken out of the company's own deck.
 *
 * The teaser reads far better carrying a picture of the actual plant, mine or
 * product than a stock skyline, and the deck already contains one. A PDF stores
 * a JPEG as a raw stream — the bytes between `stream` and `endstream` on an
 * image XObject filtered `/DCTDecode` ARE a complete JPEG file — so pulling one
 * out is a scan of the file, not a render of it. No headless browser, no
 * image library, nothing that would not survive on a serverless function.
 *
 * WHAT IT DELIBERATELY WILL NOT DO is guess. It reads the dimensions out of the
 * JPEG's own frame header rather than trusting the PDF dictionary, refuses
 * anything too small, too thin, or in a colour space that cannot be embedded,
 * and returns nothing at all rather than something wrong — the caller then
 * falls back to the Halden Ridge photograph, which always looks deliberate.
 *
 * Candidates come back in file order, which for almost every deck is page
 * order, so the caller can prefer an early one. What it CANNOT tell is a
 * photograph from a full-page chart; that is why the chosen image is shown on
 * the deal page, where a person sees it before an investor does.
 */

export interface DeckImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Roughly where in the document it was found, 0 = front. */
  at: number;
}

const SOI = 0xd8, EOI = 0xd9;

/**
 * Read a JPEG's own frame header.
 *
 * The PDF dictionary carries /Width and /Height too, but it can disagree with
 * the file — and the component count, which is the thing that decides whether
 * this can be embedded at all, is only in the JPEG. A four-component (CMYK)
 * JPEG out of a print-ready deck is common and cannot go into a PDF this way.
 */
function frame(b: Uint8Array): { width: number; height: number; components: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    /* Standalone markers carry no length. */
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    /* SOF0..SOF15, excluding the four that are not frame headers. */
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (b[i + 5] << 8) | b[i + 6],
        width: (b[i + 7] << 8) | b[i + 8],
        components: b[i + 9],
      };
    }
    i += 2 + len;
  }
  return null;
}

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));

/** Every embeddable JPEG in a PDF, in file order. */
export function deckImages(pdf: ArrayBuffer): DeckImage[] {
  const b = new Uint8Array(pdf);
  const out: DeckImage[] = [];
  const needle = "/DCTDecode";

  /* A byte scan rather than a parse. Object streams, cross-reference streams
     and incremental updates all make a proper parse a project of its own, and
     none of them move the image bytes: a DCTDecode stream is a JPEG wherever
     the object it belongs to happens to live. */
  for (let i = 0; i + needle.length < b.length; i++) {
    if (b[i] !== 0x2f /* / */) continue;
    if (ascii(b, i, i + needle.length) !== needle) continue;

    /* Forward to the stream keyword, then past its end-of-line. Bounded: a
       dictionary and its stream are adjacent, and running on would attach this
       image's header to a completely different object's bytes. */
    const window = ascii(b, i, i + 1200);
    const kw = window.indexOf("stream");
    if (kw < 0) continue;
    let start = i + kw + 6;
    if (b[start] === 0x0d) start++;
    if (b[start] === 0x0a) start++;

    if (!(b[start] === 0xff && b[start + 1] === SOI)) continue;

    /* To `endstream`. Trusting the /Length entry would mean resolving indirect
       references; the keyword is right there and cannot be off by more than
       the end-of-line before it. */
    let end = -1;
    for (let j = start + 2; j + 9 < b.length; j++) {
      if (b[j] !== 0x65 /* e */) continue;
      if (ascii(b, j, j + 9) === "endstream") { end = j; break; }
    }
    if (end < 0) continue;
    while (end > start && (b[end - 1] === 0x0a || b[end - 1] === 0x0d)) end--;

    const bytes = b.subarray(start, end);
    /* It must end where a JPEG ends. Anything else means the scan has run past
       the object, and half a picture is worse than none. */
    if (bytes.length < 4096 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== EOI) continue;

    const f = frame(bytes);
    if (!f || f.components === 4) continue;

    out.push({ bytes: new Uint8Array(bytes), width: f.width, height: f.height, at: start });
    i = end;
  }
  return out;
}

/**
 * The pictures worth using, best first.
 *
 * THE 16:9 TEST IS THE ONE THAT WORKS, and it was not obvious. Picking the
 * largest image out of Arkveld Zero's deck returned a 4405x2167 tenement map —
 * genuinely from the deck, and a dreadful thing to open a teaser with. The
 * images that read as photographs are the ones that fill a slide edge to edge,
 * and a slide is 16:9, so a candidate at that ratio is almost always a hero
 * shot while a chart, a map or a crop is at whatever ratio it happened to be.
 * On that deck it picks the render of the electrolysis cell, which is exactly
 * what a person would have chosen.
 *
 * Everything else that survives the size test is kept behind those, because a
 * teaser with the wrong picture is a bad teaser and a teaser with no picture is
 * a worse one. Nothing here can tell a photograph from a full-page chart, which
 * is why the choice is shown on the deal page before it is shown to an investor.
 */
export function rankDeckImages(images: DeckImage[]): DeckImage[] {
  const usable = images.filter((im) => {
    const ratio = im.width / im.height;
    return im.width >= 900 && im.height >= 450 && ratio >= 1.1 && ratio <= 3.2;
  });
  const slideShaped = (im: DeckImage) => {
    const r = im.width / im.height;
    return r >= 1.6 && r <= 1.95;
  };
  return usable.sort((a, b) => {
    const shape = Number(slideShaped(b)) - Number(slideShaped(a));
    return shape || b.width * b.height - a.width * a.height;
  });
}

/** The hero, or nothing. */
export function pickDeckImage(images: DeckImage[]): DeckImage | null {
  return rankDeckImages(images)[0] ?? null;
}
