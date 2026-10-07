"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./session";
import { query, one } from "./db";
import { resolveSelection, countSelection, type Selection } from "./selection";
import type { DealStatus } from "./types";

/**
 * Things a person does, as opposed to things research does.
 *
 * Everything here writes to the people-owned tables. Nothing here can be
 * touched by a research load, and nothing here writes to a research table —
 * that separation is the reason a monthly reload cannot erase anyone's work.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Put people on a deal.
 *
 * IT DOES NOT DRAFT ANYTHING. Adding somebody to a deal and emailing them are
 * two decisions, and collapsing them into one is how a half-built recipient
 * list turns into fifty sent emails. Drafting is its own deliberate step, from
 * the deal's own page.
 */
export async function addToDeal(dealRef: string, selection: Selection): Promise<ActionResult> {
  const user = await requireUser();

  const deal = await one<{ id: string; title: string }>(
    `select id, title from deals where reference = $1`, [dealRef]);
  if (!deal) return { ok: false, message: "That deal no longer exists." };

  const ids = await resolveSelection(selection, "contacts");
  if (!ids.length) return { ok: false, message: "Nothing was selected." };

  /* on conflict do nothing, so adding the same person twice is harmless and
     never resets where they had got to.

     THIS IS PER PERSON, NOT PER REQUEST. Selecting somebody already on the deal
     alongside two who are not adds the two and skips the one — a duplicate is
     never a reason to reject the whole batch, because in practice that batch is
     someone re-running a filter and picking up one familiar name. */
  const res = await query<{ contact_id: string }>(
    `insert into deal_contacts (deal_id, contact_id, added_by)
     select $1, unnest($2::text[]), $3
     on conflict (deal_id, contact_id) do nothing
     returning contact_id`,
    [deal.id, ids, user.email],
  );

  revalidatePath("/deals");

  const addedIds = new Set(res.map((r) => r.contact_id));
  const skipped = ids.filter((id) => !addedIds.has(id));

  /* Named, not counted. "1 was already on it" leaves the person wondering which,
     and the answer decides whether they need to do anything about it. */
  let skippedNames: string[] = [];
  if (skipped.length) {
    const rows = await query<{ name: string }>(
      `select coalesce(nullif(full_name, ''), email) as name
       from contacts where hr_id = any($1::text[]) order by full_name nulls last`,
      [skipped],
    );
    skippedNames = rows.map((r) => r.name);
  }

  const list = (names: string[]) =>
    names.length <= 3
      ? names.join(names.length === 2 ? " and " : ", ")
      : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;

  if (!res.length) {
    /* Nothing changed, and that is worth saying plainly rather than reporting a
       cheerful "added 0 people". Still ok:true — no action failed, there was
       simply nothing left to do. */
    return {
      ok: true,
      message: skippedNames.length === 1
        ? `${skippedNames[0]} is already on ${deal.title}. Nothing was added.`
        : `${list(skippedNames)} are already on ${deal.title}. Nothing was added.`,
    };
  }

  return {
    ok: true,
    message:
      `Added ${res.length.toLocaleString()} ${res.length === 1 ? "person" : "people"} to ${deal.title}.` +
      (skippedNames.length
        ? ` ${list(skippedNames)} ${skippedNames.length === 1 ? "was" : "were"} already on it and ${skippedNames.length === 1 ? "was" : "were"} skipped.`
        : "") +
      " Nothing has been drafted or sent.",
  };
}



/**
 * Remove deals, and everything filed under them.
 *
 * The database cascades to the deal's contact list, its documents and its
 * drafts — so this also erases the record of who was emailed on that deal and
 * who replied. What it does NOT touch is `mail_events`, the mailbox ledger:
 * the messages themselves happened, and a deal being deleted does not unsend
 * them. That is why the confirmation says people, not just deals.
 *
 * No soft delete. A deal uploaded by mistake should go, and a "removed" flag
 * that every query has to remember to filter is a bug waiting for the one
 * query that forgets.
 */
