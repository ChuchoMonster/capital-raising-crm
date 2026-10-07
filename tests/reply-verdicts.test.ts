import { describe, it, expect, vi, beforeEach } from "vitest";

/* readReplies talks to three outside systems: Postgres (which replies to read,
   and where the verdict is written), Microsoft Graph (what the person wrote)
   and the Anthropic API (what it means). All three are replaced; the filing
   rules between them are the real code. */
vi.mock("@/app/lib/db", () => ({ query: vi.fn(), one: vi.fn() }));
vi.mock("@/app/lib/graph", () => ({ fetchReplyText: vi.fn() }));

import { query, one } from "@/app/lib/db";
import { fetchReplyText } from "@/app/lib/graph";
import { readReplies } from "@/app/lib/deal/verdicts";

const mQuery = vi.mocked(query);
const mOne = vi.mocked(one);
const mReply = vi.mocked(fetchReplyText);

interface Deal { id: string; ref: string; title: string; company: string }
const ARKVELD: Deal = { id: "deal-1", ref: "HR-D-001", title: "Arkveld Zero", company: "Arkveld Zero Resources" };
const BREVIK: Deal = { id: "deal-2", ref: "HR-D-002", title: "Brevik Holdings", company: "Brevik Holdings Corp" };

function candidate(deals: Deal[], threadDealId: string | null = null) {
  return {
    messageId: "msg-1", contactId: "HR-C-100", accountId: "HR-A-200",
    mailbox: "partner@halden-ridge.example", conversationId: "conv-1",
    subject: "Re: opportunity", deals, threadDealId,
  };
}

let inserts: unknown[][];
let marked: unknown[][];

function waiting(...cands: ReturnType<typeof candidate>[]) {
  mQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("with pitched")) return cands as never;
    if (sql.includes("update mail_events")) { marked.push(params); return [] as never; }
    if (sql.includes("insert into deal_verdicts")) { inserts.push(params); return [] as never; }
    return [] as never;
  });
  mOne.mockImplementation(async (_sql: string, params: unknown[] = []) =>
    ({ id: `uuid-for-${params[0]}` }) as never);
}

/** What the person wrote, and what the model says it means. */
function theyWrote(text: string, verdict: Record<string, string>) {
  mReply.mockResolvedValue({ text, subject: "Re: opportunity" });
  /* A fresh Response per call: a body can only be read once. */
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    content: [{ type: "tool_use", name: "verdict", input: { company: "", quote: "", reason: "", ...verdict } }],
  }), { status: 200 })));
}

const PASS_TEXT =
  "Thanks for sending this through. Having looked at it with the team, we will pass on this one as it is too early stage for our fund at present. Happy to look again later.";
const PASS_QUOTE = "we will pass on this one as it is too early stage for our fund at present";

beforeEach(() => {
  inserts = [];
  marked = [];
  mQuery.mockReset();
  mOne.mockReset();
  mReply.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
});

