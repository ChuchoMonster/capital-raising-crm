/**
 * Getting back to the list you were actually looking at.
 *
 * A record page's "← Contacts" used to be a plain link to /contacts, which
 * threw away whatever you had done to find the person: search for Steve, open
 * Steve, come back to the full contact list and start again.
 *
 * So a row carries the list's own query string with it, and the record page
 * hands it back. Nothing is stored and nothing is guessed — the address bar of
 * the page you left is the whole state.
 *
 * WHAT COMES BACK IS REBUILT, NEVER TRUSTED. This value arrives in a URL, so a
 * link could be crafted with anything in it. Only known keys survive, each
 * capped in length, and the destination path is fixed in code — so the worst a
 * doctored link can do is return you to a list with odd filters on it.
 */

const ALLOWED = new Set([
  "q", "segment", "page", "bucket",
  "f.country", "f.type", "f.sector", "f.commodity", "f.aum",
  "f.via", "f.invests_in", "f.stage", "f.project",
]);

const MAX_VALUE = 120;

/** The current list's state, to hang off a row's link. */
export function backParam(search: string): string {
  const from = new URLSearchParams(search);
  const keep = new URLSearchParams();
  for (const [k, v] of from) if (ALLOWED.has(k) && v.length <= MAX_VALUE) keep.append(k, v);
  const qs = keep.toString();
  return qs ? `?back=${encodeURIComponent(qs)}` : "";
}

/** Where "← Contacts" should point. `base` is fixed by the caller, never read from the URL. */
export function backHref(base: "/contacts" | "/accounts" | "/exclusions", back: string | undefined): string {
  if (!back) return base;
  const from = new URLSearchParams(back);
  const keep = new URLSearchParams();
  for (const [k, v] of from) if (ALLOWED.has(k) && v.length <= MAX_VALUE) keep.append(k, v);
  const qs = keep.toString();
  return qs ? `${base}?${qs}` : base;
}
