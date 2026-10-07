import "server-only";
import { query } from "./db";
import { contactsInScope } from "./scope";
import { LAST_CONTACT_COLS, lastContactJoin, lastContactFrom, everReplied } from "./store";
import type { LastContact } from "./types";

/**
 * Who should see this deal, and how confident are we.
 *
 * Five questions are asked of every investor firm: does it back this sector,
 * does it name this deal's minerals, is it anywhere near the geography, is the
 * fund the right size to write this cheque, and does it do equity.
 *
 * TWO RULES CARRY THE WHOLE THING, both agreed with the client:
 *
 *  1. A FIRM IS ONLY EVER RULED OUT BY EVIDENCE, NEVER BY ABSENCE. A blank
 *     field means we have not done the research; it never means no. So a
 *     missing answer costs a firm a tier and nothing more. The one exception
 *     is fund size, because a size band is exhaustive — a firm known to run
 *     $50bn is definitively not going to write $15m.
 *  2. TIERS COUNT WHAT IS STILL UNKNOWN, not what is confirmed. Nothing
 *     unknown is Tier 1, one unknown is Tier 2, two or more is Tier 3.
 *     Counting confirmations instead would push a strategic buyer like BHP —
 *     which has no fund size because it is not a fund — down the list, and
 *     those are exactly the buyers a mining raise wants.
 *
 * Nobody set aside can appear here: the contact query carries the same scope
 * as the rest of the CRM, and the issuer's own people are dropped by name.
 */

export interface TierContact {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string;
  replied: boolean;
  status: string | null;
  onDeal: boolean;
  /**
   * The same last-contact fact the person's own record shows — when they were
   * last written to, whether they answered, on which raise and by whom.
   *
   * It replaces the email-deliverability chip that stood here. Whether an
   * address bounces is already settled before a contact reaches this page:
   * everyone here is reachable, so the chip said the same thing on every row.
   * Whether a colleague pitched them last month does not.
   */
  lastContact: LastContact | null;
}

export interface TierFirm {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  type: string;
  aum: string;
  countries: string[];
  metals: string[];
  /** The questions we could not answer — shown on the card as the reason. */
  gaps: string[];
  /**
   * The same fields the Investors tab filters on, keyed the same way, so the
   * filter bar here is the one from that tab rather than a second version of
   * it that would drift. Values come from account_facets' own columns, not
   * from the display strings — "Mining — Lithium" is a rendering, and
   * filtering on it would offer a different option for every combination.
   */
  facets: Record<string, string[]>;
  contacts: TierContact[];
}

/** What the deal asks for, pulled off the deal record. */
export interface DealAsk {
  sectors: string[];
  minerals: string[];
  countries: string[];
  raiseUsd: number | null;
  fundFloor: number | null;
  fundCeiling: number | null;
}

const COMMODITIES = [
  "Antimony", "Coal", "Cobalt", "Copper", "Diamonds", "Gold", "Graphite",
  "Iron Ore", "Lithium", "Manganese", "Molybdenum", "Nickel", "PGM", "Potash",
  "Rare Earths", "Silver", "Tin", "Titanium", "Tungsten", "Uranium", "Vanadium", "Zinc",
];

/* Words a deck uses that are not the word in our own vocabulary. */
const ALIASES: Record<string, string> = {
  ree: "Rare Earths", "rare earth": "Rare Earths", "rare earths": "Rare Earths",
  "iron": "Iron Ore", "platinum": "PGM", "palladium": "PGM",
  "met coal": "Coal", "coking coal": "Coal", "thermal coal": "Coal",
};

/**
 * Is this term actually a WORD in the text, rather than letters inside one.
 *
 * ⚠️ This function is the whole reason the mineral list is trustworthy.
 * Plain `text.includes()` read Arkveld Zero's "Clean Iron" as rare earths,
 * because GREEN contains REE — and a wrong mineral does not look wrong on
 * screen, it just quietly puts the deal in front of the wrong investors.
 * "platinum" contains "tin" and "casting" contains "tin" the same way.
 */
function namesTerm(text: string, term: string): boolean {
  return new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i")
    .test(text);
}

/* The bands as they are stored, with a midpoint to size them by. */
const AUM_BANDS: { label: string; mid: number }[] = [
  { label: "Under $100m", mid: 50e6 },
  { label: "$100m - $1bn", mid: 550e6 },
  { label: "$1bn - $10bn", mid: 5.5e9 },
  { label: "$10bn - $100bn", mid: 55e9 },
  { label: "$100bn+", mid: 200e9 },
];

