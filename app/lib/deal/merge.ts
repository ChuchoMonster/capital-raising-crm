/**
 * Filling a template in for one person.
 *
 * Tokens are written the way a person would write them — `{First name}`, not
 * `{{first_name}}` — because Halden Ridge write these templates, not developers.
 * Matching ignores case and spacing, so `{first name}` and `{First Name}` are
 * the same token and nobody has to remember which.
 *
 * EVERY TOKEN HAS A FALLBACK AND NONE OF THEM IS BLANK. About 2,900 investors
 * are an email address with no name attached, and "Hi ," reaching one of them
 * is worse than the email not going at all. `{Greeting}` is the one that
 * matters: it becomes "Hi Sarah" where there is a name and "Hi there" where
 * there is not, which is the rule Halden Ridge asked for.
 *
 * An UNKNOWN token is left exactly as it was typed rather than emptied. A
 * partner who mistypes `{Frist name}` sees it in their own draft and fixes it;
 * silently deleting it would send a sentence with a hole in it.
 */

export interface MergeSubject {
  firstName: string;
  fullName: string;
  company: string;
  jobTitle: string;
}

export interface MergeContext {
  deal: string;
  sector: string;
  sender: string;
}

/** What a template may contain, in the order they are offered on the page. */
export const TOKENS = [
  { token: "{Greeting}", describes: 'the whole opening — "Hi Sarah" or "Hi there"' },
  { token: "{First name}", describes: "their first name, or “there”" },
  { token: "{Full name}", describes: "their full name" },
  { token: "{Company}", describes: "the firm they are at" },
  { token: "{Job title}", describes: "their title, where we hold one" },
  { token: "{Deal}", describes: "the name of this raise" },
  { token: "{Sector}", describes: "what the company does" },
  { token: "{Sender}", describes: "the partner it is going out from" },
] as const;

/** The first word of a name, ignoring a title someone typed in front of it. */
export function firstNameOf(fullName: string): string {
  const cleaned = fullName.replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, "").trim();
  const first = cleaned.split(/\s+/)[0] ?? "";
  /* An initial is not a first name — "J. Smith" greeted as "Hi J" reads worse
     than the neutral version. */
  return /^[A-Za-z]{2,}$/.test(first.replace(/[^A-Za-z]/g, "")) ? first : "";
}

export function fillFor(
  text: string, person: MergeSubject, ctx: MergeContext,
): string {
  const first = person.firstName || firstNameOf(person.fullName);
  const values: Record<string, string> = {
    "greeting": first ? `Hi ${first}` : "Hi there",
    "first name": first || "there",
    "full name": person.fullName || first || "there",
    "company": person.company || "your firm",
    "job title": person.jobTitle || "",
    "deal": ctx.deal,
    "sector": ctx.sector,
    "sender": ctx.sender,
  };
  return text.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
    const key = name.trim().toLowerCase().replace(/\s+/g, " ");
    return key in values ? values[key] : whole;
  });
}
