import "server-only";
import { query, one } from "../db";

/**
 * Working out who an uploaded contact actually is.
 *
 * An upload lands people with an address and almost nothing else. Matching the
 * domain against firms already held places some of them for free; everybody
 * else sits in Pending, which is honest but not useful. This is the step that
 * moves them — the same question the research pipeline opens with, asked of
 * the firm behind the address: what kind of counterparty is this.
 *
 * ⚠️ WHAT THIS IS AND IS NOT. It is STEP B5 of the intake flow — classify the
 * domain, web-verified, with the evidence checked in code. It is NOT the whole
 * flow. The Opus second opinion, the Blitz name lookup, MillionVerifier and
 * the per-segment enrichment all live in the research pipeline with their own
 * keys and their own approvals, and none of them is wired in here. What comes
 * out of this is a placed contact with a classified firm behind it, which is
 * the part that decides which list somebody appears on.
 *
 * THREE RULES, ALL ENFORCED IN CODE RATHER THAN ASKED FOR IN THE PROMPT:
 *
 *  1. A CLAIM NEEDS EVIDENCE. Every classification must come back with the
 *     page it was read from and a sentence off that page. No source, no write
 *     — the row stays Pending. A model recalling a firm from training data and
 *     a model reading its website are indistinguishable in the answer, and only
 *     the citation separates them.
 *  2. CONTROLLED VOCABULARY. A segment outside the six is dropped, not coerced
 *     into the nearest one.
 *  3. UNSURE IS AN ANSWER. "I could not establish what this firm is" leaves the
 *     contact in Pending, where somebody can look. Guessing them onto the
 *     investor list is the one outcome that costs Halden Ridge something real.
 *
 * A FREE-EMAIL ADDRESS IS A DIFFERENT QUESTION AND GETS A DIFFERENT PASS.
 * gmail.com is not a firm, so there is nothing to look up about the domain —
 * the thing to identify is the PERSON. That is the split the research pipeline
 * makes too, and this file makes the same one: `identifyPerson` below asks who
 * somebody is and who they work for, and only then is their employer treated
 * as a firm.
 */

const MODEL = "claude-sonnet-5";
const CONCURRENCY = 4;

/** Consumer providers. A person here has no firm behind their address. */
const FREE = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "live.com", "live.co.uk", "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
  "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
  "gmx.com", "gmx.de", "mail.com", "zoho.com", "yandex.com", "qq.com",
  "btinternet.com", "comcast.net", "verizon.net", "earthlink.net", "sbcglobal.net",
  "bigpond.com", "optusnet.com.au", "t-online.de", "web.de", "orange.fr", "free.fr",
]);

export const isFreeEmailDomain = (d: string) => FREE.has(d.toLowerCase());

/** The six the CRM works, plus the two ways out. Nothing else is written. */
const SEGMENTS = new Set([
  "Investors", "Family Offices", "High Net Worth",
  "Intermediaries", "Business", "Government/Strategic", "Excluded",
]);

export interface EnrichOutcome {
  ok: boolean;
  message: string;
  /** Firms looked up in this run. */
  looked: number;
  /** Firms classified and written. */
  placed: number;
  /** People moved off Pending as a result. */
  people: number;
  /** Firms the model could not establish. They stay Pending. */
  unsure: number;
  /** People on a consumer address who were looked up as PEOPLE. */
  personal: number;
  /** Of those, the ones whose employer was found and who were placed. */
  personalPlaced: number;
  /** Still waiting, because a run is capped. */
  remaining: number;
}

interface Verdict {
  domain: string;
  segment?: string;
  companyName?: string;
  type?: string;
  country?: string;
  reason?: string;
  sourceUrl?: string;
  quote?: string;
  unsure?: boolean;
}

