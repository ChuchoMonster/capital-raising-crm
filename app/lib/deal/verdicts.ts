import "server-only";
import { query, one } from "../db";
import { fetchReplyText } from "../graph";
import { shingles, supported } from "./draft";

/**
 * Did the firm say yes or no?
 *
 * A partner emails an investor about a raise. The investor writes back — often
 * to just one of the four partners, sometimes from a different address, often
 * in a brand-new email rather than a reply. Today that answer lives in one
 * person's inbox, and the next morning somebody emails their colleague
 * (Ruth's complaint, via John, 2026-08-31).
 *
 * THREE ANSWERS, AND MOST REPLIES ARE THE THIRD. Accepted, Passed, and Open —
 * because "out of office", "who is this" and "send me more" are all replies and
 * none of them is a decision. A reader forced to choose between yes and no will
 * invent one; giving it somewhere to put "neither" is what keeps the other two
 * meaningful.
 *
 * IT FLAGS, IT NEVER BLOCKS (client's call, and it is what makes this safe to
 * build at all). A wrong "Passed" would otherwise remove a firm from a raise
 * with nobody ever noticing. Flagged, it sits on the outreach row next to the
 * sentence it was read from, and anyone who disagrees clears it in a click.
 *
 * THE BODY IS NEVER STORED. Only the one sentence that carried the verdict.
 * This is a CRM, not a mail archive.
 */

const MODEL = "claude-opus-5";

export type Verdict = "Accepted" | "Passed";

export interface DealVerdict {
  accountId: string;
  verdict: Verdict;
  decidedAt: string;
  source: "email" | "manual";
  evidence: string;
  contactId: string | null;
  recordedBy: string;
}

/** Every firm verdict on one raise, keyed by account. */
export async function verdictsFor(dealRef: string): Promise<Map<string, DealVerdict>> {
  const rows = await query<{
    account_id: string; verdict: Verdict; decided_at: Date; source: "email" | "manual";
    evidence: string | null; contact_id: string | null; recorded_by: string;
  }>(
    `select v.account_id, v.verdict, v.decided_at, v.source, v.evidence, v.contact_id, v.recorded_by
     from deal_verdicts v join deals d on d.id = v.deal_id
     where d.reference = $1`, [dealRef]);
  return new Map(rows.map((r) => [r.account_id, {
    accountId: r.account_id,
    verdict: r.verdict,
    decidedAt: new Date(r.decided_at).toISOString(),
    source: r.source,
    evidence: r.evidence ?? "",
    contactId: r.contact_id,
    recordedBy: r.recorded_by,
  }]));
}

/** Record one, by hand or from a reply. Latest wins — a firm may change its mind. */
export async function putVerdict(input: {
  dealRef: string; accountId: string; verdict: Verdict;
  source: "email" | "manual"; evidence: string; recordedBy: string;
  contactId?: string | null; messageId?: string | null;
}): Promise<boolean> {
  const deal = await one<{ id: string }>(`select id from deals where reference = $1`, [input.dealRef]);
  if (!deal) return false;
  await query(
    `insert into deal_verdicts
       (deal_id, account_id, verdict, source, evidence, contact_id, message_id, recorded_by, decided_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now())
     on conflict (deal_id, account_id) do update set
       verdict = excluded.verdict, source = excluded.source, evidence = excluded.evidence,
       contact_id = excluded.contact_id, message_id = excluded.message_id,
       recorded_by = excluded.recorded_by, decided_at = now()`,
    [deal.id, input.accountId, input.verdict, input.source, input.evidence || null,
     input.contactId ?? null, input.messageId ?? null, input.recordedBy]);
  return true;
}

/** Undo. Back to Open, which is the absence of a row rather than a value. */
export async function clearVerdict(dealRef: string, accountId: string): Promise<void> {
  await query(
    `delete from deal_verdicts v using deals d
     where d.id = v.deal_id and d.reference = $1 and v.account_id = $2`,
    [dealRef, accountId]);
}

/* ── reading the replies ─────────────────────────────────────────────────── */

interface Candidate {
  messageId: string;
  contactId: string;
  accountId: string;
  mailbox: string;
  conversationId: string;
  subject: string;
  /** The live raises this firm could plausibly be answering about. */
  deals: { id: string; ref: string; title: string; company: string }[];
  /** The deal whose thread this message is in, when it is in one. */
  threadDealId: string | null;
}

