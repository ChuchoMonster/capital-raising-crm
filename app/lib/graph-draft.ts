import "server-only";
import { graphToken } from "./graph";

/**
 * Putting an email into a partner's Drafts folder.
 *
 * NOT sending it. The CRM writes the message, Microsoft puts it in Outlook, and
 * a person reads it and presses Send. That distinction is the whole design:
 * these go to investors under a partner's own name, and a system that could
 * send on their behalf without them looking is not something to build first.
 *
 * The app has Mail.ReadWrite across the tenant, so it can create a message in
 * any of the four mailboxes. A message created in Alan's mailbox is from
 * Alan — there is no "send as" to configure and no way for the address to be
 * wrong, because the mailbox IS the identity.
 *
 * WHAT COMES BACK MATTERS AS MUCH AS THE DRAFT. Microsoft assigns a
 * conversation id at creation, and it survives the draft being edited and sent.
 * Recording it is what later lets the mailbox sync see the sent message and
 * file it against the right raise — the one thing reading mailboxes alone can
 * never work out for somebody sitting on several live deals at once.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Microsoft's own cut-off for putting a file in the create call. */
const SIMPLE_ATTACHMENT_LIMIT = 3 * 1024 * 1024;

export interface DraftAttachment {
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface DraftRequest {
  mailbox: string;
  /**
   * Everyone on the To line.
   *
   * A LIST, not one address, because a partner writing to three people at one
   * firm wants one email they can all see and reply into — not three separate
   * conversations that then have to be reconciled by hand.
   */
  to: string[];
  /** Typed in by hand at drafting time. Copied to every draft in the run. */
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Plain text. Newlines become paragraphs; nothing else is interpreted. */
  body: string;
  attachments?: DraftAttachment[];
}

const recipients = (list: string[] | undefined) =>
  (list ?? []).filter(Boolean).map((address) => ({ emailAddress: { address } }));

export interface DraftCreated {
  id: string;
  conversationId: string;
  webLink?: string;
}

/**
 * Plain text into the HTML Outlook actually sends.
 *
 * Escaped first, ALWAYS. A partner typing "M&A at <5x EBITDA" must see exactly
 * that in the email, and an unescaped ampersand or angle bracket is how a
 * message quietly loses half its sentence.
 */
function html(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = escaped.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return `<div>${paragraphs.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
}

async function graph(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

async function fail(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => "");
  let detail = text.slice(0, 300);
  try { detail = JSON.parse(text)?.error?.message ?? detail; } catch { /* keep the raw text */ }
  throw new Error(`${what} (${res.status}): ${detail}`);
}

/**
 * Create one draft, with its attachments, in one mailbox.
 *
 * Small files go in the create call. Anything over Microsoft's 3MB limit needs
 * an upload session — a deck is almost always over it, so that path is the
 * normal one here rather than the exception.
 */
export async function createDraft(req: DraftRequest): Promise<DraftCreated> {
  const token = await graphToken();
  const box = encodeURIComponent(req.mailbox);
  const attachments = req.attachments ?? [];
  const small = attachments.filter((a) => a.bytes.byteLength <= SIMPLE_ATTACHMENT_LIMIT);
  const large = attachments.filter((a) => a.bytes.byteLength > SIMPLE_ATTACHMENT_LIMIT);

  const res = await graph(`/users/${box}/messages`, token, {
    method: "POST",
    body: JSON.stringify({
      subject: req.subject,
      body: { contentType: "HTML", content: html(req.body) },
      toRecipients: recipients(req.to),
      ccRecipients: recipients(req.cc),
      bccRecipients: recipients(req.bcc),
      attachments: small.map((a) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.name,
        contentType: a.contentType,
        contentBytes: Buffer.from(a.bytes).toString("base64"),
      })),
    }),
  });
  if (!res.ok) await fail(res, `Could not create a draft in ${req.mailbox}`);
  const made = await res.json();

  for (const a of large) {
    try {
      await uploadAttachment(box, made.id, a, token);
    } catch (e) {
      /* A draft missing its deck is worse than no draft: a partner would send
         it without noticing. Remove it and let the caller report the failure. */
      await graph(`/users/${box}/messages/${made.id}`, token, { method: "DELETE" }).catch(() => {});
      throw e;
    }
  }

  return { id: made.id, conversationId: made.conversationId ?? "", webLink: made.webLink };
}

/** Microsoft's chunked upload, for anything past the 3MB inline limit. */
async function uploadAttachment(
  box: string, messageId: string, a: DraftAttachment, token: string,
): Promise<void> {
  const total = a.bytes.byteLength;
  const open = await graph(
    `/users/${box}/messages/${messageId}/attachments/createUploadSession`, token, {
      method: "POST",
      body: JSON.stringify({
        AttachmentItem: { attachmentType: "file", name: a.name, size: total, contentType: a.contentType },
      }),
    });
  if (!open.ok) await fail(open, `Could not start the upload of ${a.name}`);
  const { uploadUrl } = await open.json();

  /* 4MB slices, which is inside Microsoft's limit and a multiple of the 320KB
     they require every chunk but the last to be. */
  const CHUNK = 4 * 1024 * 1024;
  for (let from = 0; from < total; from += CHUNK) {
    const to = Math.min(from + CHUNK, total) - 1;
    const slice = a.bytes.subarray(from, to + 1);
    /* No Authorization header: the upload URL carries its own credential, and
       sending ours as well is rejected. */
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "content-length": String(slice.byteLength),
        "content-range": `bytes ${from}-${to}/${total}`,
      },
      body: slice as unknown as BodyInit,
    });
    if (!put.ok && put.status !== 201 && put.status !== 200)
      await fail(put, `Uploading ${a.name} failed at ${from}`);
  }
}

/** Delete a draft. Used to undo a run that only half worked. */
export async function deleteDraft(mailbox: string, id: string): Promise<void> {
  const token = await graphToken();
  await graph(`/users/${encodeURIComponent(mailbox)}/messages/${id}`, token, { method: "DELETE" })
    .catch(() => {});
}


/* ── Following up: a reply in the thread that already exists ─────────────── */

/**
 * The newest message actually sent in a conversation.
 *
 * WHY THIS LOOKUP EXISTS AT ALL. The draft id recorded when an email is
 * written STOPS WORKING the moment the partner presses Send — the item moves
 * to Sent Items and the old id returns 404, which was confirmed against the
 * live mailbox rather than assumed. The conversation id is the thing that
 * survives, so a follow-up has to find its way back through that.
 *
 * Drafts in the thread are skipped, and the NEWEST sent message wins rather
 * than the first: if the investor answered and a partner replied by hand, the
 * follow-up belongs under the bottom of the conversation, not halfway up it.
 *
 * `$orderby` is not used — Graph rejects it alongside a `conversationId`
 * filter, so the sort happens here.
 */
export async function newestSentInThread(
  mailbox: string, conversationId: string,
): Promise<string | null> {
  if (!conversationId) return null;
  const token = await graphToken();
  const box = encodeURIComponent(mailbox);
  const res = await graph(
    `/users/${box}/messages?$filter=conversationId eq '${encodeURIComponent(conversationId)}'`
    + `&$select=id,sentDateTime,isDraft&$top=25`, token);
  if (!res.ok) return null;
  const { value } = await res.json() as { value?: { id: string; sentDateTime?: string; isDraft?: boolean }[] };
  const sent = (value ?? []).filter((m) => !m.isDraft);
  if (!sent.length) return null;
  sent.sort((a, b) => String(b.sentDateTime ?? "").localeCompare(String(a.sentDateTime ?? "")));
  return sent[0].id;
}

export interface ReplyRequest {
  mailbox: string;
  /** The thread to reply into — recorded when the first email was written. */
  conversationId: string;
  /** Who it goes to. Set EXPLICITLY rather than left to Graph's inference. */
  to: string[];
  cc?: string[];
  bcc?: string[];
  /** Plain text. It goes ABOVE the quoted thread. */
  body: string;
  /** Optional. A follow-up usually should not re-send the deck. */
  attachments?: DraftAttachment[];
}

export class ThreadGone extends Error {}

/**
 * Draft a reply in an existing thread.
 *
 * Microsoft writes the "RE:" subject and the quoted original; this puts the
 * partner's words above the quote and fixes the recipients. Setting the
 * recipients explicitly matters for a group email — `createReply` addresses
 * the original sender, and on a message we sent ourselves that inference is
 * not something to leave to chance when the alternative is naming them.
 */
export async function createReplyDraft(req: ReplyRequest): Promise<DraftCreated> {
  const token = await graphToken();
  const box = encodeURIComponent(req.mailbox);

  const parent = await newestSentInThread(req.mailbox, req.conversationId);
  if (!parent)
    throw new ThreadGone("The sent email could not be found in that mailbox, so there is nothing to reply to.");

  const made = await graph(`/users/${box}/messages/${parent}/createReply`, token, { method: "POST" });
  if (!made.ok) await fail(made, `Could not start a reply in ${req.mailbox}`);
  const reply = await made.json();

  /* The quote comes back on the draft; our text goes in front of it. Replacing
     the body outright would throw the thread away, which is the whole point of
     replying rather than writing afresh. */
  const patch = await graph(`/users/${box}/messages/${reply.id}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      body: { contentType: "HTML", content: `${html(req.body)}${reply.body?.content ?? ""}` },
      toRecipients: recipients(req.to),
      ccRecipients: recipients(req.cc),
      bccRecipients: recipients(req.bcc),
    }),
  });
  if (!patch.ok) {
    await graph(`/users/${box}/messages/${reply.id}`, token, { method: "DELETE" }).catch(() => {});
    await fail(patch, "Could not write the follow-up");
  }

  for (const a of req.attachments ?? []) {
    try {
      if (a.bytes.byteLength <= SIMPLE_ATTACHMENT_LIMIT) {
        const add = await graph(`/users/${box}/messages/${reply.id}/attachments`, token, {
          method: "POST",
          body: JSON.stringify({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: a.name, contentType: a.contentType,
            contentBytes: Buffer.from(a.bytes).toString("base64"),
          }),
        });
        if (!add.ok) await fail(add, `Could not attach ${a.name}`);
      } else {
        await uploadAttachment(box, reply.id, a, token);
      }
    } catch (e) {
      await graph(`/users/${box}/messages/${reply.id}`, token, { method: "DELETE" }).catch(() => {});
      throw e;
    }
  }

  return { id: reply.id, conversationId: reply.conversationId ?? req.conversationId, webLink: reply.webLink };
}
