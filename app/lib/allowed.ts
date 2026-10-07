/**
 * Who gets in.
 *
 * A short named list rather than "anyone in the Halden Ridge tenant". The
 * tenant contains mailboxes, shared boxes and any guest anyone has ever
 * invited; this list is the handful who should see thousands of people's
 * private addresses.
 *
 * Staff sign in with their Halden Ridge Microsoft account. An outside
 * consultant with no Halden Ridge mailbox signs in as a guest of the tenant —
 * same directory, same revocation.
 *
 * NB use each person's PRIMARY address, not a friendly alias — Microsoft
 * rejects an alias for sign-in.
 *
 * In this public copy the list holds one demo account only.
 *
 * This file is imported by the server-side sign-in check AND by client
 * components, so it must never contain anything that is not already public to
 * a signed-in user. Names and work addresses only.
 */

export interface AllowedPerson {
  name: string;
  email: string;
  /** Sees the access list. Everyone else gets a 404 on that page. */
  approver?: boolean;
}

export const ALLOWED: readonly AllowedPerson[] = [
  { name: "Demo User", email: "demo@example.com", approver: true },
] as const;

/**
 * Microsoft does not hand back a plain address for a guest.
 *
 * A guest's `preferred_username` arrives mangled into the directory's own
 * form — `jordan.pike_consultancy.example#EXT#@haldenridge.onmicrosoft.com` — because
 * the guest's real address belongs to another directory. Reversing that is
 * what lets a guest in at all, and getting it wrong locks them out with no error
 * that says why.
 *
 * The last underscore is the one that was a `@`: an address may legitimately
 * contain earlier underscores (`first_last@firm.example`), so splitting on the
 * first would produce nonsense.
 */
export function normaliseEmail(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "";

  const ext = value.indexOf("#ext#");
  if (ext === -1) return value;

  const local = value.slice(0, ext);
  const cut = local.lastIndexOf("_");
  if (cut === -1) return local;
  return `${local.slice(0, cut)}@${local.slice(cut + 1)}`;
}

/** The person, or null. Null means no entry — there is no partial access. */
export function findAllowed(raw: string | null | undefined): AllowedPerson | null {
  const email = normaliseEmail(raw);
  if (!email) return null;
  return ALLOWED.find((p) => p.email.toLowerCase() === email) ?? null;
}

export function isApprover(email: string | null | undefined): boolean {
  return findAllowed(email)?.approver === true;
}

/** Two letters reads better than one at 26px. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
}