const SCHEMA = {
  type: "object",
  properties: {
    unsure: { type: "boolean", description: "True if you could not establish what this organisation is. Preferred over a guess." },
    segment: {
      type: "string",
      enum: ["Investors", "Family Offices", "High Net Worth", "Intermediaries", "Business", "Government/Strategic", "Excluded"],
      description: "Which list this organisation belongs on. Empty if unsure.",
    },
    companyName: { type: "string", description: "The organisation's real name, as it writes it." },
    type: { type: "string", description: "What kind, in a few words: 'Hedge Fund', 'Law Firm', 'Copper explorer', 'Ministry'." },
    country: { type: "string", description: "ISO-3166 alpha-2 of its head office, if stated. Empty otherwise." },
    reason: { type: "string", description: "One sentence saying what the organisation does and why it belongs on that list." },
    sourceUrl: { type: "string", description: "The page you read this from. Required unless unsure." },
    quote: { type: "string", description: "A verbatim sentence from that page describing the organisation. Required unless unsure." },
  },
  required: ["unsure", "segment", "companyName", "type", "country", "reason", "sourceUrl", "quote"],
  additionalProperties: false,
} as const;

const SYSTEM = `You identify organisations for Halden Ridge Advisors, who connect mining and energy companies with investors.

Given a web domain, search the web, find out what the organisation is, and say which list it belongs on:

- Investors — funds and institutions that deploy capital: asset managers, private equity, hedge funds, venture capital, pensions, sovereign wealth funds, banks investing as principal.
- Family Offices — one family's money, run by its own office.
- High Net Worth — an individual investing their own money.
- Intermediaries — brokers, placement agents, corporate advisers, law firms, IR/PR, technical consultants, commodity traders, exchanges. They arrange deals rather than funding them.
- Business — operating companies: mining, metals, oil and gas, power, renewables, batteries, processing. The counterparties that RAISE capital.
- Government/Strategic — ministries, regulators, agencies, export-credit agencies, development finance institutions, defence.
- Excluded — consumer businesses, newsletters, media, software vendors, email providers, parked domains, and anything with no connection to capital markets or natural resources.

RULES:
1. Search before answering. Do not classify from memory.
2. If you cannot establish what the organisation is — the site is dead, parked, or you find nothing — set unsure to true. That is a correct answer and is much better than a guess. It is far worse to put an unknown firm on the investor list than to leave it unplaced.
3. Give the exact page you read and a verbatim sentence from it. Do not paraphrase the quote.
4. A state-owned company that operates mines or oil fields is Business, not Government.
5. A bank is Investors only if it invests as principal; a bank that only advises is Intermediaries.`;

async function classify(domain: string, hint: string, key: string): Promise<Verdict> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      /* The web search runs on Anthropic's side, so this is still ONE request —
         no tool loop to run here. tool_choice is left open deliberately: forcing
         the answer tool would stop the model searching first, which is the
         whole point. */
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 4 },
        { name: "classify", description: "Say what this organisation is.", input_schema: SCHEMA },
      ],
      messages: [{
        role: "user",
        content: `Domain: ${domain}\n${hint}\n\nSearch the web, then call classify.`,
      }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }
  const payload = await res.json();
  const block = (payload.content ?? []).find(
    (c: { type: string; name?: string }) => c.type === "tool_use" && c.name === "classify");
  if (!block) return { domain, unsure: true };
  const v = block.input as Record<string, unknown>;
  const str = (k: string) => String(v[k] ?? "").trim();
  return {
    domain,
    unsure: v.unsure === true,
    segment: str("segment"),
    companyName: str("companyName"),
    type: str("type"),
    country: str("country").toUpperCase().slice(0, 2),
    reason: str("reason"),
    sourceUrl: str("sourceUrl"),
    quote: str("quote"),
  };
}

/**
 * Is this answer allowed to be written?
 *
 * The guard, and it is deliberately blunt. It does not try to judge whether the
 * classification is RIGHT — it checks that the model was reading something.
 * An answer with no page and no sentence is the model's own recollection, and
 * this project has paid for the difference between that and a citation more
 * than once.
 */
