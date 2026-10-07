import "server-only";
import { query } from "./db";
import { fetchSent, fetchReceived, mailboxes } from "./graph";

/**
 * What the partners' mailboxes say about who has been contacted.
 *
 * Runs on a schedule with nobody watching, which sets the standard for every
 * decision below: this job may only write things it can prove from a message.
 * Where it cannot tell which deal a message belongs to it writes nothing and
 * leaves a note for a person, because a reply filed against the wrong deal is
 * indistinguishable from a correct one once it is on the screen.
 *
 * Three properties hold it together:
 *
 *  - IT MAY REPEAT ITSELF. Every window overlaps the last, and every write is
 *    either an insert that conflicts away or an update guarded by `is null`.
 *    Running twice changes nothing that running once did not.
 *  - THE WATERMARK IS THE MESSAGE'S OWN TIME, NOT THE CLOCK. A failed run
 *    leaves it where it was, so the next run covers the gap. Nothing is lost
 *    by a container dying halfway.
 *  - THE SENDER COMES FROM THE MAILBOX, NOT THE MESSAGE. Three of the four
 *    partners' sent mail carries an Exchange directory path in its From field
 *    instead of an address. The mailbox being read is who sent it.
 */

/** How far back a mailbox with no watermark reads on its first run. */
const FIRST_RUN_DAYS = 7;

/** Every window reaches back this far past the last one. See "may repeat". */
const OVERLAP_MINUTES = 10;

/**
 * The two directions, and what each reads.
 *
 * "sent" is the Sent Items folder. "received" is the WHOLE mailbox minus sent,
 * drafts and junk — not the Inbox, because most received mail has been filed
 * out of the Inbox by the time we look. See fetchReceived for the measurement.
 */
const PASSES = ["sent", "received"] as const;
type Pass = (typeof PASSES)[number];

/** Halden Ridge's own domains — mail between colleagues is not outreach. */
/* An Exchange directory path, a mangled header and a bare word are all "not an
   address"; only a plain one is worth queueing for research. */
