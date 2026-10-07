"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./session";
import { query, one } from "./db";
import { dealDocuments, recordDraft } from "./store";
import { download } from "./deal/storage";
import { teaserPdf } from "./deal/teaser-store";
import { createDraft, createReplyDraft, ThreadGone, type DraftAttachment } from "./graph-draft";
import { fillFor } from "./deal/merge";
import { mailboxes } from "./graph";

/**
 * Writing a deal's emails into a partner's Drafts folder.
 *
 * The order of everything below is deliberate. Each email is created, then
 * RECORDED, then the next one starts — rather than creating them all and
 * writing the records at the end. A run that dies halfway then leaves the CRM
 * agreeing with Outlook about exactly which ones exist. The other way round,
 * a partner opens Outlook to forty drafts the CRM has never heard of, and
 * pressing the button again would make forty more.
 *
 * It also stops at the first failure. Forty drafts where twelve are missing
 * their deck is a worse position than twelve drafts and a message saying what
 * went wrong, because nobody can tell by looking which of the forty are safe
 * to send.
 */

export interface DraftOutcome {
  ok: boolean;
  message: string;
  drafted: number;
  /** Who it stopped on, when it stopped. */
  failedOn?: string;
}

/**
 * An address typed in by hand, checked before it reaches Microsoft.
 *
 * Deliberately loose — this is a partner typing a colleague's address, not a
 * validator. It refuses the things that are obviously not an address, which is
 * enough to turn "the whole run failed" into "line 2 is wrong".
 */
const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;

/** "a@b.example, c@d.example" or one per line.
    NOT exported: a "use server" file may only export async functions, and this
    is only ever needed on the server anyway. */