function usable(v: Verdict): boolean {
  if (v.unsure) return false;
  if (!v.segment || !SEGMENTS.has(v.segment)) return false;
  if (!/^https?:\/\/\S+$/i.test(v.sourceUrl ?? "")) return false;
  /* Long enough to be a sentence off a page rather than a label repeated back. */
  if ((v.quote ?? "").trim().length < 25) return false;
  return true;
}

/* ── Somebody on a personal address ──────────────────────────────────────── */

/**
 * Who is this, and who do they work for?
 *
 * The domain tells you nothing when it is gmail.com, so the question changes:
 * identify the PERSON, find their employer, and only then treat that employer
 * as a firm. That is the same fork the research pipeline makes, and the
 * pipeline's own lesson applies here — the cheap signals first.
 *
 * WHAT IT IS GIVEN, in the order it is worth anything:
 *  1. What the spreadsheet said. A Company or LinkedIn column is a fact
 *     somebody typed about this person, and it is free. It was kept on the row
 *     at upload for exactly this moment.
 *  2. Their name and the address itself.
 *
 * ⚠️ THE HINT IS A LEAD, NOT AN ANSWER. The pipeline measured a vendor's
 * employer field disagreeing with its own research 83 times in 120 — a board
 * seat instead of the day job, or the wrong person entirely. So the hint is
 * offered as something to CHECK, and the model is told plainly it may be
 * wrong; a claim still has to come back with a page and a sentence.
 *
 * ⚠️ NOBODY IS EXCLUDED BECAUSE A LOOKUP FAILED. Not finding somebody means we
 * do not know who they are, which is Pending. The pipeline made this mistake
 * once and would have excluded 119 people of whom 70 were merely unidentified,
 * including a chairman its own notes already named. Only a positively
 * identified off-sector employer moves anybody to Excluded, and that is the
 * firm's classification doing it, not the failure to find one.
 */
interface PersonVerdict {
  unsure?: boolean;
  fullName?: string;
  jobTitle?: string;
  employer?: string;
  employerDomain?: string;
  sourceUrl?: string;
  quote?: string;
}

const PERSON_SCHEMA = {
  type: "object",
  properties: {
    unsure: { type: "boolean", description: "True if you could not establish who this person is or who they work for. Much better than a guess." },
    fullName: { type: "string", description: "Their full name as they write it, if you can confirm it. Empty otherwise." },
    jobTitle: { type: "string", description: "Their current role. Empty if not established." },
    employer: { type: "string", description: "The organisation they currently work for. Empty if not established." },
    employerDomain: { type: "string", description: "That organisation's web address, bare domain, e.g. 'acme.com'. Empty if not established." },
    sourceUrl: { type: "string", description: "The page you read this from. Required unless unsure." },
    quote: { type: "string", description: "A verbatim sentence from that page connecting this person to that organisation. Required unless unsure." },
  },
  required: ["unsure", "fullName", "jobTitle", "employer", "employerDomain", "sourceUrl", "quote"],
  additionalProperties: false,
} as const;

const PERSON_SYSTEM = `You identify individuals for Halden Ridge Advisors, who connect mining and energy companies with investors.

You are given somebody's personal email address — gmail, outlook, icloud — and whatever else is known about them, which is often very little. Search the web and work out who they are and, above all, WHO THEY WORK FOR NOW.

RULES:
1. Search before answering. Never answer from memory alone.
2. Anything supplied as a hint is a LEAD, NOT A FACT. A company name typed into a spreadsheet is frequently out of date, a board seat rather than the day job, or simply the wrong person. Check it. If the evidence contradicts it, follow the evidence and say so.
3. The person must be the SAME person. A common name is not a match. If you cannot tie the individual to the address or to the supplied details, set unsure to true.
4. If you cannot establish who they are, set unsure to true. That is a correct and useful answer. Leaving somebody unidentified costs nothing; attaching them to the wrong firm puts a stranger's details in front of investors.
5. "No employer" is a real answer for a retired person or somebody investing their own money. Say so in the quote rather than inventing an employer.
6. Give the exact page you read and a verbatim sentence from it tying the person to the organisation.`;

