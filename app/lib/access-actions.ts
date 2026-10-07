"use server";

import { revalidatePath } from "next/cache";
import { query, one } from "./db";
import { requireUser } from "./session";
import { isApprover } from "./allowed";
import { hashPassword, passwordProblem } from "./passwords";
import { issueToken, resolveToken, markUsed, retireTokens } from "./tokens";
import { sendMail, origin } from "./mail-send";
import { approvers, findPerson, findPersonById, normalise, logAccess } from "./access-store";

/**
 * Everything that changes who can get in.
 *
 * A CRM's users are not strangers who apply. Somebody at Halden Ridge already knows the
 * person and decides to give them access — so there is no request form and no
 * approve/decline round trip (removed 2026-08-26). Grace or Alan adds
 * them, and the CRM emails them a link to choose their own password.
 *
 * NOBODY HERE EVER TYPES SOMEBODY ELSE'S PASSWORD. The obvious version of "add
 * a user" has the person adding them invent a password and then tell them —
 * over email, or a chat window — which puts the key to eighteen thousand
 * private addresses into a channel nobody controls, and leaves it in a message
 * history for ever. A link costs the same click and avoids all of it.
 *
 * Two rules still run through what is left:
 *
 *  1. NOTHING HERE TELLS A STRANGER WHAT EXISTS. Asking to reset a password
 *     for an address with no account returns the same calm confirmation as the
 *     ordinary case, or this becomes a way to test who is on Halden Ridge's list.
 *
 *  2. AN EMAIL THAT FAILS TO SEND IS REPORTED, NOT SWALLOWED. Somebody added
 *     but never emailed looks identical to somebody who has not got round to
 *     setting their password.
 */

/* ── request access ───────────────────────────────────────────────────────── */

/**
 * Where a reply to one of these emails should land.
 *
 * The FROM address is on `send.halden-ridge.example`, a subdomain that exists only
 * to send: its mail routing points at Amazon's bounce handler rather than a
 * mail host, so a reply addressed there would be rejected. Setting a reply-to
 * fixes that outright, needs no mailbox created and no DNS change — the two
 * addresses are independent, and only the FROM one has to be on a verified
 * domain.
 *
 * Whoever decided is the right person to reach: they are the one who just made
 * a judgement about this stranger, and the email they receive is at their real
 * Halden Ridge mailbox rather than anything new.
 */
export interface Result { ok: boolean; message: string }

/**
 * Add somebody, and email them a link to set their own password.
 *
 * Approver-only, like revoke — the same two people who can take access away
 * are the two who can grant it. Widening that to "anyone on the team" was
 * considered and left alone: it costs nothing to keep, and an account that can
 * read every contact Halden Ridge holds is not something to make casually creatable.
 *
 * Re-adding somebody who was revoked works and is the intended way back in:
 * their old password is already gone, so they get a fresh link like anyone
 * else. Re-adding somebody already active does NOT reset them — it just sends
 * another link, which is the sensible reading of clicking Add twice.
 */
