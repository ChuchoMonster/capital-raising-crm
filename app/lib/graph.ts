import "server-only";

/**
 * Reading the partners' mailboxes.
 *
 * App-only access (client credentials), not a signed-in user's token: this runs
 * on a schedule with nobody present, so there is no session to borrow. The app
 * registration holds Mail.Read across the tenant, granted by Halden Ridge's own admin.
 *
 * `server-only` matters more here than almost anywhere else in the app. This
 * file can read every message in four mailboxes; if it were ever pulled into a
 * client component the build must fail rather than ship the credentials.
 */

const LOGIN = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";

/** The four mailboxes, by their PRIMARY address. */
export function mailboxes(): string[] {
  const raw = process.env.GRAPH_MAILBOXES?.trim();
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  /* Primary addresses, not the friendly aliases. Friendly aliases such as
     `alan.mercer@` are aliases and Graph refuses to impersonate either — the mailbox has to be
     named the way Exchange names it. */
  return [
    "alan@halden-ridge.example",
    "grace@halden-ridge.example",
    "peter@halden-ridge.example",
    "ruth@halden-ridge.example",
  ];
}

/* A token lasts an hour and this job runs every five minutes, so fetching one
   per run would be twelve unnecessary round trips an hour. Cached per container
   with a minute of headroom — a token that expires mid-run is an error that
   looks like a permissions failure. */
let cached: { token: string; expires: number } | null = null;

export async function graphToken(): Promise<string> {
  if (cached && Date.now() < cached.expires) return cached.token;

  const tenant = process.env.GRAPH_TENANT_ID;
  const id = process.env.GRAPH_CLIENT_ID;
  const secret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenant || !id || !secret) {
    throw new Error("Mailbox credentials are not set (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET)");
  }

  const res = await fetch(`${LOGIN}/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Could not sign in to Microsoft: ${body.error_description ?? res.status}`);
  }
  cached = { token: body.access_token, expires: Date.now() + (body.expires_in - 60) * 1000 };
  return cached.token;
}

/** One message, reduced to the parts this job uses. */
export interface MailMessage {
  id: string;
  internetMessageId: string;
  conversationId: string;
  subject: string;
  when: string;
  from: string | null;
  recipients: string[];
  /** address -> the display name it arrived with, where there was one.
      Kept because a new arrival's name is the most valuable thing we get for
      free, and re-fetching the message later to read it costs a round trip. */
  names?: Record<string, string>;
  folderId?: string;
  /** True for mail the CRM itself sent — an access or password email, not outreach. */
  system?: boolean;
}

const addr = (v: unknown): string | null => {
  const a = (v as { emailAddress?: { address?: string } })?.emailAddress?.address;
  if (!a) return null;
  const s = a.trim().toLowerCase();
  /* Internal senders come back as an Exchange directory path rather than an
     address — `/o=exchangelabs/ou=.../cn=amercer`. Three of the four
     partners' sent mail looks like this. Anything without an @ is not an
     address and must never be used as a key. */
  return s.includes("@") ? s : null;
};

/**
 * Mail the partner SENT, since `since`, oldest first.
 *
 * Read from the Sent Items folder, which is where sent mail stays — unlike
 * received mail, nobody files what they have sent.
 */
export async function fetchSent(mailbox: string, since: Date, opts: { max?: number } = {}) {
  return page(
    `${GRAPH}/users/${encodeURIComponent(mailbox)}/mailFolders/SentItems/messages` +
    `?$filter=sentDateTime ge ${since.toISOString()}` +
    /* internetMessageHeaders carries the CRM's own stamp — see SYSTEM_HEADER.
       An access email leaving a partner's mailbox is not a pitch. */
    `&$select=id,internetMessageId,conversationId,subject,sentDateTime,from,toRecipients,ccRecipients,internetMessageHeaders` +
    `&$orderby=sentDateTime&$top=100`,
    "sentDateTime", `${mailbox}/SentItems`, opts.max ?? 20_000,
  );
}

/**
 * Mail the partner RECEIVED, since `since` — from ANYWHERE in the mailbox.
 *
 * Deliberately not the Inbox. Measured over a week of live mail, between 49%
 * and 83% of what each partner received was no longer in their Inbox by the
 * time we looked, almost all of it in Deleted Items — Ruth in particular files
 * by deleting. Reading the Inbox alone would work only for a reply nobody had
 * touched yet, so a partner who read and cleared a reply inside the five-minute
 * window would have that reply missed permanently, because the watermark moves
 * past it either way. Reading the whole mailbox costs about six times as many
 * messages and removes the race entirely.
 *
 * Three folders are excluded. Sent Items because a sent message also carries a
 * received time and would otherwise come back as inbound. Drafts because an
 * unsent message is not correspondence. Junk because a reply the partner never
 * saw must not be recorded as a conversation that happened.
 */
