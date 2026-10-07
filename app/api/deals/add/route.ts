import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/app/lib/session";
import { MAX_BYTES } from "@/app/lib/deal/create";
import { addDocumentsToDeal } from "@/app/lib/deal/add";
import { download, remove } from "@/app/lib/deal/storage";

/**
 * Add documents to a deal that already exists.
 *
 * The sibling of `/api/deals/upload`, and deliberately a separate route rather
 * than a flag on that one: creating a deal and changing a live one are
 * different acts with different failure consequences, and a route that does
 * both is one mistyped field away from overwriting a raise nobody meant to
 * touch.
 *
 * Same shape otherwise — the files are already in storage and only their paths
 * arrive here, because a serverless function refuses a body over about 4.5MB
 * and a deck plus a term sheet is routinely past it.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  let body: { reference?: string; files?: { name?: string; path?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "That upload did not arrive intact. Try again." }, { status: 400 });
  }

  const reference = (body.reference ?? "").trim();
  if (!reference) return NextResponse.json({ ok: false, message: "No deal was chosen." }, { status: 400 });

  const uploaded = (body.files ?? []).filter((f) => f?.name && f?.path) as { name: string; path: string }[];
  if (!uploaded.length) return NextResponse.json({ ok: false, message: "No file was attached." }, { status: 400 });

  const paths = uploaded.map((f) => f.path);
  try {
    const files = await Promise.all(uploaded.map(async (f) => {
      const buffer = await download(f.path);
      return { name: f.name, size: buffer.byteLength, buffer, path: f.path };
    }));

    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_BYTES) {
      await remove(paths);
      return NextResponse.json({ ok: false, message: "Those files come to more than 25MB together." }, { status: 413 });
    }

    const result = await addDocumentsToDeal(reference, files, user.email);
    if (result.ok) {
      /* The deal page, its list, and the tiered list that reads the deal's own
         fields — all three now say something different. */
      revalidatePath("/deals");
      revalidatePath(`/deals/${reference}`);
      revalidatePath(`/deals/${reference}/targets`);
    } else {
      /* Nothing should be left in storage that no deal points at. Only a
         FAILED add is cleaned up — a successful one keeps its documents,
         because that is what gets attached to the emails. */
      await remove(paths);
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    await remove(paths);
    console.error("adding to a deal failed", e);
    return NextResponse.json(
      { ok: false, message: "Something went wrong reading that file. The deal was not changed." },
      { status: 500 });
  }
}
