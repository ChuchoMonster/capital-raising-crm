import { NextResponse } from "next/server";
import { currentUser } from "@/app/lib/session";
import { pathFor, signedUpload } from "@/app/lib/deal/storage";
import { ACCEPTED, MAX_BYTES } from "@/app/lib/deal/create";

/**
 * Hand the browser somewhere to put a file.
 *
 * The document itself never passes through this app: a Vercel function refuses
 * a body over about 4.5MB, and a deck plus a term sheet is routinely more. The
 * browser uploads straight to storage and posts back only the path.
 *
 * Guarded like everything else, and the checks run HERE rather than on trust:
 * a signed URL is a write credential, so the name and the size are validated
 * before one is issued.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  let body: { files?: { name?: string; size?: number }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 }); }

  const files = (body.files ?? []).filter((f) => f?.name);
  if (!files.length) return NextResponse.json({ ok: false, message: "No files." }, { status: 400 });
  if (files.length > 8) return NextResponse.json({ ok: false, message: "Eight files at once is the limit." }, { status: 400 });

  const total = files.reduce((n, f) => n + (f.size ?? 0), 0);
  if (total > MAX_BYTES)
    return NextResponse.json({ ok: false, message: "Those come to more than 25MB together." }, { status: 400 });

  for (const f of files) {
    const ext = "." + (f.name!.split(".").pop() ?? "").toLowerCase();
    if (!ACCEPTED.includes(ext))
      return NextResponse.json({ ok: false, message: `${f.name}: ${ext} is not a format this reads.` }, { status: 400 });
  }

  try {
    const targets = await Promise.all(files.map(async (f) => {
      const path = pathFor(f.name!);
      const { url, token } = await signedUpload(path);
      return { name: f.name!, path, url, token };
    }));
    return NextResponse.json({ ok: true, targets });
  } catch (e) {
    console.error("could not sign upload", e);
    /* The reason is shown, not swallowed. "Could not prepare the upload. Try
       again." was technically true and completely useless: the actual cause was
       a missing environment variable, which no amount of trying again would
       fix. Everyone who reaches this route is a signed-in colleague, and a
       vague message here costs a round trip to find out what a sentence could
       have said. */
    const why = e instanceof Error ? e.message : "";
    return NextResponse.json(
      { ok: false, message: why ? `Could not prepare the upload — ${why}` : "Could not prepare the upload. Try again." },
      { status: 500 });
  }
}
