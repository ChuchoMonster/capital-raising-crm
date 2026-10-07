"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "../session";
import { putVerdict, clearVerdict, type Verdict } from "./verdicts";

/**
 * Recording what a firm said, by hand.
 *
 * The email reader covers the replies. This covers the rest, which is most of
 * it — Halden Ridge hear a great deal of this on the phone and in meetings, and a system
 * that could only learn from email would be wrong about the deals that matter
 * most (client, 2026-08-31).
 *
 * A hand-typed verdict OUTRANKS one read from an email, and simply overwrites
 * it: a person who has spoken to the firm knows better than a paragraph.
 */
export async function recordVerdict(input: {
  dealRef: string;
  accountId: string;
  verdict: Verdict | "Open";
  note?: string;
}): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();

  /* Back to Open — which is the absence of a verdict, not a third value. This
     is the undo, and it has to be one click: the whole design rests on a wrong
     verdict being survivable. */
  if (input.verdict === "Open") {
    await clearVerdict(input.dealRef, input.accountId);
    revalidatePath("/outreach");
    return { ok: true, message: "Back to open." };
  }

  if (input.verdict !== "Accepted" && input.verdict !== "Passed")
    return { ok: false, message: "That is not a verdict." };

  const ok = await putVerdict({
    dealRef: input.dealRef,
    accountId: input.accountId,
    verdict: input.verdict,
    source: "manual",
    /* Whose word it is, so nobody has to wonder later whether a person or a
       machine decided it. */
    evidence: (input.note ?? "").trim() || `Recorded by ${user.email}`,
    recordedBy: user.email,
  });
  if (!ok) return { ok: false, message: "That deal no longer exists." };

  revalidatePath("/outreach");
  return { ok: true, message: `Marked ${input.verdict.toLowerCase()}.` };
}