async function identifyPerson(
  p: { email: string; name: string; note: string }, key: string,
): Promise<PersonVerdict> {
  const known = [
    p.name && `Name given: ${p.name}`,
    p.note && `The spreadsheet also said: ${p.note.slice(0, 300)}`,
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: PERSON_SYSTEM,
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        { name: "identify", description: "Say who this person is.", input_schema: PERSON_SCHEMA },
      ],
      messages: [{
        role: "user",
        content: `Personal email address: ${p.email}\n${known}\n\nSearch the web, then call identify.`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const payload = await res.json();
  const block = (payload.content ?? []).find(
    (c: { type: string; name?: string }) => c.type === "tool_use" && c.name === "identify");
  if (!block) return { unsure: true };
  const v = block.input as Record<string, unknown>;
  const str = (k: string) => String(v[k] ?? "").trim();
  return {
    unsure: v.unsure === true,
    fullName: str("fullName"),
    jobTitle: str("jobTitle"),
    employer: str("employer"),
    employerDomain: str("employerDomain").toLowerCase()
      .replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0],
    sourceUrl: str("sourceUrl"),
    quote: str("quote"),
  };
}

/** Same blunt test as the firm guard: was the model reading something? */
function usablePerson(v: PersonVerdict): boolean {
  if (v.unsure) return false;
  if (!/^https?:\/\/\S+$/i.test(v.sourceUrl ?? "")) return false;
  if ((v.quote ?? "").trim().length < 25) return false;
  return true;
}

/* ── The run ─────────────────────────────────────────────────────────────── */

interface Waiting { domain: string; contacts: number; names: string; accountId: string | null }

/** Uploaded rows still waiting to be identified, most-populated domain first. */
export async function waitingToEnrich(limit: number): Promise<Waiting[]> {
  return query<Waiting>(
    `select c.domain,
            count(*)::int as contacts,
            string_agg(distinct coalesce(nullif(c.full_name,''), c.email), '; ') as names,
            max(a.hr_id) as "accountId"
       from contacts c
       left join accounts a on lower(a.domain) = lower(c.domain) and a.segment = 'Pending'
      where c.owner @> array['Uploaded']
        and c.segment = 'Pending'
        and c.domain is not null and c.domain <> ''
      group by c.domain
      order by count(*) desc, c.domain
      limit $1`, [limit]);
}

export async function enrichUploaded(max = 40): Promise<EnrichOutcome> {
  const key = process.env.ANTHROPIC_API_KEY;
  const nothing = { looked: 0, placed: 0, people: 0, unsure: 0, personal: 0, personalPlaced: 0, remaining: 0 };
  if (!key)
    return { ok: false, ...nothing,
      message: "ANTHROPIC_API_KEY is not set on the server, so uploaded contacts cannot be identified." };

  const all = await waitingToEnrich(max + 200);
  const firms = all.filter((w) => !isFreeEmailDomain(w.domain));
  const personalDomains = all.filter((w) => isFreeEmailDomain(w.domain));

  /* Firms first. They are cheaper — one lookup places everybody at that
     domain — and a person's employer may well be a firm this pass has just
     established, which then costs nothing to classify a second time. */
  const batch = firms.slice(0, max);
  let placed = 0, people = 0, unsure = 0;

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY);
    const verdicts = await Promise.all(slice.map(async (w) => {
      try {
        return await classify(w.domain, `People at this domain: ${w.names.slice(0, 300)}`, key);
      } catch (e) {
        console.error("could not classify an uploaded domain", w.domain, e);
        return { domain: w.domain, unsure: true } as Verdict;
      }
    }));
    for (const v of verdicts) {
      const w = slice.find((x) => x.domain === v.domain)!;
      if (!usable(v)) { unsure++; continue; }
      try { people += await place(w, v); placed++; }
      catch (e) { console.error("could not write a classification", v.domain, e); unsure++; }
    }
  }

  /* Then the people. One lookup each, because the question is about the
     person and not the address they happen to use. */
  const budget = Math.max(0, max - batch.length);
  const waitingPeople = personalDomains.length
    ? await personalWaiting(budget + 100)
    : [];
  const personBatch = waitingPeople.slice(0, budget);
  let personal = 0, personalPlaced = 0;

  for (let i = 0; i < personBatch.length; i += CONCURRENCY) {
    const slice = personBatch.slice(i, i + CONCURRENCY);
    const found = await Promise.all(slice.map(async (c) => {
      try { return { c, v: await identifyPerson(c, key) }; }
      catch (e) {
        console.error("could not identify an uploaded person", c.email, e);
        return { c, v: { unsure: true } as PersonVerdict };
      }
    }));
    for (const { c, v } of found) {
      personal++;
      if (!usablePerson(v)) continue;
      try { if (await placePerson(c, v, key)) personalPlaced++; }
      catch (e) { console.error("could not place an identified person", c.email, e); }
    }
  }

  const remaining = Math.max(0, firms.length - batch.length)
    + Math.max(0, waitingPeople.length - personBatch.length);

  const bits: string[] = [];
  if (batch.length) bits.push(`${placed} of ${batch.length} ${batch.length === 1 ? "firm" : "firms"} identified`
    + (people ? `, placing ${people} ${people === 1 ? "person" : "people"}` : ""));
  if (personBatch.length) bits.push(`${personalPlaced} of ${personBatch.length} personal ${personBatch.length === 1 ? "address" : "addresses"} traced to an employer`);
  if (!bits.length) bits.push("Nothing is waiting to be identified");

  return {
    ok: true, looked: batch.length, placed, people, unsure, personal, personalPlaced, remaining,
    message: bits.join("; ") + "."
      + (unsure ? ` ${unsure} could not be established and stay in Pending.` : "")
      + (personBatch.length - personalPlaced > 0
        ? ` ${personBatch.length - personalPlaced} ${personBatch.length - personalPlaced === 1 ? "person" : "people"} could not be identified — they stay in Pending, never excluded.` : "")
      + (remaining ? ` ${remaining} more still to look up.` : ""),
  };
}