export async function deleteDeals(refs: string[]): Promise<ActionResult> {
  await requireUser();
  if (!refs.length) return { ok: false, message: "Nothing was selected." };

  const gone = await query<{ title: string }>(
    `delete from deals where reference = any($1::text[]) returning title`, [refs]);
  if (!gone.length) return { ok: false, message: "Those deals no longer exist." };

  revalidatePath("/deals");
  revalidatePath("/outreach");
  revalidatePath("/");
  /* Named, not counted — "3 deals removed" leaves the person wondering which. */
  return {
    ok: true,
    message: gone.length === 1
      ? `${gone[0].title} removed.`
      : `Removed ${gone.map((g) => g.title).join(", ")}.`,
  };
}

/**
 * Mark a raise finished, or start working it again.
 *
 * THE POINT OF THIS IS THAT IT IS NOT DELETION. Removing a deal cascades to its
 * contact list and the record of who was emailed on it, so until now a finished
 * raise either sat on the list looking live or was destroyed along with the
 * evidence of the work done on it. Completing it keeps every bit of that and
 * says the raise is over.
 *
 * REVERSIBLE, deliberately. A raise can restart, and a one-click state change
 * with no way back is a trap.
 *
 * ONE THING IT QUIETLY CHANGES: reply-checking reads live deals only, so a
 * completed deal stops asking whether an investor passed. That is right — but
 * it means a late reply to that raise goes unclassified, which is why the
 * button says what it does before it is pressed.
 */
export async function setDealStatus(
  refs: string[], status: DealStatus,
): Promise<ActionResult> {
  await requireUser();
  if (!refs.length) return { ok: false, message: "Nothing was selected." };

  const moved = await query<{ title: string }>(
    `update deals set status = $2 where reference = any($1::text[])
     returning title`, [refs, status]);
  if (!moved.length) return { ok: false, message: "Those deals no longer exist." };

  revalidatePath("/deals");
  revalidatePath("/outreach");
  revalidatePath("/");
  const done = status === "Complete";
  /* Named, not counted, for the same reason removal names them. */
  const names = moved.map((m) => m.title).join(", ");
  return {
    ok: true,
    message: moved.length === 1
      ? `${moved[0].title} is ${done ? "complete" : "live again"}.`
      : done ? `${names} are complete.` : `${names} are live again.`,
  };
}

/** The deals someone can add to. */
export async function listDeals(): Promise<{ reference: string; title: string; people: number }[]> {
  await requireUser();
  return query(
    `select d.reference, d.title, count(dc.contact_id)::int as people
     from deals d left join deal_contacts dc on dc.deal_id = d.id
     group by d.id, d.reference, d.title
     order by d.created_at desc`);
}

/** How many rows a selection covers. Used to label the buttons honestly. */
export async function selectionCount(
  selection: Selection,
  kind: "contacts" | "accounts",
): Promise<number> {
  await requireUser();
  return countSelection(selection, kind);
}

/**
 * Take people off a deal.
 *
 * WHAT IT DOES NOT DO IS DELETE ANYTHING ELSE. The person stays in the CRM,
 * their record is untouched, and the record of what was actually sent to them
 * stays in the mail ledger — which is the whole reason this is safe to offer.
 * Removing somebody from a list is a change of plan, not a rewriting of what
 * already happened.
 *
 * It does drop any UNSENT draft the CRM wrote for them on this deal, because a
 * draft is a plan too, and leaving one sitting in Outlook for somebody who has
 * been taken off the list is how a pitch goes out that nobody intended. A
 * draft already sent is left alone — it is history by then.
 *
 * Somebody already emailed on this deal is named back rather than silently
 * removed: taking them off loses the record of where they had got to, and that
 * is a decision the person clicking should make knowingly.
 */