const PLAIN_ADDRESS = /^[^\s@"'<>,;]+@[^\s@"'<>,;]+\.[a-z]{2,}$/i;
const INTERNAL = /@halden-ridge\.example$/i;

export interface SyncResult {
  ok: boolean;
  ranFor: string;
  folders: {
    mailbox: string; folder: string;
    messages: number; matched: number; error?: string;
  }[];
  events: number;
  sent: number;
  replied: number;
  unmatched: number;
  unknownAddresses: number;
  /** People we had never seen, now queued for the weekly enrichment run. */
  queued: number;
}

export async function syncMailboxes(opts: { max?: number } = {}): Promise<SyncResult> {
  const started = Date.now();
  const result: SyncResult = {
    ok: true, ranFor: "", folders: [],
    events: 0, sent: 0, replied: 0, unmatched: 0, unknownAddresses: 0, queued: 0,
  };

  for (const mailbox of mailboxes()) {
    for (const folder of PASSES) {
      try {
        const one = await syncFolder(mailbox, folder, opts);
        result.folders.push({ mailbox, folder, ...one.counts });
        result.events += one.events;
        result.sent += one.sent;
        result.replied += one.replied;
        result.unmatched += one.unmatched;
        result.unknownAddresses += one.unknown;
        result.queued += one.queued;
      } catch (err) {
        /* One mailbox failing must not stop the other three. The watermark for
           this folder is left untouched, so the next run retries the same
           window rather than skipping it. */
        const message = err instanceof Error ? err.message : String(err);
        result.ok = false;
        result.folders.push({ mailbox, folder, messages: 0, matched: 0, error: message });
        await query(
          `update mail_sync_state set last_run_at = now(), last_error = $3
           where mailbox = $1 and folder = $2`, [mailbox, folder, message.slice(0, 500)]);
      }
    }
  }

  result.ranFor = `${((Date.now() - started) / 1000).toFixed(1)}s`;
  return result;
}

async function syncFolder(mailbox: string, folder: Pass, opts: { max?: number }) {
  const state = await query<{ last_seen: Date | null }>(
    `insert into mail_sync_state (mailbox, folder) values ($1, $2)
     on conflict (mailbox, folder) do update set mailbox = excluded.mailbox
     returning last_seen`, [mailbox, folder]);

  const lastSeen = state[0]?.last_seen ?? null;
  const since = lastSeen
    ? new Date(lastSeen.getTime() - OVERLAP_MINUTES * 60_000)
    : new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000);

  const all = folder === "sent"
    ? await fetchSent(mailbox, since, opts)
    : await fetchReceived(mailbox, since, opts);
  /* The CRM's own system mail leaves a partner's mailbox like anything else —
     an access approval, a password link. It is not outreach, and left in it
     would be filed as the pitch for anyone who is both a CRM contact and
     awaiting contact on exactly one deal. The watermark still moves past
     these — see the watermark below — so dropping them costs nothing. */
  const messages = all.filter((m) => !m.system);
  const direction = folder === "sent" ? "out" : "in";

  /* Everyone this batch touches, looked up in one query rather than one per
     message. `contact_emails` holds every address a person owns, not just the
     one on their row — a reply from somebody's second address is still theirs. */
  const addresses = new Set<string>();
  for (const m of messages) {
    for (const a of direction === "out" ? m.recipients : [m.from].filter((x): x is string => !!x)) {
      if (!INTERNAL.test(a)) addresses.add(a);
    }
  }

  const known = new Map<string, string>();
  if (addresses.size) {
    const rows = await query<{ email: string; contact_id: string }>(
      `select email, contact_id from contact_emails where email = any($1::text[])`,
      [[...addresses]]);
    for (const r of rows) known.set(r.email, r.contact_id);
  }

  /* One row per (message, person, direction). Written before anything is
     attributed to a deal, because the ledger is true regardless of whether a
     deal can be worked out — and a message this job declines to attribute is
     still a message that happened. */
  const events: {
    messageId: string; contactId: string; mailbox: string;
    when: string; conversationId: string; subject: string;
  }[] = [];
  let unknown = 0;

  /* The watermark comes from EVERY message read, including the system mail
     dropped above. Taking it from the filtered list would leave the watermark
     where it was on any window whose only traffic was an access email, and the
     next run would read the same window again for ever. */
  let newest: Date | null = lastSeen;
  for (const m of all) {
    const when = new Date(m.when);
    if (!newest || when > newest) newest = when;
  }

  /* Everyone in this window we have never seen. Kept, not counted and dropped:
     these are the people Halden Ridge has started talking to since the last research
     run, and they are what the weekly enrichment exists to pick up. Before
     2026-08-26 they were discarded every five minutes, so a scheduled run
     would have found an empty queue. */
  const arrivals = new Map<string, {
    name: string; inbound: number; outbound: number; when: string;
  }>();
  /* Reported back with everything else. A count that only ever appeared in a
     log is how the broken version of this looked exactly like a quiet week. */
  let queued = 0;

  for (const m of messages) {
    const people = direction === "out" ? m.recipients : [m.from].filter((x): x is string => !!x);
    for (const a of people) {
      if (INTERNAL.test(a)) continue;
      const contactId = known.get(a);
      if (!contactId) {
        unknown++;
        /* Not a person: a role box is still recorded, because the DOMAIN behind
           it proves a company is real even when nobody there can be emailed.
           What is refused is anything that is not an address at all. */
        if (!PLAIN_ADDRESS.test(a)) continue;
        const prev = arrivals.get(a) ?? { name: "", inbound: 0, outbound: 0, when: m.when };
        prev[direction === "out" ? "outbound" : "inbound"]++;
        if (!prev.name && m.names?.[a]) prev.name = m.names[a];
        if (m.when > prev.when) prev.when = m.when;
        arrivals.set(a, prev);
        continue;
      }
      events.push({
        messageId: m.internetMessageId, contactId, mailbox,
        when: m.when, conversationId: m.conversationId, subject: m.subject.slice(0, 500),
      });
    }
  }

  /* Written before the events, and with its own try/catch, because a person we
     have never seen is worth keeping even if attributing this batch to a deal
     goes wrong. `greatest`/`+` rather than assignment so an overlapping window
     does not reset a count, and the mailbox list is a union — two partners
     writing to the same person is one relationship known to both. */
  if (arrivals.size) {
    try {
      const list = [...arrivals.entries()];
      /* The mailbox is a SCALAR here, not one array per row. `unnest` flattens
         a two-dimensional array into plain values, so passing text[][] put a
         bare string into an array column and the whole statement failed — into
         a catch block, where it was invisible. Every arrival in one call comes
         from the same mailbox anyway, so the array is built in SQL. */
      const written = await query<{ email: string }>(
        `insert into new_arrivals
           (email, display_name, domain, mailboxes, inbound, outbound, first_seen, last_seen)
         select e, n, d, array[$4::text], i, o, w, w
         from unnest($1::text[], $2::text[], $3::text[], $5::int[], $6::int[], $7::timestamptz[])
           as t(e, n, d, i, o, w)
         on conflict (email) do update set
           display_name = coalesce(nullif(new_arrivals.display_name, ''), excluded.display_name),
           mailboxes    = (select array_agg(distinct x) from unnest(
                             new_arrivals.mailboxes || excluded.mailboxes) x),
           inbound      = new_arrivals.inbound  + excluded.inbound,
           outbound     = new_arrivals.outbound + excluded.outbound,
           last_seen    = greatest(new_arrivals.last_seen, excluded.last_seen)
         returning email`,
        [
          list.map(([a]) => a),
          list.map(([, v]) => v.name || null),
          list.map(([a]) => a.split("@")[1] ?? null),
          mailbox,
          list.map(([, v]) => v.inbound),
          list.map(([, v]) => v.outbound),
          list.map(([, v]) => v.when),
        ]);
      queued = written.length;
    } catch (err) {
      /* Never fail the sync over the queue. A missed arrival is picked up the
         next time that person writes; a failed sync loses the watermark. */
      console.error("new_arrivals:", err instanceof Error ? err.message : String(err));
    }
  }

  let written = 0;
  if (events.length) {
    /* One statement for the whole batch. `do nothing` is what makes an
       overlapping window free — the same message seen twice is a no-op. */
    const rows = await query<{ contact_id: string }>(
      `insert into mail_events
         (message_id, contact_id, direction, mailbox, occurred_at, conversation_id, subject)
       select * from unnest(
         $1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::text[], $7::text[])
       on conflict do nothing
       returning contact_id`,
      [
        events.map((e) => e.messageId),
        events.map((e) => e.contactId),
        events.map(() => direction),
        events.map((e) => e.mailbox),
        events.map((e) => e.when),
        events.map((e) => e.conversationId || null),
        events.map((e) => e.subject),
      ]);
    written = rows.length;
  }

  const deal = events.length
    ? direction === "out"
      ? await attributeSends(events)
      : await attributeReplies(events)
    : { sent: 0, replied: 0, unmatched: 0 };

  /* The watermark moves only after everything above succeeded. */
  if (newest) {
    await query(
      `update mail_sync_state
       set last_seen = $3, last_run_at = now(), last_ok_at = now(), last_error = null
       where mailbox = $1 and folder = $2`, [mailbox, folder, newest.toISOString()]);
  } else {
    await query(
      `update mail_sync_state set last_run_at = now(), last_ok_at = now(), last_error = null
       where mailbox = $1 and folder = $2`, [mailbox, folder]);
  }

  return {
    counts: { messages: messages.length, matched: events.length },
    events: written, unknown, queued,
    sent: deal.sent, replied: deal.replied, unmatched: deal.unmatched,
  };
}

