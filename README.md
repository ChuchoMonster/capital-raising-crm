# Capital-raising CRM

A private CRM for a small capital-raising advisory: a firm that places equity and
debt for mining and energy companies by matching each raise to the right
institutional investors, emailing them from the partners' own Outlook
mailboxes, and tracking who said yes and who passed.

It was built for a real client and is published here with their permission.
**The client is not named and every name, firm, email address, deal and figure in
this repository is fictional.** The advisory is called "Halden Ridge Advisors"
(`halden-ridge.example`) throughout, its partners are invented, and the demo
database is generated from coined word lists.

## What it does

- **Search across the book.** About 30,000 contacts at 12,000 firms (in the demo
  data), split into investors, family offices, intermediaries, companies and
  government bodies. Full-text and faceted search runs in Postgres, so the
  contact list is only reachable through a signed-in request, never as a static
  file.
- **Investor matching and tiering.** For a given raise, every investor firm is
  checked against five questions: sector, minerals, geography, fund size and
  whether it does equity. A firm is only ruled out by evidence, never by a
  blank field; tiers count how much is still unknown, not how much is
  confirmed. Mineral matching is whole-word, so "green" never counts as REE.
- **Outlook mailbox sync (Microsoft Graph).** A scheduled job reads the
  partners' sent and received mail with app-only credentials and records who
  was contacted and who replied. It is idempotent, watermarks on message time
  rather than the clock, and writes nothing it cannot prove from a message.
- **Drafting into Outlook.** The CRM writes personalised first emails and
  follow-ups (with attachments) straight into a partner's Drafts folder. It
  never sends: a person reads each one and presses Send. The conversation id
  is stored so later replies are filed against the right raise.
- **Pitch deck to deal write-up (Claude).** Upload a PowerPoint, PDF or Word
  deck and Claude drafts the deal summary, terms and highlights. Every claim
  must come back with a quote from the source, and the quote is checked against
  the document **in code** (six-word shingle overlap), not just requested in
  the prompt. Unsupported claims are dropped and listed as gaps.
- **Two-page PDF teaser.** A fixed-layout investor teaser, generated from the
  same source-checked content and drawn with `pdf-lib`, using a photograph
  pulled from the deck when one is usable.
- **Reply classification.** Replies from a firm that was actually pitched on a
  live raise are read by Claude and filed as **Accepted**, **Passed** or
  **Open**. The verdict belongs to the firm, not the person, so a colleague is
  not emailed the morning after their firm passed. Only replies that arrive
  after a pitch count, and the quoted sentence is kept as evidence.
- **Firm identification on import.** Uploaded contacts whose firm is unknown
  are classified from the web with a cited source page and sentence; no
  citation, no write. Free-email addresses get a separate pass that identifies
  the person and their employer instead.
- **Access control.** Microsoft Entra ID sign-in for staff, plus an
  invitation-only email-and-password route for outside contractors (scrypt
  hashes, single-purpose expiring links, identical refusals for every failure
  so the form cannot be used to probe the access list). A proxy gate and
  per-page guards both check the session.
- **Import and export.** CSV and .xlsx import with a column-mapping preview and
  de-duplication; CSV export of filtered lists and .xlsx export of a deal's
  matched investors.

## Architecture

```
Browser ──> Next.js App Router (React Server Components + server actions)
              │
              ├── proxy.ts               session gate in front of everything
              ├── app/(app)/*            accounts, contacts, deals, outreach,
              │                          exclusions, access pages
              ├── app/api/*              deck upload, teaser PDF, exports,
              │                          cron jobs, health check
              └── app/lib/*              all data access and integrations
                    ├── db.ts            pg pool (Postgres)
                    ├── search.ts        faceted full-text search in SQL
                    ├── tiering.ts       investor matching for a raise
                    ├── graph.ts         Microsoft Graph: read mailboxes
                    ├── graph-draft.ts   Microsoft Graph: create drafts
                    ├── mail-sync.ts     scheduled mailbox sync
                    ├── deal/            deck extraction, Claude write-up,
                    │                    claim checking, teaser, verdicts
                    ├── import/          sheet parsing, mapping, firm lookup
                    └── auth.ts          Auth.js (Entra ID + credentials)
```

- **Database:** Postgres (hosted on Supabase in production). Facet counts are
  materialised views. `demo/schema.sql` is the full
  structure.
- **Scheduled jobs:** `/api/cron/mail-sync`, `/api/cron/read-replies` and
  `/api/cron/enrich-uploads`, each protected by a shared secret and refusing to
  run without one.
- **Storage:** uploaded decks and teaser images live in Supabase Storage; the
  browser uploads large decks directly through a signed upload URL.
- **Email:** access invitations go out through Resend from a dedicated sending
  subdomain; investor email only ever goes through the partners' own Outlook.
- **Server-only boundaries:** every module that touches the database or holds
  credentials imports `server-only`, so pulling one into a client component
  fails the build.

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4,
Postgres via `pg`, Auth.js (next-auth v5), Microsoft Graph, the Anthropic
Messages API, `pdf-lib`, `unpdf`, `word-extractor` and `fflate`.

## Running it locally with the demo data

Requirements: Node 20+, and Postgres 15+ with the `pg_trgm` extension available.

```bash
npm install
cp .env.example .env.local      # the defaults point at the demo database

# create and seed the local demo database (details in demo/README.md)
export DEMO_PASSWORD=choose-a-local-password
node demo/seed.mjs
node demo/seed-deals.mjs
node demo/seed-teaser.mjs

npm run dev                     # http://localhost:3000
```

Sign in with `demo@example.com` and the `DEMO_PASSWORD` you chose. Microsoft
sign-in, mailbox sync, drafting, Claude features and file storage need real
credentials in `.env.local`; without them, searching, matching, outreach tracking and the teaser
view all work on the demo data.

The deal-naming rules have a small standalone check:

```bash
node --import ./scripts/ts-resolve.mjs --experimental-strip-types scripts/check-deal-naming.ts
```

`scripts/migrate-*.mjs` are the one-off schema migrations used in production;
the demo schema already includes them.
