/**
 * The repeat-deal naming rules. A wrong answer here renames a raise whose name
 * has already gone out in email, so the cases are the ones that would go wrong.
 * (Formerly scripts/check-deal-naming.ts.)
 */
import { describe, it, expect } from "vitest";
import { sameCompany, baseTitle, dealNumber, nextDealName, normaliseCompany } from "@/app/lib/deal/naming";

describe("naming a company's later raises", () => {
  it("leaves the first deal unnumbered", () => {
    expect(nextDealName("Arkveld Zero", [])).toBe("Arkveld Zero");
  });

  it("numbers the second and third", () => {
    expect(nextDealName("Arkveld Zero", [{ title: "Arkveld Zero" }])).toBe("Arkveld Zero - Deal #2");
    expect(nextDealName("Arkveld Zero", [{ title: "Arkveld Zero" }, { title: "Arkveld Zero - Deal #2" }]))
      .toBe("Arkveld Zero - Deal #3");
  });

  it("never reuses a deleted number — one above the highest, not a count", () => {
    expect(nextDealName("Arkveld Zero", [{ title: "Arkveld Zero" }, { title: "Arkveld Zero - Deal #3" }]))
      .toBe("Arkveld Zero - Deal #4");
  });

  it("does not stack numbers when the upload already carries one", () => {
    expect(nextDealName("Arkveld Zero - Deal #2", [{ title: "Arkveld Zero" }, { title: "Arkveld Zero - Deal #2" }]))
      .toBe("Arkveld Zero - Deal #3");
  });
});

describe("recognising the same company", () => {
  it("ignores legal suffixes, stacked ones too", () => {
    expect(sameCompany("Arkveld Zero Ltd", "Arkveld Zero")).toBe(true);
    expect(sameCompany("Arkveld Zero Resources Limited", "Arkveld Zero")).toBe(true);
  });

  it("ignores punctuation and case", () => {
    expect(sameCompany("arkveld-zero", "Arkveld Zero")).toBe(true);
  });

  it("matches a numbered deal to its siblings", () => {
    expect(sameCompany("Arkveld Zero - Deal #2", "Arkveld Zero")).toBe(true);
  });

  it("keeps different companies apart, including a longer name", () => {
    expect(sameCompany("Arkveld Zero", "Arkveld 25")).toBe(false);
    expect(sameCompany("Arkveld Zero", "Arkveld Zero Metals")).toBe(false);
  });

  it("strips a suffix word only from the end of the name", () => {
    expect(normaliseCompany("Corp Diamonds")).toBe("corpdiamonds");
  });

  it("never matches a name made only of suffix words, not even to itself", () => {
    expect(sameCompany("Holdings Ltd", "Group Limited")).toBe(false);
    expect(sameCompany("Holdings", "Holdings")).toBe(false);
  });
});

describe("reading a number back", () => {
  it("treats a plain title as the first raise", () => {
    expect(dealNumber("Arkveld Zero")).toBe(1);
  });

  it("reads a numbered title", () => {
    expect(dealNumber("Arkveld Zero - Deal #4")).toBe(4);
  });

  it("strips the number for the base title and leaves a plain one alone", () => {
    expect(baseTitle("Arkveld Zero - Deal #4")).toBe("Arkveld Zero");
    expect(baseTitle("Arkveld Zero")).toBe("Arkveld Zero");
  });
});
