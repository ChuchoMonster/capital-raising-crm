import { NextResponse } from "next/server";
import { enrichUploaded } from "@/app/lib/import/enrich";

/**
 * Pick up whatever an upload's own run did not reach.
 *
 * A large upload has more new firms in it than one request can look up, and
 * whoever uploaded it should not have to sit on the page. This finishes the
 * job in the background — it is the reason a half-identified upload does not
 * quietly stay half-identified.
 *
 * Hourly, not every five minutes. There is usually nothing to do, each firm
 * costs a web search, and an upload is a thing somebody does occasionally.
 *
 * Guarded by the shared secret like the mailbox sync, and it REFUSES TO RUN if
 * one is not configured rather than falling open — there is no person on a
 * cron call for a session check to find.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not set; refusing to run the upload enrichment");
    return NextResponse.json({ ok: false, message: "Not configured." }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`)
    return NextResponse.json({ ok: false, message: "Not authorised." }, { status: 401 });

  const out = await enrichUploaded(40);
  if (out.looked) console.log("upload enrichment:", out.message);
  return NextResponse.json(out);
}