export async function removeFromDeal(dealRef: string, contactIds: string[]): Promise<ActionResult> {
  await requireUser();
  if (!contactIds.length) return { ok: false, message: "Nobody is selected." };

  const deal = await one<{ id: string; title: string }>(
    `select id, title from deals where reference = $1`, [dealRef]);
  if (!deal) return { ok: false, message: "That deal no longer exists." };

  /* Read who they were BEFORE removing them — afterwards the join is gone and
     the message could only say a number. */
  const going = await query<{ contact_id: string; name: string; emailed: boolean }>(
    `select dc.contact_id, coalesce(nullif(c.full_name, ''), c.email) as name,
            dc.sent_at is not null as emailed
     from deal_contacts dc
     join contacts c on c.hr_id = dc.contact_id
     where dc.deal_id = $1 and dc.contact_id = any($2::text[])`,
    [deal.id, contactIds]);
  if (!going.length) return { ok: false, message: "None of those are on this deal." };

  await query(
    `delete from deal_drafts where deal_id = $1 and contact_id = any($2::text[]) and sent_at is null`,
    [deal.id, contactIds]);
  const gone = await query<{ contact_id: string }>(
    `delete from deal_contacts where deal_id = $1 and contact_id = any($2::text[]) returning contact_id`,
    [deal.id, contactIds]);

  revalidatePath(`/deals/${dealRef}`);
  revalidatePath("/deals");
  revalidatePath("/outreach");

  const n = gone.length;
  const emailed = going.filter((g) => g.emailed).map((g) => g.name);
  const who = n === 1 ? going[0].name : `${n} people`;
  return {
    ok: true,
    message: emailed.length
      ? `${who} removed from ${deal.title}. ${emailed.length === 1 ? `${emailed[0]} had` : `${emailed.length} of them had`} already been emailed — that email is still on their record.`
      : `${who} removed from ${deal.title}.`,
  };
}

/* ── Ruling a firm out of one deal's matched list ────────────────────────── */

/**
 * Take a firm off this deal's matched list.
 *
 * The list itself is worked out fresh every time it is opened, so a judgement
 * made while reading it has nowhere to live unless it is written down. This
 * writes it down — against the DEAL, never against the firm. "Not for this
 * raise" is almost always about the raise, and the same firm stays on every
 * other deal's list untouched.
 *
 * Nobody already added to the deal is affected: removing a firm from the
 * suggestions is not the same as removing its people from the outreach, and
 * conflating the two would silently undo work.
 */
export async function removeMatchedAccount(dealRef: string, accountId: string): Promise<ActionResult> {
  const user = await requireUser();
  const deal = await one<{ id: string }>(`select id from deals where reference = $1`, [dealRef]);
  if (!deal) return { ok: false, message: "That deal no longer exists." };

  const account = await one<{ name: string }>(`select name from accounts where hr_id = $1`, [accountId]);
  if (!account) return { ok: false, message: "That firm no longer exists." };

  await query(
    `insert into deal_target_removals (deal_id, account_id, removed_by)
     values ($1, $2, $3) on conflict (deal_id, account_id) do nothing`,
    [deal.id, accountId, user.email]);

  revalidatePath(`/deals/${dealRef}/targets`);
  return { ok: true, message: `${account.name} removed from this deal's matched list.` };
}

/** Put one back. The row goes; nothing about the firm ever changed. */
export async function restoreMatchedAccount(dealRef: string, accountId: string): Promise<ActionResult> {
  await requireUser();
  const deal = await one<{ id: string }>(`select id from deals where reference = $1`, [dealRef]);
  if (!deal) return { ok: false, message: "That deal no longer exists." };

  await query(`delete from deal_target_removals where deal_id = $1 and account_id = $2`,
    [deal.id, accountId]);

  const account = await one<{ name: string }>(`select name from accounts where hr_id = $1`, [accountId]);
  revalidatePath(`/deals/${dealRef}/targets`);
  return { ok: true, message: `${account?.name ?? "That firm"} is back on the matched list.` };
}
