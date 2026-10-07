/**
 * Who has access, and who is waiting on a decision.
 *
 * ⚠️ PLACEHOLDER DATA. There is no database yet, so this is a fixed list that
 * lets the screens be built and clicked through. The shapes are the real ones,
 * so wiring a database behind them changes this file and nothing else.
 *
 * Decisions this encodes:
 *  - Approve and Decline are buttons in the email. No sign-in gate on them.
 *  - Approving emails the person a link to set their own password.
 *  - A decline is never final: Grace can approve the same person later.
 *  - The set-password link works as many times as needed and lasts five days.
 *  - Someone whose link expired can request again.
 *  - Alan gets the same email as Grace, as an alternate.
 *  - Accounts do not expire; they are revoked by hand instead.
 */

export type AccessKind = "microsoft" | "password";
export type AccessState = "active" | "pending" | "declined" | "revoked";

export interface AccessRow {
  id: string;
  name: string;
  email: string;
  kind: AccessKind;
  state: AccessState;
  /** Free text — "Halden Ridge", "IT contractor", "Consultant". */
  role: string;
  addedOn: string;
  /** Blank means they have never signed in. That is the column that finds the
   *  contractor who finished in March and still has a way in. */
  lastSeen: string;
  approvedBy?: string;
  /** Pending only: what they said about themselves when they asked. */
  reason?: string;
}

export const ACCESS: AccessRow[] = [
  { id: "u1", name: "Alan Mercer", email: "alan@halden-ridge.example", kind: "microsoft", state: "active", role: "Halden Ridge", addedOn: "2026-08-16", lastSeen: "Today" },
  { id: "u2", name: "Grace Holloway", email: "grace@halden-ridge.example", kind: "microsoft", state: "active", role: "Halden Ridge · approves access", addedOn: "2026-08-16", lastSeen: "Today" },
  { id: "u3", name: "Peter Vance", email: "peter@halden-ridge.example", kind: "microsoft", state: "active", role: "Halden Ridge", addedOn: "2026-08-16", lastSeen: "Yesterday" },
  { id: "u4", name: "Ruth Okafor", email: "ruth@halden-ridge.example", kind: "microsoft", state: "active", role: "Halden Ridge", addedOn: "2026-08-16", lastSeen: "Today" },
  { id: "u6", name: "Jordan Pike", email: "jordan.pike@consultancy.example", kind: "microsoft", state: "active", role: "Consultant · guest", addedOn: "2026-08-16", lastSeen: "Today", approvedBy: "Grace" },
  { id: "u7", name: "Priya Nadar", email: "p.nadar@northgate-it.example", kind: "password", state: "active", role: "IT contractor", addedOn: "2026-07-02", lastSeen: "6 weeks ago", approvedBy: "Grace" },
  { id: "u8", name: "Tom Vickers", email: "t.vickers@northgate-it.example", kind: "password", state: "pending", role: "IT contractor", addedOn: "2026-08-16", lastSeen: "", reason: "Taking over from Priya on the mailbox migration. Northgate IT." },
  { id: "u9", name: "Dan Oyelowo", email: "dan@brightpath.example", kind: "password", state: "declined", role: "Unknown", addedOn: "2026-08-11", lastSeen: "", reason: "Would like to look at the investor list." },
];

export const STATE_LABEL: Record<AccessState, string> = {
  active: "Active",
  pending: "Waiting on approval",
  declined: "Declined",
  revoked: "Revoked",
};