/**
 * Which fund sizes can write this cheque.
 *
 * Measured on the 47 firms that tell us both their fund size and the cheque
 * they write: the smallest cheque a firm will do runs about 1-3% of its fund.
 * Two limits fall out of that, and they are the reason the range is a range:
 *
 *  FLOOR — a firm should not be putting more than about a tenth of its whole
 *    fund into one round, so a fund smaller than ten times the raise is not a
 *    realistic participant.
 *  CEILING — below roughly 0.15% of its fund a deal is not worth a partner's
 *    time, whatever the sector. That is what puts the $10bn+ houses out of a
 *    $15m round even when they are mining specialists.
 *
 * Both are deliberately generous. They are the only test here that can rule a
 * firm out outright, so they should be wrong in the direction of keeping.
 */
const FUND_FLOOR_MULTIPLE = 10;
const FUND_CEILING_MULTIPLE = 650;

/** "$15 million", "US$15M", "up to $15m" -> 15000000. Takes the first figure. */
export function parseRaise(text: string): number | null {
  const m = String(text ?? "").match(/\$\s*([\d,.]+)\s*(million|billion|mm|m|bn|b)\b/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!isFinite(n)) return null;
  const u = m[2].toLowerCase();
  return n * (u === "billion" || u === "bn" || u === "b" ? 1e9 : 1e6);
}

