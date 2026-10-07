import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/app/lib/session";
import { createDealFromDocuments, MAX_BYTES } from "@/app/lib/deal/create";
import { download, remove } from "@/app/lib/deal/storage";

/**
 * Take the uploaded document and make a deal from it.
 *
 * A route rather than a server action because this is a file upload with a long
 * tail — reading a 200-slide deck and drafting from it runs past the point where
 * an action feels like it has hung.
 *
 * Runs on Node, not the edge: the PDF and Office readers need Node built-ins.
 */
export const runtime = "nodejs";
/* Several files, each possibly transcribed before drafting, runs longer than
   one. Pro allows five minutes. */
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  /* The files are already in storage; this receives only their paths.
     Deliberately NOT multipart any more — a Vercel function refuses a body over
     about 4.5MB with a plain-text 413 that never reaches this code, and the
     browser then reported the platform's error page as "the server sent back
     something unreadable". A deck and a term sheet together are routinely past
     that, so the documents no longer travel through here at all. */
  let body: { files?: { name?: string; path?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "That upload did not arrive intact. Try again." }, { status: 400 });
  }

  const uploaded = (body.files ?? []).filter((f) => f?.name && f?.path) as { name: string; path: string }[];
  if (!uploaded.length)
    return NextResponse.json({ ok: false, message: "No file was attached." }, { status: 400 });

  const paths = uploaded.map((f) => f.path);
  try {
    const files = await Promise.all(uploaded.map(async (f) => {
      const buffer = await download(f.path);
      /* The storage path travels with the file: the deal keeps its documents
         now, so the deck can be attached when the CRM drafts the emails. */
      return { name: f.name, size: buffer.byteLength, buffer, path: f.path };
    }));

    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_BYTES) {
      await remove(paths);
      return NextResponse.json({ ok: false, message: "Those files come to more than 25MB together." }, { status: 413 });
    }

    const result = await createDealFromDocuments(files, user.email);
    /* Kept when a deal was made, removed when one was not. Nothing should be
       left in storage that no deal points at. */
    if (result.ok) revalidatePath("/deals");
    else await remove(paths);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    /* Only a FAILED upload is cleaned up. A deal that was created keeps its
       documents — that is what the drafting attaches. This used to delete
       unconditionally in a `finally`. */
    await remove(paths);
    console.error("deal upload failed", e);
    return NextResponse.json(
      { ok: false, message: "Something went wrong reading that file. Nothing was saved." },
      { status: 500 },
    );
  }
}
