import "server-only";

/**
 * Working out what each column IS.
 *
 * People do not name columns the same way twice — "Email", "E-mail Address",
 * "Work Email", "email_address". So the headings are matched against a list of
 * the names actually used, normalised so punctuation and case do not matter.
 *
 * ⚠️ WHAT IT DECIDES IS SHOWN, ALWAYS. A guess and a correct reading look
 * identical once the rows are in, so the mapping is put in front of the person
 * before anything is written, and a column it could not place is named rather
 * than quietly dropped. That is the whole reason this is a separate step from
 * reading the file.
 *
 * MOST SPECIFIC WINS. "Company Name" is the company, not the person's name,
 * even though it contains "name" — so the patterns are tried in order and the
 * first field to claim a heading keeps it.
 */

export type ContactField =
  | "email" | "name" | "firstName" | "lastName" | "jobTitle"
  | "company" | "domain" | "country" | "phone" | "linkedin" | "note";

export type AccountField = "name" | "domain" | "country" | "type" | "note";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** In order. The first field whose pattern matches a heading claims it. */
const CONTACT_PATTERNS: [ContactField, RegExp][] = [
  ["email", /^(e?mail|emailaddress|e?mailaddress|workemail|businessemail|primaryemail|bestemail|contactemail)$/],
  ["firstName", /^(first|firstname|forename|givenname|fname)$/],
  ["lastName", /^(last|lastname|surname|familyname|lname)$/],
  ["jobTitle", /^(title|jobtitle|position|jobrole|designation|roletitle)$/],
  /* Before `name`: "company name" contains "name" and is not the person's. */
  ["company", /^(company|companyname|account|accountname|firm|firmname|organisation|organization|organisationname|organizationname|employer|business)$/],
  ["domain", /^(domain|website|weburl|url|companydomain|companywebsite|site)$/],
  ["country", /^(country|countries|location|basedin|officelocation|officelocations)$/],
  ["phone", /^(phone|telephone|mobile|phonenumber|tel|cell)$/],
  ["linkedin", /^(linkedin|linkedinurl|linkedinprofile|li)$/],
  ["name", /^(name|fullname|contactname|contact|person|personname|displayname)$/],
  ["note", /^(note|notes|comment|comments|remarks|description)$/],
];

const ACCOUNT_PATTERNS: [AccountField, RegExp][] = [
  ["domain", /^(domain|website|weburl|url|companydomain|companywebsite|site)$/],
  ["country", /^(country|countries|location|basedin|hq|headquarters|officelocation|officelocations)$/],
  ["type", /^(type|investortype|industry|sector|kind|category|accounttype)$/],
  ["name", /^(name|company|companyname|account|accountname|firm|firmname|organisation|organization|business)$/],
  ["note", /^(note|notes|comment|comments|remarks|description)$/],
];

export interface Mapping<F extends string> {
  /** field -> the heading it was read from. */
  fields: Partial<Record<F, string>>;
  /** Headings nothing claimed. Named, never silently dropped. */
  ignored: string[];
}

function build<F extends string>(headers: string[], patterns: [F, RegExp][]): Mapping<F> {
  const fields: Partial<Record<F, string>> = {};
  const claimed = new Set<string>();
  for (const [field, re] of patterns) {
    for (const h of headers) {
      if (claimed.has(h) || fields[field]) continue;
      if (re.test(norm(h))) { fields[field] = h; claimed.add(h); }
    }
  }
  return { fields, ignored: headers.filter((h) => !claimed.has(h)) };
}

export const mapContacts = (headers: string[]) => build(headers, CONTACT_PATTERNS);
export const mapAccounts = (headers: string[]) => build(headers, ACCOUNT_PATTERNS);

/* ── Reading one row through a mapping ───────────────────────────────────── */

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

export interface ImportedContact {
  email: string; name: string; jobTitle: string; company: string;
  domain: string; country: string; phone: string; linkedin: string; note: string;
}

export function readContact(row: Record<string, string>, m: Mapping<ContactField>): ImportedContact {
  const get = (f: ContactField) => clean(m.fields[f] ? row[m.fields[f]!] : "");
  /* A full name column wins; otherwise first and last are joined. Somebody
     supplying both is not a conflict — the full name is what they typed. */
  const name = get("name") || [get("firstName"), get("lastName")].filter(Boolean).join(" ");
  const email = get("email").toLowerCase();
  return {
    email,
    name,
    jobTitle: get("jobTitle"),
    company: get("company"),
    /* An explicit domain column wins; otherwise it comes off the address,
       which is the only thing on the row that cannot be mistyped into
       something else entirely. */
    domain: domainOf(get("domain")) || email.split("@")[1] || "",
    country: get("country"),
    phone: get("phone"),
    linkedin: get("linkedin"),
    note: get("note"),
  };
}

export interface ImportedAccount {
  name: string; domain: string; country: string; type: string; note: string;
}

export function readAccount(row: Record<string, string>, m: Mapping<AccountField>): ImportedAccount {
  const get = (f: AccountField) => clean(m.fields[f] ? row[m.fields[f]!] : "");
  return {
    name: get("name"),
    domain: domainOf(get("domain")),
    country: get("country"),
    type: get("type"),
    note: get("note"),
  };
}

/** "https://www.Acme.com/about" -> "acme.com". Blank if it is not one. */
export function domainOf(raw: string): string {
  let s = clean(raw).toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].replace(/\.$/, "");
  return /^[^\s@]+\.[a-z]{2,}$/i.test(s) ? s : "";
}

/** Loose on purpose: this refuses what is obviously not an address. */
export const looksLikeEmail = (s: string) => /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/.test(s);
