import "next-auth";
import "next-auth/jwt";

/**
 * Two extra facts travel with the session: whether this person may approve
 * access, and their initials for the avatar. Declaring them here is what makes
 * `session.approver` a compile error to misspell rather than a silent
 * `undefined` — which, for a permission flag, would read as "not an approver"
 * and fail quietly in the safe direction but for the wrong reason.
 */
declare module "next-auth" {
  interface Session {
    approver?: boolean;
    initials?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    approver?: boolean;
  }
}