describe("readReplies — what gets filed", () => {
  it("files a supported Pass against the only raise the firm was pitched on, with the reason", async () => {
    waiting(candidate([ARKVELD]));
    theyWrote(PASS_TEXT, { verdict: "Passed", quote: PASS_QUOTE, reason: "too early stage" });
    const r = await readReplies();
    expect(r.passed).toBe(1);
    expect(inserts).toHaveLength(1);
    const [dealId, accountId, verdict, source, evidence, contactId, messageId, recordedBy] = inserts[0];
    expect({ dealId, accountId, verdict, source, contactId, messageId, recordedBy }).toEqual({
      dealId: "uuid-for-HR-D-001", accountId: "HR-A-200", verdict: "Passed", source: "email",
      contactId: "HR-C-100", messageId: "msg-1", recordedBy: "read from their reply",
    });
    expect(evidence).toBe(`${PASS_QUOTE} (too early stage)`);
  });

  it("files an Accepted with the quote alone as evidence", async () => {
    waiting(candidate([ARKVELD]));
    theyWrote("Yes please send the full data room and the model, we would like to set up a call next week with the team.",
      { verdict: "Accepted", quote: "send the full data room and the model, we would like to set up a call", reason: "ignored" });
    const r = await readReplies();
    expect(r.accepted).toBe(1);
    expect(inserts[0][2]).toBe("Accepted");
    expect(inserts[0][4]).toBe("send the full data room and the model, we would like to set up a call");
  });

  it("files nothing for an Open reply", async () => {
    waiting(candidate([ARKVELD]));
    theyWrote("I am out of the office until Monday with limited access to email.", { verdict: "Open" });
    const r = await readReplies();
    expect(r.open).toBe(1);
    expect(inserts).toHaveLength(0);
  });

  it("treats an unexpected verdict word as Open", async () => {
    waiting(candidate([ARKVELD]));
    theyWrote(PASS_TEXT, { verdict: "Maybe", quote: PASS_QUOTE });
    const r = await readReplies();
    expect(r.open).toBe(1);
    expect(inserts).toHaveLength(0);
  });

  it("refuses a verdict whose quote is not in what they wrote", async () => {
    waiting(candidate([ARKVELD]));
    theyWrote(PASS_TEXT, { verdict: "Passed", quote: "we have decided to decline every mining opportunity this year entirely" });
    const r = await readReplies();
    expect(r.open).toBe(1);
    expect(r.passed).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it("files nothing when the message can no longer be fetched", async () => {
    waiting(candidate([ARKVELD]));
    mReply.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await readReplies();
    expect(r.open).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("files nothing when the model call fails", async () => {
    waiting(candidate([ARKVELD]));
    mReply.mockResolvedValue({ text: PASS_TEXT, subject: "" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("overloaded", { status: 529 })));
    const r = await readReplies();
    expect(r.open).toBe(1);
    expect(inserts).toHaveLength(0);
  });
});

describe("readReplies — which raise a verdict belongs to", () => {
  it("leaves it unattributed when the firm was pitched on two raises and the reply names neither", async () => {
    waiting(candidate([ARKVELD, BREVIK]));
    theyWrote(PASS_TEXT, { verdict: "Passed", quote: PASS_QUOTE });
    const r = await readReplies();
    expect(r.unattributed).toBe(1);
    expect(inserts).toHaveLength(0);
    expect(r.message).toContain("1 could not be tied to a raise");
  });

  it("uses the company the reply names", async () => {
    waiting(candidate([ARKVELD, BREVIK]));
    theyWrote(PASS_TEXT, { verdict: "Passed", quote: PASS_QUOTE, company: "Brevik Holdings Corp." });
    await readReplies();
    expect(inserts[0][0]).toBe("uuid-for-HR-D-002");
  });

  it("does not attribute on a name too short to be a real match", async () => {
    waiting(candidate([ARKVELD, BREVIK]));
    theyWrote(PASS_TEXT, { verdict: "Passed", quote: PASS_QUOTE, company: "Bre" });
    const r = await readReplies();
    expect(r.unattributed).toBe(1);
  });

  it("prefers the thread the reply arrived in over a name in the text", async () => {
    waiting(candidate([ARKVELD, BREVIK], "deal-1"));
    theyWrote(PASS_TEXT, { verdict: "Passed", quote: PASS_QUOTE, company: "Brevik Holdings" });
    await readReplies();
    expect(inserts[0][0]).toBe("uuid-for-HR-D-001");
  });
});

describe("readReplies — housekeeping", () => {
  it("marks every message read, whether or not it produced a verdict", async () => {
    waiting(
      { ...candidate([ARKVELD]), messageId: "msg-a" },
      { ...candidate([ARKVELD]), messageId: "msg-b" },
    );
    theyWrote("Out of office.", { verdict: "Open" });
    const r = await readReplies();
    expect(r.looked).toBe(2);
    expect(marked).toEqual([["msg-a", "HR-C-100"], ["msg-b", "HR-C-100"]]);
  });

  it("does nothing without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const r = await readReplies();
    expect(r.message).toBe("ANTHROPIC_API_KEY is not set.");
    expect(mQuery).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to read", async () => {
    waiting();
    const r = await readReplies();
    expect(r).toMatchObject({ looked: 0, message: "No replies waiting to be read." });
  });
});
