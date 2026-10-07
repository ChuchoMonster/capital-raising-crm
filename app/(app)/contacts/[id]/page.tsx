import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordActions } from "@/app/components/record-actions";
import { getContact, getAccount, getAccountContacts } from "@/app/lib/store";
import { SegmentChip, StatusChip, RepliedChip, TableHead } from "@/app/components/ui";
import { lastContactValue, LastContactSub } from "@/app/components/last-contact";
import {
  Card,
  RecordHero,
  BackLink,
  Signal,
  SignalRow,
  segAccent,
  cardsFor,
  FieldCard,
} from "@/app/components/record";
import { TypeIcon, IconMail, IconList, IconReply } from "@/app/components/record-icons";
import { CopyButton } from "@/app/components/copy-button";
import { backHref } from "@/app/lib/back-link";
import { isSetAside } from "@/app/lib/scope";

/**
 * One person, laid out like the account record: a hero, a strip of signals,
 * then cards.
 *
 * Deliberately absent: the JOB TITLE (client, 2026-08-18 — we have no reliable
 * way to acquire it yet, and a column of dashes is worse than no column); the
 * taxonomy Role, which only repeated the segment; the country, which is the
 * firm's and belongs on the company page; and the dead original address, since
 * the live one is what you would send to.
 *
 * The firm's own enrichment sits in ONE card here rather than the two the
 * account page splits it into — on a person's page the firm is context.
 */
