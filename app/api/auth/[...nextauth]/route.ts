import { handlers } from "@/app/lib/auth";

/**
 * The Microsoft sign-in endpoints. Auth.js owns every path under
 * /api/auth/* — the redirect out to Microsoft, the callback back, the
 * session read, and sign-out.
 *
 * These must stay reachable without a session, or nobody could ever sign in.
 * middleware.ts exempts this prefix for that reason and no other.
 */
export const { GET, POST } = handlers;