type Event = { messageId: string; contactId: string; mailbox: string; when: string; conversationId: string; subject: string };

/**
 * A partner emailed somebody. Which deal was that?
 *
 * The message does not say, so the only safe answer is the one where there is
 * nothing to choose between: the person is waiting to be contacted on exactly
 * one deal. On two, this job records the question rather than picking, because
 * an outreach logged against the wrong deal reads exactly like a correct one
 * and quietly stops anyone pitching them properly.
 *
 * The thread is recorded on the way past. That is what lets the reply, when it
 * comes, be attributed without any guessing at all.
 */
async function attributeSends(events: Event[]) {
  const ids = [...new Set(events.map((e) => e.contactId))];

  /* FIRST, THE ONES WE WROTE OURSELVES.
     A draft the CRM put in the mailbox already knows its deal, and Microsoft
     keeps the conversation id when that draft is edited and sent. So a match
     here is not an inference at all — it is the same message. This is the only
     route that can attribute a send to somebody sitting on several live deals,
     which is exactly the case the rest of this function refuses to guess at. */
  const known = await matchOwnDrafts(events);

  const remaining = events.filter((e) => !known.done.has(`${e.contactId}:${e.conversationId}`));
  if (!remaining.length) return { sent: known.sent, replied: 0, unmatched: 0 };

  const open = await query<{ contact_id: string; deal_id: string }>(
    `select contact_id, deal_id from deal_contacts
     where contact_id = any($1::text[]) and sent_at is null`, [ids]);
  if (!open.length) return { sent: known.sent, replied: 0, unmatched: 0 };

  const byContact = new Map<string, string[]>();
  for (const r of open) {
    byContact.set(r.contact_id, [...(byContact.get(r.contact_id) ?? []), r.deal_id]);
  }

  let sent = 0, unmatched = 0;
  /* Oldest first, so if somebody was emailed twice in one window the recorded
     send is the one that actually went first. */
  for (const e of [...remaining].sort((a, b) => a.when.localeCompare(b.when))) {
    const deals = byContact.get(e.contactId);
    if (!deals?.length) continue;

    if (deals.length > 1) {
      unmatched += await noteUnmatched(e, "out",
        `awaiting contact on ${deals.length} deals — not attributed`);
      continue;
    }

    const done = await query(
      `update deal_contacts
       set sent_at = $3, drafted_at = coalesce(drafted_at, $3),
           sender = coalesce(sender, $4), conversation_id = coalesce(conversation_id, $5),
           sent_source = 'mailbox'
       where deal_id = $1 and contact_id = $2 and sent_at is null
       returning contact_id`,
      [deals[0], e.contactId, e.when, e.mailbox, e.conversationId || null]);
    if (done.length) { sent++; byContact.delete(e.contactId); }
  }
  return { sent: sent + known.sent, replied: 0, unmatched };
}