export default async function ContactPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const back = (await searchParams).back;
  const p = await getContact(id);
  if (!p) notFound();

  /* Someone set aside was reached from /exclusions, and sending them "back" to
     /contacts would land them on a list this person is not on — a dead end
     that reads as the record having disappeared. Both destinations are still
     fixed in code; which one is chosen comes from the row, not from the URL. */
  const setAside = isSetAside(p);
  /* Back to the list they came from, search and filters intact — see
     lib/back-link. The path is fixed here; only the query survives. */
  const backTo = backHref(setAside ? "/exclusions" : "/contacts", back);

  const company = p.companyId ? await getAccount(p.companyId) : null;
  const colleagues = p.companyId
    ? (await getAccountContacts(p.companyId)).filter((x) => x.id !== p.id)
    : [];
  const secondaries = p.secondary.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const accent = segAccent(p.segment);

  const type =
    p.fields["Investor Type"] || p.fields["Industry"] || p.fields["Intermediary Type"] ||
    p.fields["Entity Kind"] || "";

  const STATUS_WORD: Record<string, string> = {
    deliverable: "Deliverable",
    unknown: "Catch-all — unproven",
    invalid: "Undeliverable",
  };

  // One card, so the firm's profile and its money read as a single block.
  const { profile, money } = cardsFor(p.segment);
  const firmScalars = [...profile.scalars, ...(money?.scalars ?? [])];
  const firmLists = [...profile.lists, ...(money?.lists ?? [])];

  return (
    <>
      <RecordHero
        back={<BackLink href={backTo}>{setAside ? "Exclusions" : "Contacts"}</BackLink>}
        name={p.name}
        subtitle={
          /* Job title, then where the PERSON is — which is not where the firm
             is. A Sydney banker at a New York firm reads Sydney, and that is
             the useful fact when you are deciding when to call. */
          <span className="flex flex-wrap items-center gap-x-2">
            {p.jobTitle || (
              <span className="text-white/45">No job title recorded</span>
            )}
            {p.personLocation ? (
              <>
                <span className="text-white/30">·</span>
                <span className="text-white/70">{p.personLocation}</span>
              </>
            ) : null}
          </span>
        }
        website={
          company ? (
            <Link
              href={`/accounts/${company.id}`}
              className="text-[15px] text-white underline decoration-white/45 underline-offset-[5px] transition-colors hover:decoration-white"
            >
              {company.name}
            </Link>
          ) : (
            <span className="text-[15px] text-white/55">No company recorded</span>
          )
        }
        chip={<SegmentChip segment={p.segment} />}
        actions={
          /* Nothing to do with somebody set aside. Both actions run through
             resolveSelection, which scopes them — so on one of these records
             "Add to deal" reports nothing selected and Export hands back an
             empty file. Offering a button that is guaranteed to do nothing is
             worse than offering none. */
          setAside ? null : (
            <>
              {/* No drafting from here — an email is only ever composed from
                  inside a deal, so the list-building and the sending stay
                  separate steps. */}
              <RecordActions id={p.id} kind="contacts" />
            </>
          )
        }
      />

      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 py-7">
        <SignalRow>
          <Signal
            accent={accent}
            icon={<IconMail />}
            label="Email"
            action={<CopyButton value={p.bestEmail} />}
            value={
              <a
                href={`mailto:${p.bestEmail}`}
                title={p.bestEmail}
                className="hover:underline"
              >
                {p.bestEmail}
              </a>
            }
            sub={STATUS_WORD[p.status] ?? "Not yet checked"}
          />
          {/* Was "Relationship" (replied yes/no). Last contact says the same
              and three things more: when, which deal, and who sent it. */}
          <Signal
            accent={accent}
            icon={<IconReply />}
            label="Last contact"
            value={lastContactValue(p.lastContact)}
            sub={<LastContactSub last={p.lastContact} />}
          />
          <Signal
            accent={accent}
            icon={<IconList />}
            label="Mailing list"
            value={p.inMailchimp ? "On the Mailchimp list" : "Not on the list"}
            sub={
              secondaries.length
                ? `${secondaries.length} other ${secondaries.length === 1 ? "address" : "addresses"}`
                : undefined
            }
          />
          <Signal
            accent={accent}
            icon={<TypeIcon value={type} />}
            label={p.segment === "Business" ? "Industry" : "Type"}
            value={type || <span className="text-ink-3">Not recorded</span>}
            sub={company?.countriesDisplay || company?.countries || undefined}
          />
        </SignalRow>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
          <FieldCard
            title={company ? `${company.name} — ${profile.title.toLowerCase()}` : profile.title}
            fields={p.fields}
            scalars={firmScalars}
            lists={firmLists}
            span="lg:col-span-12"
            wide
            extra={
              /* Same four-column grid as the fields above, so Contact owner
                 lines up under the second column rather than floating. */
              <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="min-w-0">
                <dt className="text-label uppercase tracking-wide text-ink-3">Secondary emails</dt>
                <dd className="mt-1">
                  {secondaries.length ? (
                    <span className="flex flex-wrap gap-x-5 gap-y-1">
                      {secondaries.map((e) => (
                        <a
                          key={e}
                          href={`mailto:${e}`}
                          className="break-all font-mono text-[13px] text-accent hover:underline"
                        >
                          {e}
                        </a>
                      ))}
                    </span>
                  ) : (
                    <span className="text-body text-ink-3" title="We haven't found any">
                      —
                    </span>
                  )}
                </dd>
                </div>
                {/* Moved here from the old Relationship box, which Last
                    contact replaced. */}
                <div className="min-w-0">
                  <dt className="text-label uppercase tracking-wide text-ink-3">Contact owner</dt>
                  <dd className="mt-1 text-body text-ink-2">
                    {p.owner || <span className="text-ink-3">—</span>}
                  </dd>
                </div>
              </div>
            }
          />

          {company && colleagues.length > 0 && (
            <Card
              title={`Others at ${company.name}`}
              right={<span>{colleagues.length}</span>}
              span="lg:col-span-12"
              flush
            >
              <table className="w-full text-table">
                <TableHead
                  light
                  cols={["Name", "Job title", "Email", { label: "Ever replied?", align: "right" }]}
                />
                <tbody>
                  {/* Capped — the largest company holds well over a hundred. */}
                  {colleagues.slice(0, 10).map((c, i) => (
                    <tr key={c.id} className={i % 2 ? "bg-sunken/50" : ""}>
                      <td className="px-4 py-[7px]">
                        <Link
                          href={`/contacts/${c.id}`}
                          className={`inline-flex items-center gap-2 text-accent hover:underline ${
                            c.nameInferred ? "italic" : ""
                          }`}
                        >
                          <StatusChip status={c.status} bare />
                          {c.name}
                        </Link>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-[7px] text-ink-2" title={c.jobTitle}>
                        {c.jobTitle || <span className="text-ink-3">—</span>}
                      </td>
                      <td className="px-4 py-[7px] font-mono text-[12.5px] text-ink-2">
                        {c.bestEmail}
                      </td>
                      <td className="px-4 py-[7px] text-right">
                        <RepliedChip replied={c.replied} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {colleagues.length > 10 && (
                <div className="border-t border-line px-5 py-2.5">
                  <Link
                    href={`/accounts/${company.id}`}
                    className="text-micro text-accent hover:underline"
                  >
                    Show all {colleagues.length} →
                  </Link>
                </div>
              )}
            </Card>
          )}

          <Card title="Research note" span="lg:col-span-12">
            {p.note ? (
              <p className="max-w-[80ch] text-body text-ink-2">{p.note}</p>
            ) : (
              <p className="text-body text-ink-3">Nothing recorded.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
