import "server-only";
import { unzipSync, strFromU8 } from "fflate";

/**
 * Get the words out of a deck, a term sheet or a one-pager.
 *
 * Three formats because that is what Halden Ridge is actually sent. A PowerPoint deck is
 * the common case, a PDF export of one is next, and Word is what a term sheet
 * arrives as.
 *
 * Nothing here interprets anything. It returns text, and only text, so that the
 * step which does interpret it can be checked against something a person can
 * read back. The extracted text is stored on the deal for exactly that reason.
 */

export interface Extracted {
  text: string;
  /** Pages for a PDF, slides for a deck, paragraphs for Word. Shown to the user. */
  parts: number;
  kind: "pdf" | "pptx" | "docx" | "doc";
  /**
   * True when there was almost no text to pull out and the file has to be READ
   * rather than parsed — an image-only deck, or a scan.
   *
   * Only ever set for PDFs, because a PDF is the one format the model can take
   * directly. Refusing these was wrong: a mining deck exported as images is
   * completely normal, and "that file holds almost no readable text" is a
   * baffling thing to be told about a deck you can plainly read on screen.
   */
  needsVision?: boolean;
}

export class UnreadableDocument extends Error {}

const MAX_CHARS = 200_000; // ~50k tokens. Longer decks are truncated, and said so.

/** Office files are zips of XML. Pull the text nodes out of the parts we want. */
function fromOfficeXml(buf: Uint8Array, pick: (name: string) => boolean): string[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, { filter: (f) => pick(f.name) });
  } catch {
    throw new UnreadableDocument("That file could not be opened. If it is password-protected, remove the protection and try again.");
  }
  // Slide order matters — slide10 must not sort before slide2, which is what a
  // plain string sort does and what makes a deck read out of order.
  const names = Object.keys(files).sort((a, b) => {
    const na = Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0);
    const nb = Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);
    return na - nb || a.localeCompare(b);
  });
  return names.map((n) => {
    const xml = strFromU8(files[n]);
    // <a:t> in PowerPoint, <w:t> in Word. Keep a break between runs or words
    // from separate text boxes are glued into one unreadable string.
    const runs = xml.match(/<(?:a|w):t[^>]*>([\s\S]*?)<\/(?:a|w):t>/g) ?? [];
    return runs
      .map((r) => r.replace(/<[^>]+>/g, ""))
      .join(" ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }).filter(Boolean);
}

/**
 * Pre-2007 Word (.doc).
 *
 * Not a zip — an OLE compound file, a completely different container, which is
 * why the .docx reader cannot touch it. This used to be refused with an
 * instruction to re-save as .docx; Halden Ridge is sent .doc term sheets, so it is read
 * instead.
 *
 * A library rather than a hand-rolled parser, deliberately. Locating the text
 * in a Word 97 stream means walking the FIB and the piece table, and a parser
 * that gets that subtly wrong returns plausible-looking garbage rather than
 * failing — which would then be drafted into a deal write-up as though it were
 * the document. This is the one place in this project where a dependency is
 * clearly safer than our own code.
 */
async function fromDoc(buf: Uint8Array): Promise<Extracted> {
  const { default: WordExtractor } = await import("word-extractor");
  let doc;
  try {
    doc = await new WordExtractor().extract(Buffer.from(buf));
  } catch {
    throw new UnreadableDocument("That .doc file could not be opened. If it is password-protected, remove the protection and try again.");
  }
  const body = (doc.getBody() ?? "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!body) throw new UnreadableDocument("No text could be read from that document.");
  return { text: body, parts: 1, kind: "doc" };
}

async function fromPdf(buf: Uint8Array): Promise<Extracted> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pdf;
  try {
    /* A COPY, not the caller's bytes. pdf.js takes ownership of the buffer it
       is handed and DETACHES it, so the original is unusable afterwards — and
       an image-only PDF has to survive this step, because the file itself is
       then given to the model to read. Without the copy that path threw
       "Cannot perform Construct on a detached ArrayBuffer" every time, which
       is to say every scanned deck would have failed. */
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch {
    throw new UnreadableDocument("That PDF could not be opened. It may be password-protected or damaged.");
  }
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const joined = pages.map((p, i) => `[page ${i + 1}] ${p}`).join("\n\n");

  /* An image-only PDF extracts to nothing. That is not a broken file and must
     not be refused — it is a deck someone exported as pictures, which is
     completely ordinary. The model reads PDFs directly, images included, so
     the file is passed on rather than parsed. */
  const readable = joined.replace(/\[page \d+\]/g, "").trim();
  return {
    text: joined,
    parts: totalPages,
    kind: "pdf",
    needsVision: readable.length < 200,
  };
}

export async function extractDocument(file: {
  name: string;
  buffer: ArrayBuffer;
}): Promise<Extracted> {
  const buf = new Uint8Array(file.buffer);
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();

  /* The pre-2007 Office formats are OLE compound files, not zips. Caught by their
     signature and named, because the unzip failure below reports them as
     "password-protected", which sends someone hunting for a password that was
     never set instead of doing the one thing that works — re-save as .pptx. */
  const OLE = buf.length >= 4 && [0xd0, 0xcf, 0x11, 0xe0].every((b, i) => buf[i] === b);
  if (OLE) {
    /* .doc is read properly now. .ppt is not: the pre-2007 PowerPoint format
       stores text in a shape nothing pure-JS reads reliably, and a wrong answer
       here would be drafted into a write-up as fact. Named plainly, because the
       unzip failure below reports it as "password-protected" and sends someone
       hunting for a password that was never set. */
    if (ext === "doc" || ext === "docx") return finish(await fromDoc(buf));
    throw new UnreadableDocument(
      `That is an old .ppt file saved in the pre-2007 format. Open it and "Save As" .pptx, or export it to PDF, then try again.`);
  }

  let out: Extracted;
  if (ext === "pdf") {
    out = await fromPdf(buf);
  } else if (ext === "pptx" || ext === "ppt") {
    const slides = fromOfficeXml(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    // .ppt (the pre-2007 binary) is not a zip and will land here empty.
    if (!slides.length) throw new UnreadableDocument(
      ext === "ppt"
        ? "That looks like an old .ppt file. Save it as .pptx or export it to PDF and try again."
        : "No text could be read from that deck. If the slides are images, export it to PDF instead.");
    out = { text: slides.map((s, i) => `[slide ${i + 1}] ${s}`).join("\n\n"), parts: slides.length, kind: "pptx" };
  } else if (ext === "docx" || ext === "doc") {
    const parts = fromOfficeXml(buf, (n) => n === "word/document.xml");
    if (!parts.length) throw new UnreadableDocument("No text could be read from that document.");
    out = { text: parts.join("\n\n"), parts: 1, kind: "docx" };
  } else {
    throw new UnreadableDocument(`.${ext} is not a format this reads. Send a PDF, a PowerPoint or a Word file.`);
  }

  return finish(out);
}

/** Length checks, applied whichever reader produced the text. */
function finish(out: Extracted): Extracted {
  /* A PowerPoint or Word file with no text really is a dead end — neither can
     be handed to the model to look at. A PDF in the same state is not: it goes
     on with needsVision set, and is read rather than parsed. */
  if (!out.needsVision && out.text.replace(/\[(page|slide) \d+\]/g, "").trim().length < 200) {
    throw new UnreadableDocument(
      "That file holds almost no readable text — the slides are probably images. Export it to PDF from the original, and it will be read as pictures.");
  }
  if (out.text.length > MAX_CHARS) {
    out.text = out.text.slice(0, MAX_CHARS) + "\n\n[document truncated here]";
  }
  return out;
}
