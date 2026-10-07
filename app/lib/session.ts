import "server-only";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { initialsFor, isApprover } from "./allowed";

/**
 * The inner gate — the one every page that reads data must pass through.
 *
 * middleware.ts already refused anyone without a session before this runs, so
 * in normal operation this is the second lock on the same door. It exists
 * because middleware is one config line away from being bypassed: change the
 * matcher, add a path to PUBLIC, deploy to a host that runs middleware
 * differently, and the outer gate quietly stops covering a route. The page
 * itself asking "who is this?" cannot be skipped by accident.
 *
 * Calling this also has a second, less obvious effect that matters just as
 * much: reading the session reads a cookie, and reading a cookie forces Next
 * to render the page per-request. Without it, a data-bearing page can be
 * rendered once at build time and served from a shared cache to whoever asks
 * — a leak that no amount of sign-in code would prevent.
 */

export interface SessionUser {
  name: string;
  email: string;
  /** Initials for the avatar. Two letters reads better than one at 26px. */
  initials: string;
  /** May see the access list. */
  approver: boolean;
}

/** The signed-in person, or null. Never throws. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const email = session?.user?.email;
  const name = session?.user?.name;
  if (!email || !name) return null;
  return { name, email, initials: initialsFor(name), approver: isApprover(email) };
}

/** The signed-in person, or send them to sign in. Use this on every page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * For the two pages that manage access. A person who is signed in but not an
 * approver is sent to the landing page rather than shown a refusal — there is
 * nothing for them there, and "you are not allowed" invites a second try.
 */
export async function requireApprover(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.approver) redirect("/");
  return user;
}
