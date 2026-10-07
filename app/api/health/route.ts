import { NextResponse } from "next/server";
import {
  getDeals, getDeal, getDealGaps, getDealContacts, dealTally,
  getOutreach, outreachTally, outreachBoard, stats,
  getAccount, getAccountContacts, getContact, lastLoadedAt,
} from "@/app/lib/store";
import {
  searchContacts, searchAccounts, segmentCounts, facetOptions,
  searchSetAside, setAsideCounts,
} from "@/app/lib/search";
import { tierFirms, askFromDeal } from "@/app/lib/tiering";
import { verdictsFor } from "@/app/lib/deal/verdicts";

/**
 * Run every question the site asks the database, and say which ones fail.
 *
 * Why this exists: on 2026-09-01 every deal page returned a server error,
 * because one query asked the deals table for a column that only exists on
 * accounts. Nothing caught it. It compiled cleanly — whether a column exists
 * is not a fact about the code, and the site and the store behind it are
 * changed separately, so the two can drift apart with no sign until somebody
 * opens the page.
 *
 * A first attempt read the queries and checked the column names by hand. It
 * PASSED on the exact bug it was written for (the broken column sat in a bare
 * list with no `from` of its own, so it did not read as a query at all) and
 * then flagged fifty things that were perfectly fine. Reading SQL with a
 * pattern is the wrong tool: this asks the real functions instead, so anything
 * that would break a page breaks this first.
 *
 * Read-only. Behind the same shared secret as the scheduled jobs, and it
 * refuses to answer at all if that secret is not set.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Check = { name: string; ok: boolean; ms: number; error?: string };

async function run(name: string, fn: () => Promise<unknown>): Promise<Check> {
  const t0 = Date.now();
  try {
    await fn();
    return { name, ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(request: Request) {
  /* Its own secret rather than the cron one, for a dull but decisive reason:
     the Vercel CLI will not hand back the value of an encrypted variable, so a
     deploy script cannot know CRON_SECRET and gets turned away by the very
     site it has just published — which looks exactly like a broken deploy. */
  const secret = process.env.HEALTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "HEALTH_SECRET is not set — refusing to run unprotected." },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Not authorised", { status: 401, headers: { "cache-control": "no-store" } });
  }

  const checks: Check[] = [];

  /* The lists, and the filter counts beside them. */
  checks.push(await run("landing", () => stats()));
  checks.push(await run("loaded at", () => lastLoadedAt()));
  checks.push(await run("contacts list", () => searchContacts({ limit: 1 })));
  checks.push(await run("contacts list, filtered", () =>
    searchContacts({ q: "a", segment: "Investors", filters: { country: ["US"] }, replied: "yes", limit: 1 })));
  checks.push(await run("contacts, never replied", () => searchContacts({ replied: "no", limit: 1 })));
  checks.push(await run("accounts list", () => searchAccounts({ limit: 1 })));
  checks.push(await run("tab counts", () => segmentCounts()));
  checks.push(await run("contact filters", () => facetOptions("Investors", "contacts")));
  checks.push(await run("account filters", () => facetOptions("Business", "accounts")));
  checks.push(await run("exclusions", () => searchSetAside({ limit: 1 })));
  checks.push(await run("exclusion counts", () => setAsideCounts()));

  /* A real record of each kind, rather than an invented id: a query can be
     perfectly valid and still fall over on the shape of an actual row. */
  const someone = await searchContacts({ limit: 1 });
  const person = someone.rows[0];
  if (person) {
    checks.push(await run("a person's record", () => getContact(person.id)));
    if (person.companyId) {
      checks.push(await run("a firm's record", () => getAccount(person.companyId!)));
      checks.push(await run("a firm's people", () => getAccountContacts(person.companyId!, 5)));
    }
  }

  /* Deals, and everything hanging off them — where the failure showed. */
  const deals = await run("deals list", () => getDeals());
  checks.push(deals);
  if (deals.ok) {
    const all = await getDeals();
    const d = all[0];
    if (d) {
      checks.push(await run("a deal", () => getDeal(d.id)));
      checks.push(await run("a deal's gaps", () => getDealGaps(d.id)));
      checks.push(await run("a deal's people", () => getDealContacts(d.id)));
      checks.push(await run("a deal's tally", () => dealTally(d.id)));
      checks.push(await run("a deal's answers", () => verdictsFor(d.id)));
      checks.push(await run("matched accounts", () =>
        tierFirms(d.id, askFromDeal(d), d.accountId)));
    }
  }
  checks.push(await run("outreach", () => getOutreach({})));
  checks.push(await run("outreach tally", () => outreachTally()));
  checks.push(await run("outreach board", () => outreachBoard()));

  const failed = checks.filter((c) => !c.ok);
  return NextResponse.json(
    /* Which version answered. Without it a check run straight after a publish
       can be told "all well" by the version that is being replaced. */
    { ok: failed.length === 0, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      ran: checks.length, failed: failed.length, checks },
    { status: failed.length ? 500 : 200, headers: { "cache-control": "no-store" } });
}