/**
 * Messages that started life as a draft this CRM wrote.
 *
 * Matched on Microsoft's conversation id, which is assigned when the draft is
 * created and survives it being edited and sent. Nothing is guessed: the deal
 * was decided by a person before the email existed.
 *
 * `sent_at is null` guards both writes, so a window that overlaps the last one
 * — which every window here does — changes nothing the first pass already did.
 */
async function matchOwnDrafts(events: Event[]) {
  const done = new Set<string>();
  const withThread = events.filter((e) => e.conversationId);
  if (!withThread.length) return { sent: 0, done };

  const rows = await query<{ contact_id: string; conversation_id: string; deal_id: string }>(
    `select contact_id, conversation_id, deal_id from deal_drafts
     where conversation_id = any($1::text[]) and contact_id = any($2::text[])`,
    [[...new Set(withThread.map((e) => e.conversationId))],
     [...new Set(withThread.map((e) => e.contactId))]]);
  if (!rows.length) return { sent: 0, done };

  const byKey = new Map(rows.map((r) => [`${r.contact_id}:${r.conversation_id}`, r.deal_id]));
  let sent = 0;
  for (const e of [...withThread].sort((a, b) => a.when.localeCompare(b.when))) {
    const key = `${e.contactId}:${e.conversationId}`;
    const dealId = byKey.get(key);
    if (!dealId) continue;
    done.add(key);

    const wrote = await query(
      `update deal_contacts
       set sent_at = $3, drafted_at = coalesce(drafted_at, $3),
           sender = coalesce(sender, $4), conversation_id = coalesce(conversation_id, $5),
           sent_source = 'draft'
       where deal_id = $1 and contact_id = $2 and sent_at is null
       returning contact_id`,
      [dealId, e.contactId, e.when, e.mailbox, e.conversationId]);
    if (wrote.length) sent++;

    /* The draft is no longer waiting in somebody's Outlook. */
    await query(
      `update deal_drafts set sent_at = $3
       where deal_id = $1 and contact_id = $2 and conversation_id = $4 and sent_at is null`,
      [dealId, e.contactId, e.when, e.conversationId]);
  }
  return { sent, done };
}

