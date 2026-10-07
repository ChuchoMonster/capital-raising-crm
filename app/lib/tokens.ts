import "server-only";
import { randomBytes } from "node:crypto";
import { query, one } from "./db";

/**
 * The links that go out by email.
 *
 * A token is 32 random bytes, stored as a row. Not a signed JWT: a row can be
 * looked up, expired, and — the part that matters — REVOKED, which a signed
 * token cannot be without keeping a list of revocations anyway.
 *
 * Lifetimes, and why they differ:
 *
 *   set-password  5 days   agreed 2026-08-16. A new account holds nothing yet,
 *                          and a link that dies is a support call.
 *   reset         2 hours  a live account reaches eighteen thousand contacts,
 *                          so a forgotten-password link sitting in an inbox for
 *                          five days is a different proposition entirely.
 *   decide        30 days  an approver may be on holiday; the request should
 *                          still be actionable when they get back.
 *
 * None of them is one-shot. `used_at` records the first use for the audit trail
 * but does not close the door — a link that dies on a fumbled retype is a
 * support call, which was the reasoning behind the five days in the first place.
 *
 * The one exception, and it is deliberate: setting a password successfully
 * RETIRES any other outstanding reset link for that person (see retireTokens).
 * Once someone holds a working password, a spare reset link sitting in an inbox
 * is no longer a convenience, only a liability. Set-password links are left
 * alone — five days, reusable, exactly as agreed.
 */

export type Purpose = "set-password" | "reset" | "decide";

const LIFETIME: Record<Purpose, number> = {
  "set-password": 5 * 24 * 60 * 60 * 1000,
  reset: 2 * 60 * 60 * 1000,
  decide: 30 * 24 * 60 * 60 * 1000,
};

export async function issueToken(
  personId: string, purpose: Purpose, approverEmail?: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await query(
    `insert into access_tokens (token, person_id, purpose, approver_email, expires_at)
     values ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)`,
    [token, personId, purpose, approverEmail ?? null, String(LIFETIME[purpose])],
  );
  return token;
}

export interface ResolvedToken {
  token: string;
  personId: string;
  purpose: Purpose;
  approverEmail: string | null;
  email: string;
  name: string;
  state: string;
  kind: string;
}

/** The token and the person it belongs to, or null if it is unknown or expired. */
export async function resolveToken(token: string, purpose: Purpose): Promise<ResolvedToken | null> {
  if (!token || token.length < 20) return null;
  const r = await one<Record<string, string>>(
    `select t.token, t.person_id, t.purpose, t.approver_email,
            p.email, p.name, p.state, p.kind
     from access_tokens t join app_people p on p.id = t.person_id
     where t.token = $1 and t.purpose = $2 and t.expires_at > now()`,
    [token, purpose],
  );
  if (!r) return null;
  return {
    token: r.token, personId: r.person_id, purpose: r.purpose as Purpose,
    approverEmail: r.approver_email ?? null,
    email: r.email, name: r.name, state: r.state, kind: r.kind,
  };
}

export async function markUsed(token: string): Promise<void> {
  await query(`update access_tokens set used_at = coalesce(used_at, now()) where token = $1`, [token]);
}

/** Retire every outstanding token of a kind — used when a password is set. */
export async function retireTokens(personId: string, purpose: Purpose): Promise<void> {
  await query(
    `update access_tokens set expires_at = now() where person_id = $1 and purpose = $2 and expires_at > now()`,
    [personId, purpose],
  );
}
