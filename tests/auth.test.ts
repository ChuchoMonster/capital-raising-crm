import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";

/* Tokens live in Postgres; the database is replaced so the test can see what
   would be written and decide what comes back. */
vi.mock("@/app/lib/db", () => ({ query: vi.fn(), one: vi.fn() }));

import { query, one } from "@/app/lib/db";
import { hashPassword, verifyPassword, passwordProblem } from "@/app/lib/passwords";
import { issueToken, resolveToken } from "@/app/lib/tokens";
import { normaliseEmail, findAllowed, isApprover } from "@/app/lib/allowed";

const mQuery = vi.mocked(query);
const mOne = vi.mocked(one);

describe("passwords", () => {
  it("verifies the password it hashed and rejects any other", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
  });

  it("salts every hash, so the same password never hashes the same way twice", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });

  it("keeps verifying a hash made under older cost parameters", async () => {
    const salt = randomBytes(16);
    const key = scryptSync("legacy password", salt, 64, { N: 1024, r: 8, p: 1 });
    const old = `scrypt$1024$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
    expect(await verifyPassword("legacy password", old)).toBe(true);
    expect(await verifyPassword("wrong", old)).toBe(false);
  });

  it("returns false, never throws, for a missing or malformed stored value", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$10$abc")).toBe(false);
    expect(await verifyPassword("x", "scrypt$notanumber$8$1$AAAA$AAAA")).toBe(false);
  });

  it("asks for length, not character classes", () => {
    expect(passwordProblem("short")).toBe("Use at least 8 characters.");
    expect(passwordProblem("x".repeat(201))).toBe("That is longer than 200 characters.");
    expect(passwordProblem("        ")).toBe("Enter a password.");
    expect(passwordProblem("plainlowercaseletters")).toBeNull();
  });
});

describe("emailed links (tokens)", () => {
  beforeEach(() => {
    mQuery.mockReset();
    mOne.mockReset();
    mQuery.mockResolvedValue([] as never);
  });

  it.each([
    ["reset", 2 * 60 * 60 * 1000],
    ["set-password", 5 * 24 * 60 * 60 * 1000],
    ["decide", 30 * 24 * 60 * 60 * 1000],
  ] as const)("gives a %s link its agreed lifetime", async (purpose, ms) => {
    await issueToken("person-1", purpose);
    const params = mQuery.mock.calls[0][1] as unknown[];
    expect(params[2]).toBe(purpose);
    expect(params[4]).toBe(String(ms));
  });

  it("issues an unguessable, URL-safe token that is different every time", async () => {
    const a = await issueToken("person-1", "reset");
    const b = await issueToken("person-1", "reset");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("does not look up a token too short to be one", async () => {
    expect(await resolveToken("abc", "reset")).toBeNull();
    expect(mOne).not.toHaveBeenCalled();
  });

  it("looks a token up for its own purpose only, and returns null when it is unknown or expired", async () => {
    mOne.mockResolvedValue(null as never);
    const token = "a".repeat(43);
    expect(await resolveToken(token, "reset")).toBeNull();
    expect(mOne.mock.calls[0][1]).toEqual([token, "reset"]);
    expect(mOne.mock.calls[0][0]).toContain("t.expires_at > now()");
  });

  it("returns the person the token belongs to", async () => {
    mOne.mockResolvedValue({
      token: "t".repeat(43), person_id: "person-1", purpose: "set-password", approver_email: null,
      email: "jordan.pike@consultancy.example", name: "Jordan Pike", state: "active", kind: "password",
    } as never);
    expect(await resolveToken("t".repeat(43), "set-password")).toEqual({
      token: "t".repeat(43), personId: "person-1", purpose: "set-password", approverEmail: null,
      email: "jordan.pike@consultancy.example", name: "Jordan Pike", state: "active", kind: "password",
    });
  });
});

describe("who gets in", () => {
  it("reverses a Microsoft guest address at the LAST underscore", () => {
    expect(normaliseEmail("first_last_consultancy.example#EXT#@haldenridge.onmicrosoft.com"))
      .toBe("first_last@consultancy.example");
  });

  it("lower-cases and trims an ordinary address", () => {
    expect(normaliseEmail("  Demo@Example.com ")).toBe("demo@example.com");
    expect(normaliseEmail(null)).toBe("");
  });

  it("allows only listed people, with no partial access", () => {
    expect(findAllowed("DEMO@example.com")?.name).toBe("Demo User");
    expect(findAllowed("demo@example.com.evil.example")).toBeNull();
    expect(findAllowed("")).toBeNull();
  });

  it("knows who may approve access", () => {
    expect(isApprover("demo@example.com")).toBe(true);
    expect(isApprover("someone@example.com")).toBe(false);
  });
});
