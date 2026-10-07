import { describe, it, expect, vi } from "vitest";

/* store.ts opens a database pool on import; only its pure helpers are tested. */
vi.mock("@/app/lib/db", () => ({ query: vi.fn(), one: vi.fn() }));

import { fillFor, firstNameOf } from "@/app/lib/deal/merge";
import { backParam, backHref } from "@/app/lib/back-link";
import { lastContactFrom } from "@/app/lib/store";
import { isSetAside } from "@/app/lib/scope";

const CTX = { deal: "Arkveld Zero", sector: "Mining — Copper", sender: "Rowan Hale" };

describe("filling an email template", () => {
  it("greets by first name when there is one", () => {
    const out = fillFor("{Greeting}, about {Deal} — {Sender}",
      { firstName: "", fullName: "Dr. Mara Ellison", company: "Velmora Capital", jobTitle: "" }, CTX);
    expect(out).toBe("Hi Mara, about Arkveld Zero — Rowan Hale");
  });

  it('never leaves a hole: no name becomes "Hi there", no company "your firm"', () => {
    const out = fillFor("{Greeting}. Does {Company} look at {Sector}?",
      { firstName: "", fullName: "", company: "", jobTitle: "" }, CTX);
    expect(out).toBe("Hi there. Does your firm look at Mining — Copper?");
  });

  it("matches tokens regardless of case and spacing", () => {
    const p = { firstName: "Mara", fullName: "Mara Ellison", company: "", jobTitle: "" };
    expect(fillFor("{first name}|{FIRST  NAME}|{ Full Name }", p, CTX)).toBe("Mara|Mara|Mara Ellison");
  });

  it("leaves an unknown token exactly as typed so the sender sees the mistake", () => {
    const p = { firstName: "Mara", fullName: "", company: "", jobTitle: "" };
    expect(fillFor("Dear {Frist name},", p, CTX)).toBe("Dear {Frist name},");
  });

  it("does not treat an initial as a first name", () => {
    expect(firstNameOf("J. Ellison")).toBe("");
    expect(firstNameOf("Mrs Ida Wren")).toBe("Ida");
  });
});

describe("the back link — only known list state survives", () => {
  it("keeps allowed filters and drops anything else", () => {
    expect(backParam("?q=copper&segment=Investors&evil=1&f.country=AU"))
      .toBe(`?back=${encodeURIComponent("q=copper&segment=Investors&f.country=AU")}`);
  });

  it("drops an over-long value and returns nothing when nothing survives", () => {
    expect(backParam(`?q=${"x".repeat(121)}`)).toBe("");
  });

  it("fixes the destination in code, whatever the link carries", () => {
    expect(backHref("/contacts", "q=copper&redirect=https://evil.example")).toBe("/contacts?q=copper");
    expect(backHref("/accounts", undefined)).toBe("/accounts");
  });
});

describe("last contact", () => {
  it("is null for someone never written to or by", () => {
    expect(lastContactFrom({})).toBeNull();
  });

  it("compares to the minute: a reply eight minutes before our send is not an answer to it", () => {
    const lc = lastContactFrom({ sent_at: "2026-09-01T16:07:00Z", reply_at: "2026-09-01T15:59:00Z" });
    expect(lc).toMatchObject({ date: "2026-09-01", replied: false, repliedDate: "" });
  });

  it("counts someone who only ever wrote to us as a reply with no send", () => {
    expect(lastContactFrom({ reply_at: "2026-09-01T09:00:00Z" }))
      .toMatchObject({ date: "", replied: true, repliedDate: "2026-09-01" });
  });
});

describe("set-aside contacts", () => {
  it("sets aside Excluded, Pending and verified-bad addresses, but not untested ones", () => {
    expect(isSetAside({ segment: "Excluded" })).toBe(true);
    expect(isSetAside({ segment: "Pending", status: "deliverable" })).toBe(true);
    expect(isSetAside({ segment: "Investors", status: "invalid" })).toBe(true);
    expect(isSetAside({ segment: "Investors", status: "unknown" })).toBe(false);
    expect(isSetAside({ segment: "Investors", status: null })).toBe(false);
  });
});
