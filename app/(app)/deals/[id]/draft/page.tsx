import { notFound } from "next/navigation";
import { getDeal, getDealContacts, emailTemplates, dealDocuments, draftedAlready, followableOn } from "@/app/lib/store";
import { getTeaser } from "@/app/lib/deal/teaser-store";
import { verdictsFor } from "@/app/lib/deal/verdicts";
import { mailboxes } from "@/app/lib/graph";
import { RecordHero, BackLink } from "@/app/components/record";
import { SegmentChip } from "@/app/components/ui";
import { DraftComposer } from "@/app/components/draft-composer";

/**
 * Writing the emails for one raise.
 *
 * Its own page rather than a panel on the deal, because this is the one screen
 * in the CRM where somebody writes something that goes to an investor under
 * their own name. It deserves the whole window and no other controls around it.
 *
 * Nothing here sends. Every email lands in a partner's Drafts folder in Outlook
 * and waits for them to read it and press Send.
 */
export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) notFound();

  const [rows, templates, documents, drafted, followable, teaser, verdicts] = await Promise.all([
    getDealContacts(deal.id),
    emailTemplates(),
    dealDocuments(deal.id),
    draftedAlready(deal.id),
    followableOn(deal.id),
    getTeaser(deal.id),
    verdictsFor(deal.id),
  ]);

  /* Everything the composer needs about a person, resolved here rather than in
     the browser. `already` is what stops a second run quietly making a second
     copy of every draft. */
  const people = rows.map((r) => ({
    id: r.contactId,
    name: r.person.name,
    company: r.person.companyName,
    email: r.person.bestEmail,
    jobTitle: r.person.jobTitle,
    status: r.status,
    already: drafted.get(r.contactId) ?? "",
    /* Emailed AND the thread was recorded — the two things a reply needs. */
    canFollow: followable.has(r.contactId),
    /* Their FIRM's answer. Resolved here so the composer does not have to know
       that a verdict is an account-level fact. */
    verdict: (r.person.companyId ? verdicts.get(r.person.companyId)?.verdict : null) ?? null,
  }));

  return (
    <>
      <RecordHero
        image="/img/placeholder.svg"
        back={<BackLink href={`/deals/${deal.id}`}>Back to {deal.name}</BackLink>}
        name="Draft an email"
        website={<span className="text-[15px] text-white/70">{deal.name}</span>}
        chip={<SegmentChip segment="Business" />}
      />
      <div className="mx-auto w-full max-w-[1180px] px-6 py-7">
        <DraftComposer
          dealRef={deal.id}
          dealName={deal.name}
          templates={templates}
          documents={documents.map((d) => ({ id: d.id, name: d.name, bytes: d.bytes }))}
          mailboxes={mailboxes()}
          people={people}
          hasTeaser={!!teaser}
        />
      </div>
    </>
  );
}
