import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/app/lib/session";
import { enrichUploaded } from "@/app/lib/import/enrich";

/**
 * Identify the firms behind uploaded contacts.
 *
 * A ROUTE, not a server action, for one reason: each firm is a web search and
 * a page read, so a batch runs for minutes. A route can say it needs the time;
 * an action cannot, and the upload would appear to hang and then fail.
 *
 * Called straight after an upload commits, and again by the cron for whatever
 * a single run did not reach.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  let max = 40;
  try {
    const body = await req.json();
    if (typeof body?.max === "number") max = Math.min(60, Math.max(1, body.max));
  } catch { /* the default is fine */ }

  const out = await enrichUploaded(max);
  if (out.placed) { revalidatePath("/contacts"); revalidatePath("/accounts"); }
  return NextResponse.json(out, { status: out.ok ? 200 : 500 });
}