function readAddresses(raw: string): { ok: string[]; bad: string[] } {
  const parts = (raw ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const ok: string[] = [], bad: string[] = [];
  for (const p of parts) (ADDRESS.test(p) ? ok : bad).push(p);
  return { ok: [...new Set(ok.map((x) => x.toLowerCase()))], bad };
}

const MAX_PER_RUN = 200;

export async function draftDealEmails(input: {
  dealRef: string;
  mailbox: string;
  subject: string;
  body: string;
  template: string;
  contactIds: string[];
  documentIds: string[];
  /**
   * Attach the deal's two-page teaser.
   *
   * Its own flag rather than an id in `documentIds`, because it is not one of
   * the uploaded documents — it is drawn from the deal on the way out, and a
   * magic id in a list of real ones is the kind of thing that survives until
   * somebody names a file "teaser".
   */
  teaser?: boolean;
  /** Copied on every draft in the run. Typed in by hand. */
  cc?: string;
  bcc?: string;
  /**
   * A first touch, or a reply in the thread that already exists.
   *
   * A follow-up can only go to somebody already emailed on this deal — there
   * is nothing to reply to otherwise — and it IGNORES the grouping choice.
   * The threads already exist and they decide: everybody who received one
   * email gets one reply, whether that email went to them alone or to five of
   * them together. Re-grouping people who are already in conversations would
   * either split a thread or merge two.
   */
  kind?: "first" | "follow";
  /**
   * People who share ONE email, instead of getting one each.
   *
   * A list of lists: each inner list becomes a single email with all of them
   * on the To line. Anyone selected and not named in a group still gets their
   * own. So "three at Tarnwick together, two at Velmora together, the other five
   * individually" is one run, which is how a partner actually works a firm.
   *
   * The trade is real and is stated on the page rather than buried here: a
   * grouped email cannot be personalised, because there is no single person to
   * personalise it to. Every {First name} in it falls back to the neutral
   * wording, which is exactly what those fallbacks exist for.
   */
  groups?: string[][];
}): Promise<DraftOutcome> {
  const user = await requireUser();

  if (!mailboxes().includes(input.mailbox))
    return { ok: false, message: "That is not one of the Halden Ridge mailboxes.", drafted: 0 };
  /* A follow-up has no subject of its own: Microsoft writes "RE: …" from the
     thread it is replying to, and a second subject line would either be
     ignored or break the thread. */
  if (input.kind !== "follow" && !input.subject.trim())
    return { ok: false, message: "The subject line is empty.", drafted: 0 };
  if (!input.body.trim())
    return { ok: false, message: "The email is empty.", drafted: 0 };
  if (!input.contactIds.length)
    return { ok: false, message: "Nobody is selected.", drafted: 0 };
  if (input.contactIds.length > MAX_PER_RUN)
    return { ok: false, message: `That is more than ${MAX_PER_RUN} people in one go. Do it in batches.`, drafted: 0 };

  /* Checked HERE, before a single draft exists. A bad address rejected by
     Microsoft halfway through a run leaves half the emails written and half
     not, and the person then has to work out which. */
  const cc = readAddresses(input.cc ?? "");
  const bcc = readAddresses(input.bcc ?? "");
  const wrong = [...cc.bad, ...bcc.bad];
  if (wrong.length)
    return { ok: false, drafted: 0,
      message: `${wrong.length === 1 ? "This is not an email address" : "These are not email addresses"}: ${wrong.join(", ")}` };

  const deal = await one<{ id: string; title: string; sector: string }>(
    `select id, title, coalesce(sector,'') sector from deals where reference = $1`, [input.dealRef]);
  if (!deal) return { ok: false, message: "That deal no longer exists.", drafted: 0 };

  /* Read the people from the database rather than trusting what the page sent.
     The page sends ids; the names and addresses that actually go in the email
     come from here. A stale tab must not be able to email a person the CRM has
     since set aside, so the scope test is applied again. */
  const people = await query<Recipient>(
    `select c.hr_id, c.full_name, c.job_title, c.best_email, c.email, a.name as company
     from contacts c left join accounts a on a.hr_id = c.account_id
     where c.hr_id = any($1::text[])
       and c.best_email_status is distinct from 'invalid'`,
    [input.contactIds]);
  if (!people.length)
    return { ok: false, message: "None of those people can be emailed.", drafted: 0 };

  /* Every attachment is read ONCE and reused for all of them. A 20MB deck going
     to forty people is one download, not forty. */
  const docs = (await dealDocuments(input.dealRef))
    .filter((d) => input.documentIds.includes(d.id));
  let attachments: DraftAttachment[] = [];
  try {
    attachments = await Promise.all(docs.map(async (d) => ({
      name: d.name,
      contentType: d.contentType || "application/octet-stream",
      bytes: new Uint8Array(await download(d.path)),
    })));
  } catch (e) {
    console.error("could not read a deal document", e);
    return {
      ok: false, drafted: 0,
      message: "The attachment could not be read, so nothing was drafted.",
    };
  }

  /* The teaser goes FIRST in the list, so it is the first attachment an
     investor sees on the email. Rendered once here and reused for the whole
     run, the same as the documents. A teaser that was asked for and cannot be
     produced STOPS the run: the alternative is a first-touch email that
     silently goes out with nothing attached at all, which is the exact failure
     this feature exists to prevent. */
  if (input.teaser) {
    try {
      const made = await teaserPdf(input.dealRef);
      if (!made) return { ok: false, drafted: 0, message: "This deal has no teaser yet, so nothing was drafted. Draft it from the deal page first." };
      attachments = [{ name: made.filename, contentType: "application/pdf", bytes: made.bytes }, ...attachments];
    } catch (e) {
      console.error("could not render the teaser", input.dealRef, e);
      return { ok: false, drafted: 0, message: "The teaser could not be produced, so nothing was drafted." };
    }
  }

  const ctx = { deal: deal.title, sector: deal.sector, sender: senderName(input.mailbox) };
  const subjectFor = (p: Recipient) => fillFor(input.subject, personOf(p), ctx);
  const bodyFor = (p: Recipient) => fillFor(input.body, personOf(p), ctx);
  const addressOf = (p: Recipient) => p.best_email || p.email;

  /* ── Following up ────────────────────────────────────────────────────────
     One reply per THREAD, not per person and not per group. */
  if (input.kind === "follow") {
    const threads = await query<{ contact_id: string; conversation_id: string | null }>(
      `select dc.contact_id, dd.conversation_id
       from deal_contacts dc
       join deals d on d.id = dc.deal_id
       left join lateral (
         select x.conversation_id from deal_drafts x
         where x.deal_id = d.id and x.contact_id = dc.contact_id
           and x.conversation_id is not null
         order by x.created_at desc limit 1) dd on true
       where d.reference = $1 and dc.sent_at is not null
         and dc.contact_id = any($2::text[])`,
      [input.dealRef, input.contactIds]);

    const byId = new Map(people.map((p) => [p.hr_id, p]));
    const groups = new Map<string, Recipient[]>();
    const stranded: string[] = [];
    for (const t of threads) {
      const p = byId.get(t.contact_id);
      if (!p) continue;
      /* Emailed, but we never recorded the thread — sent by hand, or from
         before this was built. Named rather than silently dropped: "it went to
         eleven of the twelve" is the kind of thing nobody notices. */
      if (!t.conversation_id) { stranded.push(p.full_name || p.email); continue; }
      const list = groups.get(t.conversation_id) ?? [];
      list.push(p);
      groups.set(t.conversation_id, list);
    }

    if (!groups.size)
      return { ok: false, drafted: 0,
        message: stranded.length
          ? `Nobody selected has a thread to reply to. ${stranded.length} ${stranded.length === 1 ? "was" : "were"} emailed but the conversation was not recorded, so there is nothing to reply into.`
          : "A follow-up can only go to somebody already emailed on this deal, and nobody selected has been." };

    let replied = 0;
    for (const [conversationId, members] of groups) {
      const blank: Recipient = { hr_id: "", full_name: "", job_title: "", best_email: "", email: "", company: "" };
      /* One person in the thread can still be greeted by name; two cannot. */
      const voice = members.length === 1 ? members[0] : blank;
      try {
        const made = await createReplyDraft({
          mailbox: input.mailbox, conversationId,
          to: members.map(addressOf), cc: cc.ok, bcc: bcc.ok,
          body: bodyFor(voice), attachments,
        });
        for (const p of members) {
          await recordDraft({
            dealRef: input.dealRef, contactId: p.hr_id, mailbox: input.mailbox,
            graphId: made.id, conversationId: made.conversationId,
            subject: `Re: ${deal.title}`, template: input.template, user: user.email,
          });
        }
        replied++;
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        console.error("follow-up failed", conversationId, why);
        revalidatePath(`/deals/${input.dealRef}`);
        return { ok: false, drafted: replied,
          failedOn: members.map((m) => m.full_name || m.email).join(", "),
          message: replied
            ? `${replied} follow-ups drafted, then it stopped: ${why}`
            : e instanceof ThreadGone ? why : `Nothing was drafted — ${why}` };
      }
    }

    revalidatePath(`/deals/${input.dealRef}`);
    revalidatePath("/outreach");
    const people_n = [...groups.values()].reduce((n, m) => n + m.length, 0);
    return { ok: true, drafted: replied,
      message: `${replied} ${replied === 1 ? "follow-up is" : "follow-ups are"} waiting in ${input.mailbox}'s Drafts folder, `
        + `replying to ${people_n} ${people_n === 1 ? "person" : "people"} in their existing threads.`
        + (stranded.length ? ` ${stranded.join(", ")} had no recorded thread and ${stranded.length === 1 ? "was" : "were"} left out.` : "") };
  }

  /* ── Who shares an email with whom ───────────────────────────────────────
     One list per email. A person named in a group is in that email; everybody
     else selected gets their own. Ids are resolved against the people actually
     read from the database, so a stale tab cannot group somebody who has since
     been set aside — and an id claimed by two groups counts once, in the
     first, rather than being drafted twice. */
  const byId = new Map(people.map((p) => [p.hr_id, p]));
  const spokenFor = new Set<string>();
  const emails: Recipient[][] = [];
  for (const g of input.groups ?? []) {
    const members = g
      .filter((id) => byId.has(id) && !spokenFor.has(id))
      .map((id) => { spokenFor.add(id); return byId.get(id)!; });
    if (members.length) emails.push(members);
  }
  for (const p of people) if (!spokenFor.has(p.hr_id)) emails.push([p]);

  const blank: Recipient = { hr_id: "", full_name: "", job_title: "", best_email: "", email: "", company: "" };
  let drafted = 0;
  let peopleReached = 0;

  for (const members of emails) {
    /* One person can be greeted by name; several cannot, so the tokens fall
       back to their neutral wording rather than picking one of them. */
    const voice = members.length === 1 ? members[0] : blank;
    const subject = subjectFor(voice);
    const naming = members.map((m) => m.full_name || addressOf(m)).join(", ");
    try {
      const made = await createDraft({
        mailbox: input.mailbox,
        to: members.map(addressOf), cc: cc.ok, bcc: bcc.ok,
        subject, body: bodyFor(voice), attachments,
      });
      for (const p of members) {
        await recordDraft({
          dealRef: input.dealRef, contactId: p.hr_id, mailbox: input.mailbox,
          graphId: made.id, conversationId: made.conversationId,
          subject, template: input.template, user: user.email,
        });
        await markDrafted(input.dealRef, p.hr_id, input.mailbox);
      }
      drafted++;
      peopleReached += members.length;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      console.error("draft failed", naming, why);
      revalidatePath(`/deals/${input.dealRef}`);
      return {
        ok: false, drafted, failedOn: naming,
        message: drafted
          ? `${drafted} drafted, then it stopped at ${naming}: ${why}`
          : `Nothing was drafted — ${why}`,
      };
    }
  }

  revalidatePath(`/deals/${input.dealRef}`);
  revalidatePath("/outreach");
  const grouped = emails.filter((e) => e.length > 1).length;
  return {
    ok: true, drafted,
    message: `${drafted} ${drafted === 1 ? "email is" : "emails are"} waiting in ${input.mailbox}'s Drafts folder`
      + (grouped
        ? `, reaching ${peopleReached} people — ${grouped} of them shared.`
        : "."),
  };
}

interface Recipient {
  hr_id: string; full_name: string | null; job_title: string | null;
  best_email: string | null; email: string; company: string | null;
}

const personOf = (p: Recipient) => ({
  firstName: "",
  fullName: p.full_name ?? "",
  company: p.company ?? "",
  jobTitle: p.job_title ?? "",
});

/* The deal's own record of the person moves to "drafted". Guarded with
   `is null` so re-running never rewrites a date that already exists. */
async function markDrafted(dealRef: string, contactId: string, mailbox: string): Promise<void> {
  await query(
    `update deal_contacts set drafted_at = now(), sender = coalesce(sender, $3)
     from deals d
     where d.reference = $1 and deal_contacts.deal_id = d.id
       and deal_contacts.contact_id = $2 and deal_contacts.drafted_at is null`,
    [dealRef, contactId, mailbox]);
}

/** "alan@halden-ridge.example" reads badly at the end of an email. */
function senderName(mailbox: string): string {
  const known: Record<string, string> = {
    "alan@halden-ridge.example": "Alan",
    "grace@halden-ridge.example": "Grace",
    "peter@halden-ridge.example": "Peter",
    "ruth@halden-ridge.example": "Ruth",
  };
  return known[mailbox] ?? mailbox.split("@")[0];
}
