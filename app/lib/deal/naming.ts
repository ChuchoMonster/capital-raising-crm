/**
 * Naming a raise when the same company comes back.
 *
 * Halden Ridge raises for a company more than once. A second Arkveld Zero deal six
 * months after the first is a DIFFERENT raise, not a correction of it — and
 * with both rows reading "Arkveld Zero" nobody could tell which one an email
 * went from. So the later one is named "Arkveld Zero - Deal #2".
 *
 * THE FIRST DEAL KEEPS ITS PLAIN NAME. Renaming it once a second arrives would
 * change a deal colleagues have open and whose link is already in sent email —
 * the same objection `add.ts` makes about re-titling on a re-upload, and it
 * holds just as well here.
 *
 * THE NUMBER IS ONE ABOVE THE HIGHEST EVER USED, NOT A COUNT. Delete #2 while
 * #3 exists and the next upload is #4. Counting would hand out #3 again, and a
 * number that has already gone out in an email must never mean two raises.
 *
 * No database and no `server-only` here on purpose: this is the part with the
 * decisions in it, and it is checked directly by scripts/check-deal-naming.ts.
 */

/** How a numbered deal is written. Everything below is built from this one shape. */
const SUFFIX = /\s*-\s*Deal\s*#(\d+)\s*$/i;

/**
 * Trailing words that say what KIND of company something is, not which one.
 *
 * Stripped so "Arkveld Zero Ltd" and "Arkveld Zero" are recognised as the same
 * company. Only ever removed from the END — "Corp Diamonds" is a name, and a
 * blanket strip would leave "Diamonds".
 *
 * A name made ENTIRELY of these words reduces to nothing, and `sameCompany`
 * then refuses to match it against anything. That is the safe direction: a deal
 * called "Holdings" tells us nothing about which company it is for, so it takes
 * a plain name rather than being numbered into somebody else's sequence.
 */
const LEGAL = /(?:^|[\s,]+)(?:ltd|limited|plc|inc|incorporated|corp|corporation|co|company|llc|llp|lp|pty|pte|nl|nv|bv|sa|ag|gmbh|holdings?|group|resources|mining)\.?$/i;

/**
 * A company name reduced to the bit that identifies it.
 *
 * Lowercased, its legal suffixes removed, and everything that is not a letter
 * or a number thrown away — so "Arkveld-Zero Ltd." and "arkveld zero" match.
 * Digits are KEPT: "Arkveld 0" and "Arkveld Zero" are different strings and this
 * does not pretend otherwise, because guessing that they are the same company is
 * exactly the mistake that puts the wrong raise under the wrong name.
 */
export function normaliseCompany(name: string): string {
  let s = baseTitle(name).trim();
  /* Twice: "Mining Resources Ltd" has two of them stacked up. Bounded, and it
     stops as soon as a pass removes nothing. */
  for (let i = 0; i < 3; i++) {
    const next = s.replace(LEGAL, "");
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Are these two names the same company?
 *
 * EMPTY NEVER MATCHES. A name made entirely of the words this strips — "Ltd",
 * "Holdings" — reduces to nothing, and without this guard every such deal would
 * be read as the same company as every other one and numbered into a single
 * sequence. Two raises with unusable names are two raises, not one.
 */
export function sameCompany(a: string, b: string): boolean {
  const x = normaliseCompany(a);
  return x !== "" && x === normaliseCompany(b);
}

/** A title with any `- Deal #N` taken off, so a numbered deal still matches its siblings. */
export function baseTitle(title: string): string {
  return (title ?? "").replace(SUFFIX, "").trim();
}

/** Which raise this is for its company. A title with no number is the first. */
export function dealNumber(title: string): number {
  const n = Number(SUFFIX.exec(title ?? "")?.[1]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * What to call a new deal, given every deal already held for the same company.
 *
 * `siblings` is decided by the caller — matching account, matching web address
 * or matching name — because only the caller can see those. Hand it an empty
 * list and the deal keeps its plain name, which is what happens the first time.
 */
export function nextDealName(title: string, siblings: { title: string }[]): string {
  const base = baseTitle(title) || title;
  if (!siblings.length) return base;
  const highest = siblings.reduce((n, s) => Math.max(n, dealNumber(s.title)), 1);
  return `${base} - Deal #${highest + 1}`;
}
