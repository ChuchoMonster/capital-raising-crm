import { NextResponse } from "next/server";
import { readReplies } from "@/app/lib/deal/verdicts";

/**
 * Read the investor replies nobody has read yet.
 *
 * Hourly, not every five minutes. A reply gets answered in hours rather than
 * seconds, and each one costs a model call.
 *
 * Deliberately AFTER the mailbox sync rather than inside it. That sync is
 * load-bearing — it is how the CRM knows anything happened at all — and putting
 * a model call in its path would mean a slow or unavailable model stopped the
 * mail being recorded.
 *
 * Guarded by the shared secret like the other two, and it REFUSES TO RUN if one
 * is not configured rather than falling open.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not set; refusing to read replies");
    return NextResponse.json({ ok: false, message: "Not configured." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ ok: false, message: "Not authorised." }, { status: 401 });

  const out = await readReplies(40);
  if (out.looked) console.log("replies read:", out.message);
  return NextResponse.json({ ok: true, ...out });
}