export async function fetchReceived(mailbox: string, since: Date, opts: { max?: number } = {}) {
  const skip = await excludedFolders(mailbox);
  const all = await page(
    `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages` +
    `?$filter=receivedDateTime ge ${since.toISOString()}` +
    `&$select=id,internetMessageId,conversationId,subject,receivedDateTime,from,toRecipients,ccRecipients,parentFolderId` +
    `&$orderby=receivedDateTime&$top=100`,
    "receivedDateTime", `${mailbox}/all`, opts.max ?? 20_000,
  );
  return all.filter((m) => !m.folderId || !skip.has(m.folderId));
}

/* Well-known folder names resolve to ids per mailbox. Cached for the life of
   the container: these ids do not change. */
const folderCache = new Map<string, Set<string>>();

async function excludedFolders(mailbox: string): Promise<Set<string>> {
  const hit = folderCache.get(mailbox);
  if (hit) return hit;
  const token = await graphToken();
  const ids = new Set<string>();
  for (const name of ["sentitems", "drafts", "junkemail"]) {
    const res = await fetchWithRetry(
      `${GRAPH}/users/${encodeURIComponent(mailbox)}/mailFolders/${name}?$select=id`, token);
    if (res.ok) ids.add((await res.json()).id);
  }
  folderCache.set(mailbox, ids);
  return ids;
}

/**
 * Page a message list to exhaustion.
 *
 * Paged to exhaustion, and that is not incidental: this project has twice been
 * bitten by a source that reports success while handing back a partial answer
 * (a mail sweep that silently stopped at five thousand, an upload that reported
 * 100% having ingested a third). A page cap here would look identical to a
 * quiet week, so the cap is set far above any real window and is an error when
 * reached rather than a silent truncation.
 */
async function page(
  first: string, field: string, label: string, max: number,
): Promise<MailMessage[]> {
  const token = await graphToken();
  let url: string | undefined = first;
  const out: MailMessage[] = [];
  while (url) {
    const res: Response = await fetchWithRetry(url, token);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${label}: ${res.status} ${text.slice(0, 200)}`);
    }
    const body = await res.json();
    for (const m of body.value ?? []) {
      out.push({
        id: m.id,
        internetMessageId: m.internetMessageId ?? m.id,
        conversationId: m.conversationId ?? "",
        subject: m.subject ?? "",
        when: m[field],
        from: addr(m.from),
        folderId: m.parentFolderId,
        system: (m.internetMessageHeaders ?? []).some(
          (h: { name?: string }) => h?.name?.toLowerCase() === "x-hr-crm"),
        recipients: [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])]
          .map(addr).filter((a): a is string => !!a),
        names: Object.fromEntries(
          [m.from, ...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])]
            .map((r: unknown) => {
              const a = addr(r);
              const n = (r as { emailAddress?: { name?: string } })?.emailAddress?.name?.trim();
              /* A display name that is just the address again says nothing. */
              return a && n && n.toLowerCase() !== a ? [a, n] : null;
            })
            .filter((x): x is [string, string] => !!x)),
      });
    }
    url = body["@odata.nextLink"];
    if (out.length > max) throw new Error(`${label}: more than ${max} messages in one window — refusing to truncate silently`);
  }
  return out;
}

/**
 * Microsoft throttles with a 429 and tells you how long to wait. Honouring
 * that header rather than guessing is the difference between a pause and a
 * failed run; treating either a 429 or a 5xx as the end of the data is how a
 * sync silently truncates.
 */
async function fetchWithRetry(url: string, token: string, attempt = 0): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2 ** attempt * 1000;
    await new Promise((r) => setTimeout(r, Math.min(wait, 30_000)));
    return fetchWithRetry(url, token, attempt + 1);
  }
  return res;
}

/**
 * What one person actually wrote, without the thread quoted underneath it.
 *
 * `uniqueBody` is the whole point of this function. A reply carries the entire
 * pitch quoted below it — our own words, and often two or three earlier
 * messages — and anything reading `body` would be reading those as though the
 * sender had written them. Asked "did they accept or pass", a model given the
 * full body will answer about the wrong message often enough to matter, and a
 * wrong "Passed" removes a firm from a raise.
 *
 * Fetched one message at a time, on demand, and never stored. The CRM keeps the
 * sentence that carried a verdict and nothing else — it is not a mail archive
 * (client, 2026-08-31).
 */
export async function fetchReplyText(
  mailbox: string,
  messageId: string,
): Promise<{ text: string; subject: string } | null> {
  const token = await graphToken();
  const res = await fetch(
    `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}` +
    `?$select=subject,uniqueBody`,
    { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' }, cache: "no-store" },
  );
  /* A message that has been deleted or moved out of reach is not an error worth
     stopping a run for — there is simply nothing to read. */
  if (!res.ok) return null;
  const body = await res.json();
  const text = String(body?.uniqueBody?.content ?? "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return { text: text.slice(0, 4000), subject: String(body?.subject ?? "") };
}