/**
 * Which inbound messages are worth reading.
 *
 * THE FIRM, NOT THE PERSON. The analyst forwards it to the partner and the
 * partner answers from their own address, so any reply from anyone at the firm
 * is a candidate.
 *
 * ⚠️ BUT ONLY AFTER WE ACTUALLY PITCHED THEM, AND ONLY REPLIES THAT CAME LATER.
 * The first version asked only "is this firm on a live deal", and the live data
 * showed immediately why that is not enough: eight of twenty-one candidates were
 * Quillmark Management discussing "Project Saltire" — a raise Halden Ridge is running
 * OUTSIDE the CRM — and an NDA request about Saltire would have been recorded
 * as an acceptance on whichever deal Quillmark happens to be attached to here.
 * Halden Ridge run deals this system has never heard of, and their mail does not
 * announce which one it is about.
 *
 * So a message only qualifies if somebody at that firm was SENT an email on a
 * live raise and this arrived afterwards. That is the difference between "a
 * reply to us" and "their mail".
 *
 * The line NOT crossed either way: every reply from any firm Halden Ridge has ever
 * emailed — hundreds a fortnight of ordinary business mail, and exactly
 * where a wrong "Passed" would come from.
 */
async function candidates(limit: number): Promise<Candidate[]> {
  return query<Candidate>(
    `with pitched as (
       /* Firms we have actually emailed about a live raise, and when. */
       select c.account_id, d.id, d.reference as ref, d.title,
              coalesce(a.name, d.title) as company,
              min(dc.sent_at) as first_sent
       from deal_contacts dc
       join deals d on d.id = dc.deal_id
       join contacts c on c.hr_id = dc.contact_id
       left join accounts a on a.hr_id = d.company_id
       where d.status = 'Live'
         and dc.sent_at is not null
         and c.account_id is not null
       group by c.account_id, d.id, d.reference, d.title, a.name
     )
     select e.message_id as "messageId", e.contact_id as "contactId",
            c.account_id as "accountId", e.mailbox,
            coalesce(e.conversation_id,'') as "conversationId",
            coalesce(e.subject,'') as subject,
            (select json_agg(json_build_object('id', p.id, 'ref', p.ref, 'title', p.title, 'company', p.company))
             from pitched p
             where p.account_id = c.account_id and e.occurred_at > p.first_sent) as deals,
            (select dd.deal_id from deal_drafts dd
             where dd.conversation_id = e.conversation_id limit 1) as "threadDealId"
       from mail_events e
       join contacts c on c.hr_id = e.contact_id
      where e.direction = 'in'
        and e.read_at is null
        and c.account_id is not null
        /* Pitched on a live raise, and this came after the pitch. */
        and exists (select 1 from pitched p
                    where p.account_id = c.account_id and e.occurred_at > p.first_sent)
      order by e.occurred_at
      limit $1`, [limit]);
}

const SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["Accepted", "Passed", "Open"],
      description: "Accepted = they want the materials or a meeting. Passed = they are declining THIS opportunity. Open = anything else, including out-of-office, a question, a request for more information, or a promise to look later.",
    },
    company: {
      type: "string",
      description: "The company or deal this message is about, ONLY if the message names it. Empty string otherwise. Never infer it.",
    },
    quote: {
      type: "string",
      description: "The verbatim sentence from the message that carries the verdict. Copy it exactly. Empty when the verdict is Open.",
    },
    reason: {
      type: "string",
      description: "For a Pass only: a few words on why, in their terms — 'too early stage', 'not our commodity', 'cheque too small'. Empty if they did not say.",
    },
  },
  required: ["verdict", "company", "quote", "reason"],
  additionalProperties: false,
} as const;

const SYSTEM = `You read one reply an investor has sent to a placement agent who pitched them a capital raise, and decide what it means.

You are shown ONLY what this person newly wrote — the quoted thread beneath it has been removed. Judge that text and nothing else.

Rules:
1. "Accepted" means they want to go further: send the deck, send the materials, set up a call, they are interested. It does NOT mean politeness — "thanks for thinking of us" is not acceptance.
2. "Passed" means they are declining THIS opportunity. Someone who says the deal is too early, too small, the wrong commodity, or outside their mandate has passed. Someone who says "not right now, come back after Q1" has NOT passed — that is Open.
3. "Open" is the right answer most of the time. Out of office, a question, a request for more information, a forward to a colleague, an acknowledgement, or anything you are unsure about is Open.
4. A reply that declines one thing and asks about another — "we'll pass on the equity but would look at the debt" — is Open, not Passed. They are still in the conversation.
5. Fill "quote" with the exact sentence from the message that made you decide. If you cannot quote one, the answer is Open.
6. Fill "company" only if the message actually names the company or deal. If it does not, leave it empty. Never guess which raise this is about.`;

