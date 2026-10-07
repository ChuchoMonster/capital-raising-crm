"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "../session";
import { buildTeaser } from "./teaser-store";
import { TeaserFailed } from "./teaser";

/**
 * Draft the teaser again, from the deal page.
 *
 * Needed for two ordinary cases and one awkward one: a deal uploaded before
 * teasers existed, a deal whose documents changed, and a draft that came back
 * thin because a deck was written in a way the reader struggled with. It is a
 * deliberate button rather than something that happens on view — it costs a
 * model call, and a document that goes to investors should change when somebody
 * decides it should.
 */
export async function redraftTeaser(dealRef: string): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  try {
    const t = await buildTeaser(dealRef);
    revalidatePath(`/deals/${dealRef}`);
    return {
      ok: true,
      message: t.gaps.length
        ? `Teaser drafted. ${t.gaps.length} ${t.gaps.length === 1 ? "line was" : "lines were"} left out because the documents do not say it.`
        : "Teaser drafted.",
    };
  } catch (e) {
    if (e instanceof TeaserFailed) return { ok: false, message: e.message };
    console.error("teaser draft failed", dealRef, e);
    return { ok: false, message: "The teaser could not be drafted." };
  }
}