/** Uploaded people on a consumer address, still unidentified. */
async function personalWaiting(limit: number): Promise<{ hr_id: string; email: string; name: string; note: string }[]> {
  return query<{ hr_id: string; email: string; name: string; note: string }>(
    `select hr_id, email,
            coalesce(full_name, '') as name,
            coalesce(note, '') as note
       from contacts
      where owner @> array['Uploaded']
        and segment = 'Pending'
        and account_id is null
        and lower(split_part(email, '@', 2)) = any($1::text[])
      order by hr_id
      limit $2`, [[...FREE], limit]);
}

/**
 * Attach an identified person to their employer, classifying it if need be.
 *
 * The employer is then just a firm, and the firm question already has an
 * answer here — so an employer already in the CRM costs nothing, and a new one
 * goes through exactly the same classification and the same guard as a domain
 * that arrived on its own. There is no second, looser path.
 *
 * Their own row keeps what was learned: the name if we did not have one, their
 * title, and the sentence it came from. That note is the only way anybody can
 * later tell a researched answer from a typed one.
 */
async function placePerson(
  c: { hr_id: string; email: string; name: string; note: string },
  v: PersonVerdict, key: string,
): Promise<boolean> {
  const learned = [
    v.employer && `Identified as ${v.jobTitle ? `${v.jobTitle}, ` : ""}${v.employer}`,
    v.quote && `"${v.quote.slice(0, 200)}"`,
    v.sourceUrl,
  ].filter(Boolean).join(" — ");
  const note = [c.note, learned].filter(Boolean).join(" | ");

  await query(
    `update contacts
        set full_name = coalesce(nullif(full_name, ''), nullif($2, '')),
            job_title = coalesce(nullif(job_title, ''), nullif($3, '')),
            note = $4
      where hr_id = $1`,
    [c.hr_id, v.fullName ?? "", v.jobTitle ?? "", note]);

  /* No employer found is a real answer — a retiree, or somebody investing
     their own money. They keep what was learned about them and stay in
     Pending for a person to look at. Nobody is excluded for it. */
  const domain = v.employerDomain ?? "";
  if (!domain || !domain.includes(".") || isFreeEmailDomain(domain)) return false;

  const existing = await one<{ hr_id: string; segment: string }>(
    `select hr_id, segment from accounts where lower(domain) = lower($1) limit 1`, [domain]);

  if (existing) {
    /* Their employer is already here, classified. Nothing to look up. */
    await query(`update contacts set account_id = $2, segment = $3 where hr_id = $1`,
      [c.hr_id, existing.hr_id, existing.segment]);
    return true;
  }

  const firm = await classify(domain, `A contact of ours works here: ${v.fullName || c.name}.`, key);
  if (!usable(firm)) return false;
  await place({ domain, contacts: 1, names: v.fullName || c.name, accountId: null }, firm);
  await query(
    `update contacts set domain = coalesce(nullif(domain,''), $2) where hr_id = $1`,
    [c.hr_id, domain]);
  /* `place` moves everybody at that domain who is still Pending — which does
     not include this person, whose address is a gmail. So they are attached
     here, by hand, to the account it just made. */
  const made = await one<{ hr_id: string; segment: string }>(
    `select hr_id, segment from accounts where lower(domain) = lower($1) limit 1`, [domain]);
  if (!made) return false;
  await query(`update contacts set account_id = $2, segment = $3 where hr_id = $1`,
    [c.hr_id, made.hr_id, made.segment]);
  return true;
}

