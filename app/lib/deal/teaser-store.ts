import "server-only";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { query, one } from "../db";
import { draftTeaser, TeaserFailed, type Teaser } from "./teaser";
import { renderTeaserPdf } from "./teaser-pdf";
import { deckImages, rankDeckImages } from "./teaser-image";
import { download, put } from "./storage";

/**
 * Keeping the teaser: drafted once, read many times.
 *
 * IT IS STORED, NOT DERIVED. The alternative — draft it whenever the page is
 * opened — would mean an Opus call in the request path, several seconds of
 * blank screen, and a document that quietly says something slightly different
 * every time it is downloaded. The same file has to be the one on the deal
 * page and the one attached to an email; that only holds if it is written down.
 *
 * The PDF itself is NOT stored. It is rendered from the stored teaser in a few
 * milliseconds, so caching it would only create a second thing that can go
 * stale — and this project has lost more time to two copies disagreeing than
 * to anything else.
 */

export interface StoredTeaser {
  teaser: Teaser;
  /** Where the hero picture lives, "" when the Halden Ridge photograph is being used. */
  imagePath: string;
  secondPath: string;
}

export async function getTeaser(ref: string): Promise<StoredTeaser | null> {
  const r = await one<{ teaser: Teaser | null; image_path: string | null; second_path: string | null }>(
    `select teaser, teaser_image image_path, teaser_image_2 second_path
     from deals where reference = $1`, [ref]);
  if (!r?.teaser) return null;
  return { teaser: r.teaser, imagePath: r.image_path ?? "", secondPath: r.second_path ?? "" };
}

/**
 * The pictures, ready to draw with.
 *
 * An optional house photograph (public/img/teaser-fallback.jpg, JPEG, not
 * shipped in this repo) is the fallback; without it the band is drawn plain.
 * It is read off disk rather than fetched
 * over HTTP — the file is in the deployment, and a render that depends on the
 * app being able to reach its own public URL fails in exactly the places that
 * are hardest to debug.
 */
async function assetsFor(s: StoredTeaser): Promise<{ hero?: Uint8Array; second?: Uint8Array }> {
  const read = async (path: string) => {
    if (!path) return undefined;
    try { return new Uint8Array(await download(path)); } catch { return undefined; }
  };
  const hero = (await read(s.imagePath)) ?? (await fallbackImage());
  const second = await read(s.secondPath);
  return { hero, second };
}

let cachedFallback: Uint8Array | null | undefined;
async function fallbackImage(): Promise<Uint8Array | undefined> {
  if (cachedFallback !== undefined) return cachedFallback ?? undefined;
  try {
    cachedFallback = new Uint8Array(await readFile(join(process.cwd(), "public", "img", "teaser-fallback.jpg")));
  } catch {
    cachedFallback = null;
  }
  return cachedFallback ?? undefined;
}

/** The two-page PDF, drawn fresh from what is stored. */
export async function teaserPdf(ref: string): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const s = await getTeaser(ref);
  if (!s) return null;
  const bytes = await renderTeaserPdf(s.teaser, await assetsFor(s));
  const name = s.teaser.company.replace(/[^A-Za-z0-9 &.-]/g, "").trim() || "Deal";
  return { bytes, filename: `${name} — Teaser.pdf` };
}

/**
 * Draft the teaser for a deal and keep it.
 *
 * Non-fatal by design at the call sites that create a deal: a raise whose
 * write-up is finished must not be reported as a failed upload because the
 * teaser could not be drafted. The deal page offers to draft it again.
 */
export async function buildTeaser(ref: string): Promise<Teaser> {
  const d = await one<{
    id: string; title: string; website: string | null; document_text: string | null;
    raising: string | null; valuation: string | null; stage: string | null;
    sector: string | null; countries: string | null; closing: string | null;
    summary: string | null; highlights: string[] | null;
  }>(
    `select id, title, website, document_text, raising, valuation, stage,
            sector, countries, closing, summary, highlights
     from deals where reference = $1`, [ref]);
  if (!d) throw new TeaserFailed("That deal no longer exists.");

  const teaser = await draftTeaser({
    company: d.title,
    website: d.website ?? "",
    text: d.document_text ?? "",
    known: {
      raising: d.raising ?? "", valuation: d.valuation ?? "", stage: d.stage ?? "",
      sector: d.sector ?? "", countries: d.countries ?? "", closing: d.closing ?? "",
      summary: d.summary ?? "", highlights: d.highlights ?? [],
    },
  });

  const [imagePath, secondPath] = await heroFromDeck(d.id, ref);

  await query(
    `update deals set teaser = $2, teaser_at = now(), teaser_model = $3,
            teaser_image = $4, teaser_image_2 = $5
     where reference = $1`,
    [ref, JSON.stringify(teaser), teaser.model, imagePath, secondPath]);

  return teaser;
}

/**
 * Find a picture in the deck and keep it beside the teaser.
 *
 * Kept as its own small file rather than pulled out of the deck on every
 * render: the deck is 7MB, the picture is 200KB, and this runs on a request
 * that somebody is waiting on.
 *
 * A deal whose original upload was never kept — anything from before documents
 * were stored — simply gets no picture and falls back to the Halden Ridge photograph.
 * That is a fallback, not a failure, and nothing here raises.
 */
async function heroFromDeck(dealId: string, ref: string): Promise<[string, string]> {
  try {
    const docs = await query<{ path: string; name: string }>(
      `select storage_path path, name from deal_documents
       where deal_id = $1 order by uploaded_at, name`, [dealId]);
    for (const doc of docs) {
      if (!/\.pdf$/i.test(doc.name)) continue;
      const buf = await download(doc.path);
      const ranked = rankDeckImages(deckImages(buf));
      if (!ranked.length) continue;
      const out: string[] = [];
      for (const im of ranked.slice(0, 2)) {
        const path = `teasers/${ref}-${randomUUID().slice(0, 8)}.jpg`;
        await put(path, im.bytes, "image/jpeg");
        out.push(path);
      }
      return [out[0] ?? "", out[1] ?? ""];
    }
  } catch (e) {
    console.error("could not take a picture out of the deck", ref, e);
  }
  return ["", ""];
}