export async function addUser(input: { name: string; email: string }): Promise<Result> {
  const user = await requireUser();
  if (!isApprover(user.email)) return { ok: false, message: "Only Grace or Alan can add people." };

  const name = input.name.trim();
  const email = normalise(input.email);
  if (!name) return { ok: false, message: "Enter their name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "That does not look like an email address." };

  const existing = await findPerson(email);

  /* Somebody who signs in with Microsoft has no password to set, and sending
     them a link would be a confusing dead end. */
  if (existing?.kind === "microsoft" && existing.state === "active")
    return { ok: false, message: `${existing.name} is at Halden Ridge and already signs in with Microsoft.` };

  const row = existing
    ? await one<{ id: string }>(
        `update app_people set name = $2, state = 'active', kind = 'password',
                decided_at = now(), decided_by = $3, revoked_at = null, revoked_by = null
         where id = $1 returning id`, [existing.id, name, user.email])
    : await one<{ id: string }>(
        `insert into app_people (name, email, kind, state, role, reason, decided_at, decided_by)
         values ($1, $2, 'password', 'active', '', $3, now(), $4) returning id`,
        [name, email, `Added by ${user.email}`, user.email]);
  if (!row) return { ok: false, message: "Something went wrong saving that. Try again." };

  await logAccess("added", { personId: row.id, email, actor: user.email });

  const token = await issueToken(row.id, "set-password");
  try {
    await sendMail({
      to: email,
      subject: "Your Halden Ridge CRM access",
      replyTo: replyAddress(user.email),
      body: [
        `Hello ${name.split(" ")[0]},`,
        ``,
        `You have been given access to the Halden Ridge CRM. Choose a password to finish setting up your account.`,
        ``,
        `[Set your password](${origin()}/login/set-password?t=${token})`,
        ``,
        `The link works for five days, and as many times as you need within that.`,
        ``,
        `Halden Ridge Advisors`,
      ].join("\n"),
    });
  } catch (e) {
    /* They exist and cannot get in. Saying so is the whole point — an account
       nobody can use looks exactly like one nobody has used yet. */
    await logAccess("add-email-failed", { personId: row.id, email, actor: user.email, detail: String(e).slice(0, 300) });
    return { ok: false, message: `${name} was added, but the email did not send. They cannot set a password until it does.` };
  }

  revalidatePath("/access");
  return { ok: true, message: `${name} has been emailed a link to set a password.` };
}

function replyAddress(actor: string | null | undefined): string | undefined {
  const a = (actor ?? "").trim();
  /* Only a real address. The actor is normally an approver's email, but a
     future caller could pass a name, and a malformed reply-to makes some
     clients drop the whole message rather than ignore the header. */
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a) ? a : undefined;
}

/* ── approve / decline ────────────────────────────────────────────────────── */

export async function revoke(personId: string): Promise<Result> {
  const user = await requireUser();
  if (!isApprover(user.email)) return { ok: false, message: "Only Grace or Alan can revoke access." };

  const person = await findPersonById(personId);
  if (!person) return { ok: false, message: "That person no longer exists." };
  if (person.email === user.email) return { ok: false, message: "You cannot revoke your own access." };

  await query(
    `update app_people set state = 'revoked', revoked_at = now(), revoked_by = $2, password_hash = null
     where id = $1`, [personId, user.email]);
  /* Every outstanding link dies with the account. Leaving a live set-password
     link behind a revoked account is a way back in. */
  await query(`update access_tokens set expires_at = now() where person_id = $1`, [personId]);
  await logAccess("revoked", { personId, email: person.email, actor: user.email });
  revalidatePath("/access");
  return { ok: true, message: `${person.name} can no longer sign in.` };
}

export async function restore(personId: string): Promise<Result> {
  const user = await requireUser();
  if (!isApprover(user.email)) return { ok: false, message: "Only Grace or Alan can restore access." };
  const person = await findPersonById(personId);
  if (!person) return { ok: false, message: "That person no longer exists." };

  /* Straight back to active, and emailed a fresh link. It used to go to
     "pending" so an approver could approve them, which was how a link got
     sent — but there is no approve step any more, and leaving somebody
     parked in a state nothing can move them out of would be a dead end.
     Revoking wiped their password, so restoring genuinely has to give them a
     way to set a new one. */
  await query(
    `update app_people set state = 'active', kind = 'password', decided_at = now(), decided_by = $2,
            revoked_at = null, revoked_by = null
     where id = $1`, [personId, user.email]);
  await logAccess("restored", { personId, email: person.email, actor: user.email });

  /* Somebody at Halden Ridge restored to Microsoft sign-in needs no link. */
  if (person.kind === "microsoft") {
    revalidatePath("/access");
    return { ok: true, message: `${person.name} can sign in with Microsoft again.` };
  }

  const token = await issueToken(personId, "set-password");
  try {
    await sendMail({
      to: person.email,
      subject: "Your Halden Ridge CRM access",
      replyTo: replyAddress(user.email),
      body: [
        `Hello ${person.name.split(" ")[0]},`,
        ``,
        `Your access to the Halden Ridge CRM has been restored. Choose a password to sign in again.`,
        ``,
        `[Set your password](${origin()}/login/set-password?t=${token})`,
        ``,
        `The link works for five days.`,
        ``,
        `Halden Ridge Advisors`,
      ].join("\n"),
    });
  } catch (e) {
    await logAccess("restore-email-failed", { personId, email: person.email, actor: user.email, detail: String(e).slice(0, 300) });
    revalidatePath("/access");
    return { ok: false, message: `${person.name} was restored, but the email did not send. They cannot set a password until it does.` };
  }

  revalidatePath("/access");
  return { ok: true, message: `${person.name} has been emailed a link to set a password.` };
}

