import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordActions } from "@/app/components/record-actions";
import { getAccount, getAccountContacts } from "@/app/lib/store";
import {
  SegmentChip,
  StatusChip,
  RepliedChip,
  TableHead,
} from "@/app/components/ui";
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
import {
  TypeIcon,
  IconGlobe,
  IconPeople,
  IconReply,
} from "@/app/components/record-icons";
import { backHref } from "@/app/lib/back-link";

/**
 * One company, everything on the page.
 *
 * Laid out as a grid rather than a stack (client, 2026-08-18): a strip of
 * signal tiles, then the profile beside the money, then the people, then the
 * note. The name is a page header rather than a card, so the page opens on the
 * company instead of on another panel.
 *
 * "Draft in Outlook" is deliberately absent: you email a person, not a firm.
 */

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const backTo = backHref("/accounts", (await searchParams).back);
  const c = await getAccount(id);
  if (!c) notFound();

  const people = await getAccountContacts(c.id);
  const replied = people.filter((p) => p.replied).length;
  const accent = segAccent(c.segment);

  const type =
    c.fields["Investor Type"] ||
    c.fields["Industry"] ||
    c.fields["Intermediary Type"] ||
    c.fields["Entity Kind"] ||
    c.type ||
    "";

  const site = (c.website || c.domain || "").replace(/^https?:\/\//, "");
  const where = c.countriesDisplay || c.countries || "";
  const { profile, money } = cardsFor(c.segment);

  return (
    <>
      <RecordHero
        back={<BackLink href={backTo}>Accounts</BackLink>}
        name={c.name}
        website={
          /* The web address and the LinkedIn page sit together: plenty of firms
             here have one and not the other, and for a private fund the
             LinkedIn page is often the only thing that opens. */
          <span className="flex items-center gap-3">
            {site ? (
              <a
                href={`https://${site}`}
                target="_blank"
                rel="noreferrer"
                className="text-[15px] text-white underline decoration-white/45 underline-offset-[5px] transition-colors hover:decoration-white"
              >
                {site}
              </a>
            ) : (
              <span className="text-[15px] text-white/55">
                No website recorded
              </span>
            )}
            {c.companyLinkedin ? (
              <a
                href={c.companyLinkedin}
                target="_blank"
                rel="noreferrer"
                className="text-[15px] text-white/70 underline decoration-white/30 underline-offset-[5px] transition-colors hover:text-white hover:decoration-white"
              >
                LinkedIn
              </a>
            ) : null}
          </span>
        }
        chip={<SegmentChip segment={c.segment} />}
        actions={
          <>
            {/* No "Add to deal" — a deal's list is people, never firms. To put
                a whole firm on a deal, tick its people in Reachable contacts. */}
            <RecordActions id={c.id} kind="accounts" canAddToDeal={false} />
          </>
        }
      />

      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 py-7">
        <SignalRow>
          <Signal
            accent={accent}
            icon={<TypeIcon value={type} />}
            label={c.segment === "Business" ? "Industry" : "Type"}
            value={type || <span className="text-ink-3">Not recorded</span>}
            sub={c.fields["Stage"] || c.fields["AUM Range"] || undefined}
          />
          <Signal
            accent={accent}
            icon={<IconGlobe />}
            label="Where"
            value={where || <span className="text-ink-3">Not recorded</span>}
            sub={c.fields["HQ City"] || undefined}
          />
          <Signal
            accent={accent}
            icon={<IconPeople />}
            label="Reachable"
            value={people.length === 1 ? "1 person" : `${people.length} people`}
            sub={c.noContact ? "Role mailboxes only" : undefined}
          />
          <Signal
            accent={accent}
            icon={<IconReply />}
            label="Relationship"
            value={
              people.length === 0
                ? "No one to email"
                : replied
                  ? `${replied} ${replied === 1 ? "person has" : "people have"} replied`
                  : "No replies yet"
            }
            sub={c.owner ? `Owned by ${c.owner}` : undefined}
          />
        </SignalRow>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
          <FieldCard
            title={profile.title}
            fields={c.fields}
            scalars={profile.scalars}
            lists={profile.lists}
            span={money ? "lg:col-span-5" : "lg:col-span-12"}
          />
          {money && (
            <FieldCard
              title={money.title}
              fields={c.fields}
              scalars={money.scalars}
              lists={money.lists}
              span="lg:col-span-7"
              emptyNote={
                c.segment === "Business" && !(c.fields["Ticker"] ?? "").trim()
                  ? "Privately held — there are no public figures to show."
                  : undefined
              }
            />
          )}

          <Card
            title="Reachable contacts"
            right={
              c.inMailchimp ? (
                <span>{c.inMailchimp} in Mailchimp</span>
              ) : undefined
            }
            span="lg:col-span-12"
            flush
          >
            {people.length === 0 ? (
              <p className="px-5 py-6 text-body text-ink-2">
                No emailable person here — the only addresses were role
                mailboxes.
              </p>
            ) : (
              <table className="w-full text-table">
                <TableHead
                  light
                  cols={[
                    "Name",
                    "Job title",
                    "Email",
                    /* "Last contact" was here and has been taken out (client,
                       2026-09-01): beside "Ever replied?" the two read as the
                       same question and disagree, because one is five years of
                       imported mailbox history and the other is only what the
                       sync has watched since it was switched on. Still recorded,
                       still on the contact's own record — just not in this
                       table, where the pair confused people. */
                    { label: "Ever replied?", align: "right" },
                  ]}
                />
                <tbody>
                  {people.map((p, i) => (
                    <tr key={p.id} className={i % 2 ? "bg-sunken/50" : ""}>
                      <td className="px-4 py-[7px]">
                        <Link
                          href={`/contacts/${p.id}`}
                          className={`inline-flex items-center gap-2 text-accent hover:underline ${
                            p.nameInferred ? "italic" : ""
                          }`}
                        >
                          <StatusChip status={p.status} bare />
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-4 py-[7px] text-ink-3">
                        {p.jobTitle || "—"}
                      </td>
                      <td className="px-4 py-[7px] font-mono text-[12.5px] text-ink-2">
                        {p.bestEmail}
                      </td>
                      <td className="px-4 py-[7px] text-right">
                        <RepliedChip replied={p.replied} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Research note" span="lg:col-span-12">
            {c.note ? (
              <p className="max-w-[80ch] text-body text-ink-2">{c.note}</p>
            ) : (
              <p className="text-body text-ink-3">Nothing recorded.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
