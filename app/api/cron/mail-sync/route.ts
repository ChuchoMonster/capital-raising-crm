import { NextResponse } from "next/server";
import { syncMailboxes } from "@/app/lib/mail-sync";

/**
 * Read the partners' mailboxes and record who has been contacted.
 *
 * Called by Vercel on a schedule (see vercel.json), which means it runs whether
 * or not anyone's machine is on. It is the only route in the app that is not
 * behind a person's sign-in, so the shared secret below is the entire gate —
 * this endpoint can be reached by anyone who knows the address.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled calls when
 * that variable is set. If it is NOT set the route refuses to run at all rather
 * than falling open: an unprotected endpoint that quietly works is worse than
 * one that visibly does not.
 */

/* Reading eight folders can take longer than the default allowance, and the
   first run reads a week. Pro allows five minutes. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set — refusing to run unprotected." },
      { status: 503, headers: { "cache-control": "no-store" } });
  }

  const offered = request.headers.get("authorization");
  if (offered !== `Bearer ${secret}`) {
    return new NextResponse("Not authorised", {
      status: 401, headers: { "cache-control": "no-store" } });
  }

  try {
    const result = await syncMailboxes();
    /* A partial failure still returns what did work, and says so. Reporting a
       clean 200 on a run where three mailboxes threw is how a broken job goes
       unnoticed for a month. */
    return NextResponse.json(result, {
      status: result.ok ? 200 : 207,
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { "cache-control": "no-store" } });
  }
}