/* ── setting a password ───────────────────────────────────────────────────── */

export async function setPassword(token: string, password: string, purpose: "set-password" | "reset"): Promise<Result> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, message: problem };

  const t = await resolveToken(token, purpose);
  if (!t) return { ok: false, message: "That link has expired or is not valid. Ask for a new one." };
  if (t.state !== "active") return { ok: false, message: "That account is not active. Contact Halden Ridge." };

  await query(`update app_people set password_hash = $2, kind = 'password' where id = $1`,
    [t.personId, await hashPassword(password)]);
  await markUsed(token);
  /* Any other reset link in an inbox is now a liability rather than a
     convenience. Set-password links are left alone — five days, reusable. */
  await retireTokens(t.personId, "reset");
  await logAccess(purpose === "reset" ? "password-reset" : "password-set", { personId: t.personId, email: t.email });
  return { ok: true, message: "Password set. You can sign in now." };
}

/* ── forgot password ──────────────────────────────────────────────────────── */

const RESET_CONFIRM = "If that address has a password account here, a reset link is on its way. It lasts two hours.";

export async function forgotPassword(email: string): Promise<Result> {
  const addr = normalise(email);
  if (!addr) return { ok: false, message: "Enter your email address." };

  const person = await findPerson(addr);

  /* Same answer either way. See rule 1 — this must not become a way to find
     out who has an account. */
  if (!person || person.state !== "active") {
    await logAccess("reset-miss", { email: addr });
    return { ok: true, message: RESET_CONFIRM };
  }

  /* Somebody at Halden Ridge signs in with Microsoft and has no password to forget.
     Telling them so is not a leak — they already know they work at Halden Ridge — and
     it saves them waiting for an email that would never help. */
  if (person.kind === "microsoft") {
    return { ok: true, message: "That address signs in with Microsoft — use Continue with Microsoft instead. No password needed." };
  }

  const token = await issueToken(person.id, "reset");
  try {
    await sendMail({
      to: person.email,
      subject: "Reset your Halden Ridge CRM password",
      /* Nobody decided this one — the person asked for it themselves — so it
         replies to whoever approves access. */
      replyTo: replyAddress((await approvers())[0]?.email),
      body: [
        `Hello ${person.name.split(" ")[0]},`,
        ``,
        `Someone asked to reset the password on your Halden Ridge CRM account.`,
        ``,
        `[Choose a new password](${origin()}/login/set-password?t=${token}&reset=1)`,
        ``,
        `The link lasts two hours. If this was not you, ignore this email — your password has not changed.`,
        ``,
        `Halden Ridge Advisors`,
      ].join("\n"),
    });
  } catch (e) {
    await logAccess("reset-email-failed", { personId: person.id, email: addr, detail: String(e).slice(0, 300) });
    return { ok: false, message: "The reset email did not send. Please contact Halden Ridge directly." };
  }
  await logAccess("reset-sent", { personId: person.id, email: addr });
  return { ok: true, message: RESET_CONFIRM };
}