/**
 * Somebody wrote in. Is it a reply, and to what?
 *
 * The thread recorded when the send was seen settles it outright. Failing that,
 * a single outstanding pitch is unambiguous enough to record. Anything else is
 * left for a person.
 *
 * Note what does NOT happen here: an inbound message from someone nobody has
 * pitched marks nothing. A cold approach is not a reply, and counting it as one
 * would make the outreach figures describe something other than outreach.
 */
async function attributeReplies(events: Event[]) {
  const ids = [...new Set(events.map((e) => e.contactId))];
  const open = await query<{ contact_id: string; deal_id: string; conversation_id: string | null }>(
    `select contact_id, deal_id, conversation_id from deal_contacts
     where contact_id = any($1::text[]) and sent_at is not null and replied_at is null`, [ids]);
  if (!open.length) return { sent: 0, replied: 0, unmatched: 0 };

  let replied = 0, unmatched = 0;
  for (const e of [...events].sort((a, b) => a.when.localeCompare(b.when))) {
    const mine = open.filter((r) => r.contact_id === e.contactId);
    if (!mine.length) continue;

    const sameThread = e.conversationId
      ? mine.filter((r) => r.conversation_id === e.conversationId)
      : [];
    const target = sameThread.length === 1 ? sameThread[0]
      : sameThread.length === 0 && mine.length === 1 ? mine[0]
      : null;

    if (!target) {
      unmatched += await noteUnmatched(e, "in",
        sameThread.length > 1
          ? `reply matches ${sameThread.length} threads — not attributed`
          : `outstanding on ${mine.length} deals and the thread does not match — not attributed`);
      continue;
    }

    const done = await query(
      `update deal_contacts
       set replied_at = $3, replied_source = 'mailbox'
       where deal_id = $1 and contact_id = $2 and replied_at is null
       returning contact_id`, [target.deal_id, e.contactId, e.when]);
    if (done.length) {
      replied++;
      const i = open.indexOf(target);
      if (i >= 0) open.splice(i, 1);
    }
  }
  return { sent: 0, replied, unmatched };
}

/**
 * Park something this job will not guess about.
 *
 * ONE ROW PER OPEN QUESTION, not per message. "Which of two deals was this
 * person emailed about" is a single question however many times they are
 * emailed — keyed per message it produced forty-one identical rows for one
 * person on the first test, which is how a review queue becomes something
 * nobody reads. The message and subject are kept as context and updated to
 * whichever prompted it most recently.
 */
async function noteUnmatched(e: Event, direction: "out" | "in", reason: string): Promise<number> {
  const rows = await query<{ inserted: boolean }>(
    `insert into mail_sync_unmatched
       (contact_id, direction, reason, message_id, mailbox, occurred_at, subject)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (contact_id, direction, reason) do update
       set message_id  = excluded.message_id,
           mailbox     = excluded.mailbox,
           occurred_at = greatest(mail_sync_unmatched.occurred_at, excluded.occurred_at),
           subject     = excluded.subject
     returning (xmax = 0) as inserted`,
    [e.contactId, direction, reason, e.messageId, e.mailbox, e.when, e.subject]);
  return rows[0]?.inserted ? 1 : 0;
}
