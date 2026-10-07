# Marking a deal complete, and numbering a company's later raises

2026-09-02. Agreed with John.

## The two problems

A finished raise has nowhere to go. The only thing you can do to a deal today is
delete it, which takes its contact list and the record of who was emailed with
it. So a completed raise either sits on the list looking live, or it is destroyed
along with the evidence of the work done on it.

And Halden Ridge raises for the same company more than once. A second Arkveld Zero deal
six months later is a different raise, not a correction of the first, but the
system has no way to say so — two rows would both read "Arkveld Zero" and nobody
could tell which one an email went from.

## What is already there

`DealStatus` is `Live | Closing | Closed | On hold`. **Nothing has ever set any
of them.** Every deal is created `Live` by `create.ts` and stays there; there is
no button, script or upload path that assigns another. `Closed` already renders
grey in `deal-bits.tsx`, so "greyed out when complete" is styling that exists.

A deal's `title` is the company name itself — `draft.ts` asks for "the company or
project being raised for, its actual name" — so numbering acts on the name John
would recognise.

`add.ts` deliberately refuses to rename a deal when new documents arrive, on the
grounds that a live raise's link is already in sent email. That rule stands and
constrains where numbering may happen.

## Decisions

### Status is Live or Complete. Nothing else.

`Closing` and `On hold` are dropped rather than kept as dead options. A deal is
either being worked or it is done; how far the outreach has got is already the
Contacts, Emailed and Replied counts.

A migration maps any stray row — `Closed` to `Complete`, `Closing` and `On hold`
to `Live` — and reports the counts before applying. Expect zero of each.

### Completing is reversible

A completed deal offers **Reopen**. A one-click state change with no way back is
a trap, and a raise genuinely can restart.

### Greyed is not disabled

A complete row dims but stays clickable, tickable and removable. Dimming is how
you see the deal is done, not a way of taking it away.

### Reply-checking stops on a complete deal

`verdicts.ts` reads replies for live raises only. Completing a deal stops the
system asking whether an investor passed, which is right — but late replies to
that raise go unclassified. Named here because it is not obvious from the button.

### Documents can still be added to a complete deal

Already deliberate in `deal-upload.tsx`: a document can land after a raise
closes, and refusing it would send somebody to make a duplicate deal instead.
Unchanged.

### A repeat deal is numbered at creation only

Never on a document re-upload. `add.ts` does not rename and this does not change
that.

### Same company = company record, web address, or name

Any one of: the matched account, the exact web address, or the normalised name
(lowercased, punctuation and Ltd/Plc/Inc/Corp/Pty/LLC stripped).

**Name matching was John's explicit choice, made after being shown the risk that
two different firms with similar names get numbered as one.** It is far lower
harm here than on the research side: a wrong number is a visible label on a list,
not a wrong figure buried in a record, and the upload message names the deal it
matched so a wrong match is seen while the person is still standing there.

### The name is `Arkveld Zero - Deal #2`

The first deal keeps its plain name. Renaming it retrospectively would change a
deal people have already been emailing about — the same objection `add.ts` makes.

### The number is one above the highest ever used

Not a count. Delete `#2` while `#3` exists and the next upload is `#4`. A number
that has already gone out in an email is never handed to a different raise.

## Shape

`app/lib/deal/naming.ts` — a pure module, no database and no server-only import,
so it can be checked directly:

- `normaliseCompany(name)` — lowercase, strip legal suffixes and punctuation.
- `baseTitle(title)` — strip a trailing ` - Deal #N` so a numbered deal still
  matches its siblings.
- `dealNumber(title)` — the N of a numbered title; 1 when there is none.
- `nextDealName(title, siblings)` — the name the new deal takes.

`create.ts` calls it before insert, having first found the sibling deals by
account, website or normalised name. The result message names the match.

`actions.ts` gains `setDealStatus(refs, status)` behind `requireUser()`,
revalidating `/deals`, `/outreach` and `/`.

## Verification

The project has no test framework. `scripts/check-deal-naming.mjs` exercises
`naming.ts` against the cases that matter: a first deal, a second, a third, a gap
left by a deletion, a legal-suffix difference, and two genuinely different
companies that must not be numbered together.