async function classify(text: string, subject: string, key: string): Promise<Record<string, unknown> | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1000, fallbacks: "default", system: SYSTEM,
      tools: [{ name: "verdict", description: "Return what this reply means.", input_schema: SCHEMA }],
      tool_choice: { type: "tool", name: "verdict" },
      messages: [{ role: "user", content: `Subject: ${subject}\n\n--- what they wrote ---\n${text}` }],
    }),
  });
  if (!res.ok) return null;
  const payload = await res.json();
  const block = (payload.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  return block ? (block.input as Record<string, unknown>) : null;
}

/** Loose name match — "Morvane Minerals Inc" against "morvane". */
function namesDeal(said: string, deal: { title: string; company: string }): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = norm(said);
  if (a.length < 4) return false;
  return [deal.title, deal.company].some((n) => {
    const b = norm(n);
    return b.length >= 4 && (b.includes(a) || a.includes(b));
  });
}

export interface ReadResult {
  looked: number;
  accepted: number;
  passed: number;
  open: number;
  unattributed: number;
  message: string;
}

/**
 * Read the replies nobody has read yet.
 *
 * Every message is marked read whether or not it produced a verdict — the words
 * will not change, and paying to read the same "out of office" every hour is
 * the kind of waste that only shows up on a bill.
 */
export async function readReplies(limit = 40): Promise<ReadResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  const out: ReadResult = { looked: 0, accepted: 0, passed: 0, open: 0, unattributed: 0, message: "" };
  if (!key) return { ...out, message: "ANTHROPIC_API_KEY is not set." };

  const list = await candidates(limit);
  if (!list.length) return { ...out, message: "No replies waiting to be read." };

  for (const c of list) {
    out.looked++;
    /* Marked read FIRST. A message that makes the model fall over would
       otherwise be retried every hour forever. */
    await query(`update mail_events set read_at = now() where message_id = $1 and contact_id = $2 and direction = 'in'`,
      [c.messageId, c.contactId]);

    let said;
    try {
      const body = await fetchReplyText(c.mailbox, c.messageId);
      if (!body) { out.open++; continue; }
      said = await classify(body.text, body.subject || c.subject, key);
      if (!said) { out.open++; continue; }

      const verdict = String(said.verdict ?? "Open");
      if (verdict !== "Accepted" && verdict !== "Passed") { out.open++; continue; }

      /* THE GUARD. The sentence has to be in what they wrote. Without this the
         model's impression of the message becomes the record, and an impression
         that a firm declined reads exactly like a firm declining. */
      const quote = String(said.quote ?? "");
      if (!supported(quote, shingles(body.text), body.text)) { out.open++; continue; }

      /* WHICH RAISE. In a thread we sent, it is known outright. Otherwise the
         message has to name the company, or there has to be exactly one raise
         we have pitched this firm on — and `candidates` has already established
         that we did pitch them and that this arrived afterwards, which is what
         makes that last fallback something other than a guess. Anything else is
         left alone: a pass recorded against the wrong raise is worse than none. */
      const deals = c.deals ?? [];
      const named = String(said.company ?? "").trim();
      const target =
        (c.threadDealId && deals.find((d) => d.id === c.threadDealId))
        ?? (named ? deals.find((d) => namesDeal(named, d)) : undefined)
        ?? (deals.length === 1 ? deals[0] : undefined);
      if (!target) { out.unattributed++; continue; }

      const reason = String(said.reason ?? "").trim();
      await putVerdict({
        dealRef: target.ref, accountId: c.accountId, verdict,
        source: "email",
        evidence: reason && verdict === "Passed" ? `${quote} (${reason})` : quote,
        recordedBy: "read from their reply",
        contactId: c.contactId, messageId: c.messageId,
      });
      if (verdict === "Accepted") out.accepted++; else out.passed++;
    } catch (e) {
      console.error("could not read a reply", c.messageId, e);
      out.open++;
    }
  }

  const bits = [`${out.looked} read`];
  if (out.accepted) bits.push(`${out.accepted} accepted`);
  if (out.passed) bits.push(`${out.passed} passed`);
  if (out.unattributed) bits.push(`${out.unattributed} could not be tied to a raise`);
  return { ...out, message: bits.join(", ") };
}