/**
 * Write one firm and move its people onto its list.
 *
 * The account is created if the upload did not already make one, and it carries
 * the sentence and the page it was read from — a classification nobody can
 * check is worth very little, and the note is where a person looks first.
 */
async function place(w: Waiting, v: Verdict): Promise<number> {
  const note = `${v.reason} [${v.sourceUrl}]`;
  let accountId = w.accountId;

  if (accountId) {
    await query(
      `update accounts set segment = $2, name = coalesce(nullif($3,''), name),
              type = coalesce(nullif($4,''), type), note = $5,
              countries = case when $6 = '' then countries else array[$6] end
       where hr_id = $1`,
      [accountId, v.segment, v.companyName, v.type, note, v.country]);
  } else {
    const r = await one<{ m: number | null }>(
      `select max((substring(hr_id from 7))::int) as m from accounts where hr_id like 'HR-AU-%'`);
    accountId = `HR-AU-${String((r?.m ?? 0) + 1).padStart(6, "0")}`;
    await query(
      `insert into accounts
         (hr_id, name, domain, segment, type, note, owner, countries, country_names, search_text, website)
       values ($1,$2,$3,$4,$5,$6,array['Uploaded'],
               case when $7 = '' then '{}'::text[] else array[$7] end, '{}', $8, $3)`,
      [accountId, v.companyName || w.domain, w.domain, v.segment, v.type, note, v.country,
       `${v.companyName} ${w.domain}`.toLowerCase()]);
  }

  /* Excluded is a real answer and the contacts follow the firm into it — that
     is what stops a newsletter domain sitting on a working list. */
  const moved = await query<{ hr_id: string }>(
    `update contacts set segment = $2, account_id = $3
      where owner @> array['Uploaded'] and segment = 'Pending' and lower(domain) = lower($1)
      returning hr_id`,
    [w.domain, v.segment, accountId]);
  return moved.length;
}
