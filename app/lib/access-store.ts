import "server-only";
import { query, one } from "./db";
import type { AccessRow, AccessState, AccessKind } from "./access";

/**
 * Who has access — read from the database, not the array.
 *
 * This replaces the placeholder list `access.ts` shipped with. The shapes are
 * unchanged, which was the point of defining them first: the screens did not
 * have to move.
 *
 * The sign-in gate reads `isAllowed` below, so REVOKE finally means something.
 * It fails closed — an unreachable database refuses everybody rather than
 * falling back to the old array, because a fallback that ignores revocations
 * is worse than an outage.
 */

export const normalise = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

export interface Person {
  id: string; name: string; email: string;
  kind: AccessKind; state: AccessState; role: string;
  reason: string | null; passwordHash: string | null;
  requestedAt: string; decidedAt: string | null; decidedBy: string | null;
  lastSignInAt: string | null;
}

const shape = (r: Record<string, unknown>): Person => ({
  id: String(r.id), name: String(r.name), email: String(r.email),
  kind: r.kind as AccessKind, state: r.state as AccessState, role: String(r.role ?? ""),
  reason: (r.reason as string) ?? null, passwordHash: (r.password_hash as string) ?? null,
  requestedAt: r.requested_at ? new Date(r.requested_at as string).toISOString() : "",
  decidedAt: r.decided_at ? new Date(r.decided_at as string).toISOString() : null,
  decidedBy: (r.decided_by as string) ?? null,
  lastSignInAt: r.last_sign_in_at ? new Date(r.last_sign_in_at as string).toISOString() : null,
});

export async function findPerson(email: string): Promise<Person | null> {
  const r = await one<Record<string, unknown>>(`select * from app_people where email = $1`, [normalise(email)]);
  return r ? shape(r) : null;
}

export async function findPersonById(id: string): Promise<Person | null> {
  const r = await one<Record<string, unknown>>(`select * from app_people where id = $1`, [id]);
  return r ? shape(r) : null;
}

/**
 * THE GATE. Everything that lets somebody in goes through here.
 *
 * Active only. A pending request, a declined one and a revoked account are all
 * refused, and the caller is told nothing about which — a stranger learning
 * that an address exists but is revoked has learned something they should not.
 */
export async function isAllowed(email: string): Promise<Person | null> {
  const p = await findPerson(email);
  return p && p.state === "active" ? p : null;
}

/** Everyone, for the access page. */
export async function listPeople(): Promise<AccessRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select * from app_people
     order by case state when 'pending' then 0 when 'active' then 1 else 2 end,
              requested_at desc`);
  return rows.map((r) => {
    const p = shape(r);
    return {
      id: p.id, name: p.name, email: p.email, kind: p.kind, state: p.state,
      role: p.role, addedOn: p.requestedAt.slice(0, 10),
      lastSeen: p.lastSignInAt ? p.lastSignInAt.slice(0, 10) : "",
      reason: p.reason ?? "",
      approvedBy: p.decidedBy ?? "",
    } as AccessRow;
  });
}

/** Who receives an access request. Configurable so testing needs nobody else. */
export async function approvers(): Promise<{ name: string; email: string }[]> {
  const set = process.env.CRM_APPROVERS?.trim();
  if (set) {
    return set.split(",").map((e) => e.trim()).filter(Boolean).map((email) => ({ name: email.split("@")[0], email }));
  }
  const rows = await query<{ name: string; email: string }>(
    `select name, email from app_people
     where state = 'active' and email in ('grace@halden-ridge.example','alan@halden-ridge.example')
     order by email`);
  return rows;
}

export async function recordSignIn(email: string): Promise<void> {
  await query(`update app_people set last_sign_in_at = now() where email = $1`, [normalise(email)]);
}

export async function logAccess(
  action: string, opts: { personId?: string | null; email?: string; actor?: string; detail?: string } = {},
): Promise<void> {
  await query(
    `insert into access_log (person_id, email, action, actor, detail) values ($1,$2,$3,$4,$5)`,
    [opts.personId ?? null, opts.email ?? null, action, opts.actor ?? null, opts.detail ?? null]);
}