/** Read the deal's own fields as the thing to match against. */
export function askFromDeal(d: { sector: string; countries: string; raising: string }): DealAsk {
  const text = `${d.sector ?? ""}`.toLowerCase();

  const minerals = COMMODITIES.filter((c) => namesTerm(text, c));
  for (const [word, c] of Object.entries(ALIASES)) {
    if (namesTerm(text, word) && !minerals.includes(c)) minerals.push(c);
  }

  /* Sector is coarse on purpose. A deck says "seabed polymetallic nodules";
     our investors say "Mining". Battery & Critical Minerals rides along
     whenever the deal names a battery metal, because a firm describing itself
     that way is describing exactly these minerals. */
  const sectors: string[] = [];
  if (/mining|mineral|metal|nodule|ore|exploration/.test(text)) sectors.push("Mining");
  if (/energ|oil|gas/.test(text)) sectors.push("Energy - Oil & Gas");
  if (/renewab|solar|wind|hydrogen/.test(text)) sectors.push("Energy - Renewables");
  if (/batter|critical mineral|lithium|cobalt|nickel|graphite|rare earth|manganese/.test(text)
      || minerals.some((m) => ["Lithium", "Cobalt", "Nickel", "Graphite", "Rare Earths", "Manganese"].includes(m))) {
    sectors.push("Battery & Critical Minerals");
  }
  if (!sectors.length) sectors.push("Mining");

  const countries = String(d.countries ?? "").split(/[;,]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const raiseUsd = parseRaise(d.raising ?? "");

  return {
    sectors: [...new Set(sectors)],
    minerals,
    countries,
    raiseUsd,
    fundFloor: raiseUsd ? raiseUsd * FUND_FLOOR_MULTIPLE : null,
    fundCeiling: raiseUsd ? raiseUsd * FUND_CEILING_MULTIPLE : null,
  };
}

/** Which stored bands the deal can use. Empty if the raise could not be read. */
export function bandsFor(ask: DealAsk): string[] {
  if (!ask.fundFloor || !ask.fundCeiling) return AUM_BANDS.map((b) => b.label);
  return AUM_BANDS.filter((b) => b.mid >= ask.fundFloor! && b.mid <= ask.fundCeiling!).map((b) => b.label);
}

/**
 * The firms, tiered, each with its people.
 *
 * `issuerAccountId` is the company raising: its own staff are not investors in
 * their own round and must never appear.
 *
 * `dealRef` is the deal's REFERENCE, not its row id — that is what getDeal
 * hands back as `id`, and passing it where a uuid was expected is what broke
 * this the first time.
 */
export async function tierFirms(
  dealRef: string,
  ask: DealAsk,
  issuerAccountId: string | null,
): Promise<TierFirm[]> {
  const bands = bandsFor(ask);

  const rows = await query<{
    id: string; name: string; type: string[] | null; aum: string | null;
    countries: string[] | null; investsIn: string[] | null;
    metals: string[] | null; via: string[] | null; sectors: string[] | null;
    sectorList: string[] | null; countryNames: string[] | null;
    investsInNames: string[] | null;
  }>(
    `select a.hr_id as id, a.name, i.investor_type as type, i.aum_range as aum,
            a.countries, i.invests_in_countries as "investsIn",
            i.commodity as metals, i.invests_via as via, i.invests_in as sectors,
            i.sector as "sectorList", a.country_names as "countryNames",
            i.invests_in_country_names as "investsInNames"
     from accounts a
     join account_investor i on i.hr_id = a.hr_id
     where a.segment = 'Investors'
       and ($1::text is null or a.hr_id <> $1)
       /* Ruled out by hand on THIS deal. Subtracted at the end rather than
          folded into the tiering, because it is not a judgement about the firm
          — the same firm is untouched on every other raise. */
       and not exists (select 1 from deal_target_removals r
                       join deals d on d.id = r.deal_id
                       where d.reference = $2 and r.account_id = a.hr_id)
       and exists (select 1 from contacts c
                   where c.account_id = a.hr_id and ${contactsInScope("c")})`,
    [issuerAccountId, dealRef],
  );

  const keep: TierFirm[] = [];
  for (const r of rows) {
    const aum = r.aum ?? "";
    const via = r.via ?? [];
    const metals = r.metals ?? [];
    const sectors = r.sectors ?? [];
    /* WHERE THEY INVEST, OR WHERE THEY SIT — the wider of the two.
       An office is evidence of reach: a firm with a Sydney office will look at
       an Australian deal whether or not anyone recorded a mandate for it
       (client rule, 2026-08-24). But the researched invest list goes further —
       ADM Capital has one office, in Hong Kong, and backs deals in Australia,
       China, India, Malaysia, Singapore and Vietnam. Testing only the office
       would miss five of those six. */
    const countries = [...new Set([...(r.countries ?? []), ...(r.investsIn ?? [])])];

    /* Ruled out — the only two tests that can say no rather than "we don't know". */
    if (aum && aum !== "N/A" && !bands.includes(aum)) continue;
    if (via.length && !via.includes("Equity")) continue;

    const gaps: string[] = [];
    /* "Mining — Gold" still starts with Mining, so compare on the head of the value. */
    const heads = sectors.map((s) => s.split(" — ")[0]);
    if (!ask.sectors.some((s) => heads.includes(s))) gaps.push("sector");
    if (ask.minerals.length && !metals.some((m) => ask.minerals.includes(m))) gaps.push("minerals");
    /* A blank office is not a gap. We never recorded it; that is not evidence
       the firm is in the wrong place, and treating it as one buried two of the
       best matches on the last deal.
       Nor is it a gap when the DEAL names no countries — then geography was
       never a question, and marking every firm down for failing to answer one
       nobody asked would push a whole upload into tier two. */
    if (ask.countries.length && countries.length
        && !countries.some((c) => ask.countries.includes(c))) gaps.push("geography");
    /* N/A passes: a family office or a corporate has no filed fund size, and
       that is an answer rather than a hole. */
    if (!aum) gaps.push("fund size");
    if (!via.includes("Equity")) gaps.push("equity");

    keep.push({
      id: r.id, name: r.name, tier: Math.min(3, 1 + gaps.length) as 1 | 2 | 3,
      facets: {
        type: r.type ?? [],
        sector: r.sectorList ?? [],
        commodity: metals,
        /* One value, as a list, so every filter reads the same way. A firm
           with no band offers nothing here rather than an empty option. */
        aum: aum ? [aum] : [],
        via,
        invests_in: r.investsInNames ?? [],
        country: r.countryNames ?? [],
      },
      type: (r.type ?? []).join(", "), aum: aum || "", countries, metals, gaps, contacts: [],
    });
  }

  if (!keep.length) return [];

  const people = await query<Record<string, unknown>>(
    `select c.account_id as "accountId", c.hr_id as id,
            coalesce(nullif(c.full_name, ''), c.email) as name,
            c.job_title as "jobTitle", coalesce(c.best_email, c.email) as email,
            c.replied, c.best_email_status as status,
            ${LAST_CONTACT_COLS},
            exists (select 1 from deal_contacts dc
                    join deals d on d.id = dc.deal_id
                    where d.reference = $2 and dc.contact_id = c.hr_id) as "onDeal"
     from contacts c
     ${lastContactJoin("c.hr_id")}
     where c.account_id = any($1::text[]) and ${contactsInScope("c")}
     order by c.replied desc, c.full_name nulls last`,
    [keep.map((k) => k.id), dealRef],
  );

  const byAccount = new Map<string, TierContact[]>();
  for (const p of people) {
    const accountId = String(p.accountId);
    if (!byAccount.has(accountId)) byAccount.set(accountId, []);
    byAccount.get(accountId)!.push({
      id: String(p.id),
      name: String(p.name),
      jobTitle: (p.jobTitle as string) ?? null,
      email: String(p.email),
      replied: everReplied(p),
      status: (p.status as string) ?? null,
      onDeal: Boolean(p.onDeal),
      lastContact: lastContactFrom(p),
    });
  }
  for (const f of keep) f.contacts = byAccount.get(f.id) ?? [];

  /* Biggest relationship first inside a tier: a firm where several people have
     written back is a warmer call than one we hold a single address for. */
  return keep.sort((a, b) =>
    a.tier - b.tier ||
    b.contacts.filter((c) => c.replied).length - a.contacts.filter((c) => c.replied).length ||
    b.contacts.length - a.contacts.length ||
    a.name.localeCompare(b.name));
}
