/**
 * Check the repeat-deal naming, against the cases that would actually go wrong.
 *
 *   node --import ./scripts/ts-resolve.mjs --experimental-strip-types \
 *        scripts/check-deal-naming.ts
 *
 * The project has no test framework, and the naming rules are the part of this
 * feature with judgement in them: which deals count as the same company, and
 * which number the next raise takes. A wrong answer here renames a raise, so it
 * is checked rather than eyeballed.
 */
import { normaliseCompany, sameCompany, baseTitle, dealNumber, nextDealName } from "@/app/lib/deal/naming";

let failed = 0;
function check(what: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${what}${ok ? "" : `\n        got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
}

console.log("\nNaming a company's later raises\n");

// The first deal keeps its plain name — renaming it later would change a deal
// that has already been emailed about.
check("first deal is unnumbered", nextDealName("Arkveld Zero", []), "Arkveld Zero");
check("second deal", nextDealName("Arkveld Zero", [{ title: "Arkveld Zero" }]), "Arkveld Zero - Deal #2");
check("third deal",
  nextDealName("Arkveld Zero", [{ title: "Arkveld Zero" }, { title: "Arkveld Zero - Deal #2" }]),
  "Arkveld Zero - Deal #3");

// One above the highest ever used, never a count: #3 must not be handed out
// twice because #2 was deleted.
check("a deleted number is not reused",
  nextDealName("Arkveld Zero", [{ title: "Arkveld Zero" }, { title: "Arkveld Zero - Deal #3" }]),
  "Arkveld Zero - Deal #4");

// The new upload reads the company's own name off its deck, so it arrives
// unnumbered even when it is the fourth raise.
check("numbering does not stack",
  nextDealName("Arkveld Zero - Deal #2", [{ title: "Arkveld Zero" }, { title: "Arkveld Zero - Deal #2" }]),
  "Arkveld Zero - Deal #3");

console.log("\nRecognising the same company\n");

const same = sameCompany;
check("legal suffix ignored", same("Arkveld Zero Ltd", "Arkveld Zero"), true);
check("stacked suffixes ignored", same("Arkveld Zero Resources Limited", "Arkveld Zero"), true);
check("punctuation and case ignored", same("arkveld-zero", "Arkveld Zero"), true);
check("a numbered deal matches its siblings", same("Arkveld Zero - Deal #2", "Arkveld Zero"), true);

// The risk John accepted with name matching. These must stay apart.
check("different companies stay apart", same("Arkveld Zero", "Arkveld 25"), false);
check("a longer name is not the same company", same("Arkveld Zero", "Arkveld Zero Metals"), false);
// A name made only of the words we strip reduces to nothing. Two such deals
// are two raises, not one company — so empty must never match empty.
check("an unusable name matches nothing", same("Holdings Ltd", "Group Limited"), false);
check("an unusable name does not match itself", same("Holdings", "Holdings"), false);

console.log("\nReading a number back\n");
check("plain title is the first", dealNumber("Arkveld Zero"), 1);
check("numbered title", dealNumber("Arkveld Zero - Deal #4"), 4);
check("base title strips the number", baseTitle("Arkveld Zero - Deal #4"), "Arkveld Zero");
check("base title leaves a plain one alone", baseTitle("Arkveld Zero"), "Arkveld Zero");

console.log(failed ? `\n${failed} FAILED\n` : "\nAll good.\n");
process.exit(failed ? 1 : 0);
