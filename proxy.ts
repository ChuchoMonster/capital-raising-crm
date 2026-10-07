import { auth } from "@/app/lib/auth";
import { NextResponse } from "next/server";

/**
 * The outer gate.
 *
 * Named proxy.ts, not middleware.ts: Next 16 renamed the convention and warns
 * on the old name. Same file, same behaviour, runs before anything is served.
 *
 * This is deliberately the coarsest check in the app: is there a session at
 * all. It is not the only check — every page that reads data guards itself as
 * well (see `requireUser`). Two independent gates means one missed `await`
 * somewhere does not expose eighteen thousand people.
 *
 * The reason this exists as middleware rather than a layout: files under
 * `public/` never run React. `/index/contacts.json` is served straight off
 * the CDN, so a layout cannot protect it — a request for it does not render
 * anything. Middleware runs first, before the file is served, and is the only
 * thing standing in front of it today.
 *
 * That is a patch, not the fix. The fix is to stop publishing those files at
 * all and serve search from the database, which is the next piece of work.
 * Until then this must not be weakened.
 */

/** Reachable with no session — and nothing else may be added lightly. */
const PUBLIC = [
  "/api/auth", // or nobody could ever sign in
  "/login",    // the sign-in screen itself
  /* The scheduled mailbox read. There is no person on a cron call, so there is
     no session for this gate to find. It is not unguarded: the route itself
     requires a shared secret and refuses to run if one is not configured. */
  "/api/cron",
  /* The self-check a deploy runs against itself. Same reasoning and the same
     protection as the cron routes: no person is calling it, so there is no
     session here to find, and the route requires the shared secret and refuses
     to answer at all if one is not configured. It only ever READS. */
  "/api/health",
  /* NB /access-decide is gone (2026-08-26). It let an approver approve or
     decline straight from a notification email, with a token standing in for a
     session. There is no request to approve any more — somebody at Halden Ridge adds a
     person directly — so the unauthenticated route went with it. */
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();

  // `req.auth` is the session. The session callback returns no user for anyone
  // no longer on the allowlist, so a revoked person fails here too.
  if (req.auth?.user?.email) return NextResponse.next();

  // An asset request should be refused, not redirected: a JSON fetch that
  // follows a redirect to an HTML login page produces a confusing parse error
  // rather than an honest 401.
  const wantsHtml = req.headers.get("accept")?.includes("text/html");
  if (!wantsHtml) {
    return new NextResponse("Not authorised", {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }

  const to = new URL("/login", req.nextUrl.origin);
  if (pathname !== "/") to.searchParams.set("next", pathname + req.nextUrl.search);
  const res = NextResponse.redirect(to);
  res.headers.set("cache-control", "no-store");
  return res;
});

export const config = {
  /**
   * Everything except Next's own build output and the favicon.
   *
   * Note what is NOT excluded: `/index/*.json` and everything else under
   * `public/`. Excluding static files is the common default and it is exactly
   * the hole here, because the search index is a static file.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
