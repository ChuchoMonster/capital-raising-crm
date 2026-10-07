import "server-only";
import { graphToken } from "./graph";

/**
 * The only place this app sends an email.
 *
 * Four messages exist: an access request to the approvers, an approval, a
 * decline, and a password reset. Nothing else in the CRM sends anything —
 * a deal's emails are written into a partner's Drafts folder and a person
 * presses Send.
 *
 * TWO TRANSPORTS, AND WHICH ONE RUNS IS THE POINT.
 *
 * Resend is the intended one. Sending through it means the app does not need
 * Microsoft's Mail.Send permission at all, and once Halden Ridge's admin removes that
 * permission the app becomes INCAPABLE of emailing an investor as Alan or
 * Ruth — not forbidden by a rule in this file, but unable, which is a much
 * stronger guarantee. Writing a draft is a different permission and is
 * unaffected. Access mail also stops landing in a partner's Sent Items, so it
 * can no longer be mistaken by the mailbox sync for outreach.
 *
 * Microsoft Graph is the fallback, and only while no Resend key is configured.
 * It is deliberately NOT silent: this project has been bitten repeatedly by
 * something failing over quietly and reading as success, and "I thought we
 * were off Mail.Send" is exactly that mistake. Every send through the fallback
 * says so in the log.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const RESEND = "https://api.resend.com/emails";

/** Set = send through Resend. Unset = fall back to a partner's mailbox. */
function resendKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null;
}

/**
 * Who a Resend message comes from.
 *
 * `send.halden-ridge.example`, NOT `halden-ridge.example`. That subdomain is the one
 * verified in Resend — confirmed from the live DNS, which carries the Amazon
 * SES feedback MX, an SPF naming amazonses.com, and a DKIM key at
 * resend._domainkey. The bare domain is Halden Ridge's real Outlook mail and is not
 * verified with Resend, so sending from it would be refused every time.
 *
 * Also not `CRM_MAIL_FROM` — that names a real mailbox for the Graph fallback.
 */
function resendFrom(): string {
  return process.env.RESEND_FROM?.trim() || "Halden Ridge CRM <crm@send.halden-ridge.example>";
}

/** The mailbox the Graph fallback sends from. */
export function sender(): string {
  return process.env.CRM_MAIL_FROM?.trim() || "alan@halden-ridge.example";
}

/** Which transport is live, for the smoke test and the access page. */
export function transport(): "resend" | "microsoft" {
  return resendKey() ? "resend" : "microsoft";
}

/**
 * Where the app lives, for links that must survive the sender's laptop.
 *
 * An Approve button in an email cannot point at localhost, and it must not
 * point at a Vercel deployment URL either — those are protected by Vercel's
 * own sign-in wall, so the link would bounce the approver to a Vercel login
 * rather than approving anything.
 */
export function origin(): string {
  const set = process.env.CRM_PUBLIC_URL?.trim();
  if (set) return set.replace(/\/+$/, "");
  return "https://crm.halden-ridge.example";
}

/**
 * Stamped on every message the GRAPH path sends.
 *
 * Those go out of a partner's own mailbox, which the mailbox sync reads. Left
 * unmarked, approving somebody who also happens to be a CRM contact recorded
 * that approval as OUTREACH, and if they were sitting on one deal awaiting
 * contact it was filed as the pitch.
 *
 * Resend messages never enter a mailbox, so they need no stamp — but the
 * header is kept for the fallback, and for any Graph mail a future change adds.
 */
export const SYSTEM_HEADER = "x-hr-crm";

export interface Mail {
  to: string;
  subject: string;
  /** Plain text. Turned into simple HTML so it renders the same everywhere. */
  body: string;
  replyTo?: string;
}

/**
 * Send one message. Throws on refusal — a caller deciding what to do about a
 * failed email is a different question from pretending it went.
 */
export async function sendMail(mail: Mail): Promise<void> {
  const key = resendKey();
  if (key) return sendViaResend(mail, key);
  console.warn(
    `[mail] RESEND_API_KEY is not set — sending to ${mail.to} through ${sender()}'s ` +
    `mailbox instead. This path needs Microsoft's Mail.Send permission.`);
  return sendViaGraph(mail);
}

async function sendViaResend({ to, subject, body, replyTo }: Mail, key: string): Promise<void> {
  const res = await fetch(RESEND, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      from: resendFrom(),
      to: [to],
      subject,
      html: html(body),
      /* Plain text alongside, so a client that refuses HTML still shows
         something — and a message with no text part scores worse with spam
         filters, which matters for the one email that must arrive. */
      text: body,
      ...(replyTo ? { reply_to: [replyTo] } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 200);
    try { detail = JSON.parse(text)?.message ?? detail; } catch { /* keep the raw text */ }
    throw new Error(`Could not send mail to ${to}: ${res.status} ${detail}`);
  }
}

async function sendViaGraph({ to, subject, body, replyTo }: Mail): Promise<void> {
  const token = await graphToken();
  const from = sender();

  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html(body) },
        toRecipients: [{ emailAddress: { address: to } }],
        ...(replyTo ? { replyTo: [{ emailAddress: { address: replyTo } }] } : {}),
        /* See SYSTEM_HEADER — keeps the mailbox sync from reading an access
           email as a pitch. Deal drafts do NOT carry this. */
        internetMessageHeaders: [{ name: SYSTEM_HEADER, value: "system" }],
      },
      /* Kept in the sender's Sent Items so a person can see what the system
         said in their name. */
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Could not send mail to ${to}: ${res.status} ${text.slice(0, 200)}`);
  }
}

/** Send several, and report which failed rather than stopping at the first. */
export async function sendAll(mails: Mail[]): Promise<{ sent: number; failed: { to: string; error: string }[] }> {
  const failed: { to: string; error: string }[] = [];
  let sent = 0;
  for (const m of mails) {
    try { await sendMail(m); sent++; }
    catch (e) { failed.push({ to: m.to, error: e instanceof Error ? e.message : String(e) }); }
  }
  return { sent, failed };
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Plain text to modest HTML.
 *
 * A line that is only a URL becomes a link; `[Label](url)` becomes a button.
 * Deliberately small: an email client will mangle anything ambitious, and the
 * messages this app sends are five lines and a link.
 */
function html(body: string): string {
  const lines = body.trim().split("\n");
  const out = lines.map((raw) => {
    const line = raw.trim();
    if (!line) return "<div style=\"height:12px\"></div>";

    const button = line.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (button) {
      return `<div style="margin:14px 0"><a href="${escape(button[2])}" style="display:inline-block;` +
        `padding:10px 18px;background:#1f2937;color:#ffffff;text-decoration:none;border-radius:6px;` +
        `font-weight:600;font-size:14px">${escape(button[1])}</a></div>`;
    }
    if (/^https?:\/\/\S+$/.test(line)) {
      return `<p style="margin:0 0 10px"><a href="${escape(line)}">${escape(line)}</a></p>`;
    }
    return `<p style="margin:0 0 10px">${escape(line)}</p>`;
  }).join("\n");

  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;` +
    `font-size:14.5px;line-height:1.55;color:#111827;max-width:560px">\n${out}\n</div>`;
}
