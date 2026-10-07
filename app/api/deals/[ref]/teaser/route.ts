import { NextResponse } from "next/server";
import { requireUser } from "@/app/lib/session";
import { teaserPdf } from "@/app/lib/deal/teaser-store";

/**
 * The two-page teaser for one deal, as a PDF.
 *
 * A GET, so the deal page can be a plain link rather than a button that
 * assembles a file in the browser — the same reasoning as the matched-accounts
 * export next door. It is rendered on each request from the stored teaser
 * rather than cached, which takes a few milliseconds and removes any chance of
 * the file on this link differing from the one attached to an email.
 */
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  await requireUser();
  const { ref } = await params;

  const out = await teaserPdf(ref);
  if (!out) return NextResponse.json({ message: "This deal has no teaser yet." }, { status: 404 });

  /* ASCII only in the header. An HTTP header is latin-1 and the em dash in the
     file's own name threw before a byte of the file was written — the same
     trap the matched-accounts export already carries a note about. */
  const filename = out.filename.replace(/[^\x20-\x7E]+/g, "-").replace(/\s+/g, " ").trim();

  return new NextResponse(out.bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
