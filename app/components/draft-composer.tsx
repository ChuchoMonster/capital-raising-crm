"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { draftDealEmails } from "@/app/lib/deal-drafting";
import { fillFor, firstNameOf, TOKENS } from "@/app/lib/deal/merge";
import { Button, Panel } from "./ui";
import { Tick } from "./selectable-list";

interface Person {
  id: string; name: string; company: string; email: string;
  jobTitle: string; status: string; already: string;
  /** What this person's FIRM said about this raise. Passed is a warning, not a bar. */
  verdict: "Accepted" | "Passed" | null;
  /** Emailed on this deal AND the thread was recorded — both a reply needs. */
  canFollow: boolean;
}
interface Template { id: string; name: string; subject: string; body: string; kind: "first" | "follow" }
interface Doc { id: string; name: string; bytes: number }

const NAMES: Record<string, string> = {
  "alan@halden-ridge.example": "Alan",
  "grace@halden-ridge.example": "Grace",
  "peter@halden-ridge.example": "Peter",
  "ruth@halden-ridge.example": "Ruth",
};
const shortName = (m: string) => NAMES[m] ?? m.split("@")[0];
const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

/**
 * Pick a template, edit it, choose who it goes to, and put it in Outlook.
 *
 * The email box is the real email. What is typed here is what Microsoft
 * receives, and the preview underneath is the same text with one person's
 * details filled in — the first person selected, so it is never an invented
 * example. Reading a real name in a real sentence is the check that catches a
 * mistyped token before forty copies of it exist.
 *
 * Nobody who already has an unsent draft is ticked when the page opens. They
 * are still listed and can be ticked deliberately; they just are not part of a
 * second run by accident.
 */
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`rounded-[6px] border px-2.5 py-[5px] text-[13px] font-medium transition-colors ${
        on ? "border-accent bg-accent text-white" : "border-line bg-paper text-ink-2 hover:border-accent/50 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function DraftComposer({
  dealRef, dealName, templates, documents, mailboxes, people, hasTeaser,
}: {
  dealRef: string; dealName: string;
  templates: Template[]; documents: Doc[]; mailboxes: string[]; people: Person[];
  /** Whether this deal has a teaser to attach. */
  hasTeaser: boolean;
}) {
  const router = useRouter();
  const [mailbox, setMailbox] = useState(mailboxes[0] ?? "");
  const [template, setTemplate] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  /**
   * One email to everybody, or one each.
   *
   * OFF by default and staying that way. One email each is what Halden Ridge does, and
   * grouping is the exception — a few people at one firm who should see each
   * other on the thread. Defaulting the other way would put an investor's name
   * in front of a rival the first time somebody forgot to check.
   */
  /**
   * A first touch, or a reply in a thread that already exists.
   *
   * It decides three things at once — which wording is offered, who can be
   * picked, and whether Microsoft is asked for a new message or a reply — so
   * it is the FIRST choice on the page rather than a setting further down.
   */
  const [kind, setKind] = useState<"first" | "follow">("first");
  const [showCopies, setShowCopies] = useState(false);

  /**
   * Who shares an email with whom.
   *
   * A number per person: 0 means their own email, anything else is the email
   * they share. It is set by the three buttons above the list and nowhere
   * else.
   *
   * ⚠️ THERE IS DELIBERATELY NO PER-PERSON CONTROL (client, 2026-08-28). One
   * was built and removed: it offered "New shared email", which created a
   * group of one that nothing could ever join — the option to join it only
   * appeared once it already had two members. Hand-assembling groups is also
   * the wrong shape for the job. Grouping is nearly always by firm, and a
   * one-off set is done by picking just those people and sending to them.
   */
  const [inEmail, setInEmail] = useState<Record<string, number>>({});
  /**
   * WHAT GOES ON THE EMAIL, and the default is the whole point.
   *
   * A first touch carries the TEASER and not the deck. Two pages an investor
   * reads in the preview pane will get further than a 7MB file they have to
   * decide to download — and it is what stops a deck going to several hundred
   * people who have not asked for one. A follow-up is the reverse: they read
   * the teaser and replied, so the deck is what they are owed next.
   *
   * Both are only DEFAULTS. Every box can be ticked either way, and switching
   * between first touch and follow-up resets them, which is visible on screen
   * rather than something that happens on send.
   */
  const [docs, setDocs] = useState<Set<string>>(
    () => new Set(hasTeaser ? [] : documents.map((d) => d.id)),
  );
  const [useTeaser, setUseTeaser] = useState(hasTeaser);
  const [picked, setPicked] = useState<Set<string>>(
    /* Nobody whose firm has passed is ticked when the page opens, and nor is
       anybody who already has a draft waiting. Both can still be ticked on
       purpose — this flags, it does not block (client, 2026-08-31) — but
       neither should be swept into a run of forty by accident. */
    () => new Set(people.filter((p) => !p.already && p.verdict !== "Passed").map((p) => p.id)),
  );
  const [busy, startBusy] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  /* A follow-up can only go to somebody already emailed whose thread we
     recorded. They stay listed and are shown WHY they cannot be picked —
     removing them would leave a partner wondering where the deal went. */
  const pickKind = (next: "first" | "follow") => {
    setKind(next);
    /* The attachments follow the kind, because that is the choice they hang
       off. Set here rather than in an effect: an effect would also fire on the
       first render and undo a deliberate tick made before the switch. */
    if (!hasTeaser) return;
    setUseTeaser(next === "first");
    setDocs(new Set(next === "first" ? [] : documents.map((d) => d.id)));
  };

  const eligible = (p: Person) => kind === "first" || p.canFollow;
  const chosen = people.filter((p) => picked.has(p.id) && eligible(p));

  /* What will actually be created. Built once, used by the summary, the
     preview and the button, so all three cannot disagree. */
  const emails = useMemo(() => {
    const groups = new Map<number, Person[]>();
    const singles: Person[] = [];
    for (const p of chosen) {
      const n = inEmail[p.id] ?? 0;
      if (!n) { singles.push(p); continue; }
      groups.set(n, [...(groups.get(n) ?? []), p]);
    }
    /* A group of one is not a group. It becomes its own email and can be
       personalised again, which is what anybody would expect.

       The group's own NUMBER travels with it rather than its position in the
       list, so "Group by firm" can produce several emails at once and each
       keeps its members whatever else changes. */
    const shared: { n: number; members: Person[] }[] = [];
    for (const [n, members] of [...groups].sort((a, b) => a[0] - b[0])) {
      if (members.length > 1) shared.push({ n, members });
      else singles.push(...members);
    }
    return { shared, singles, count: shared.length + singles.length };
  }, [chosen, inEmail]);

  const sample = chosen[0] ?? people[0];
  /* In a shared email there is no "sample" — it is not filled in for anyone,
     so the preview shows the neutral wording rather than the first person's
     name, which is not the version that would be sent. */
  const previewGrouped = emails.shared.length > 0 && emails.singles.length === 0;
  const previewFor = previewGrouped ? null : (emails.singles[0] ?? sample);

  const templatesForKind = templates.filter((t) => t.kind === kind);
  const followable = people.filter((p) => p.canFollow).length;

  const preview = useMemo(() => {
    if (!sample) return null;
    const person = previewFor
      ? { firstName: firstNameOf(previewFor.name), fullName: previewFor.name,
          company: previewFor.company, jobTitle: previewFor.jobTitle }
      : { firstName: "", fullName: "", company: "", jobTitle: "" };
    const ctx = { deal: dealName, sector: "", sender: shortName(mailbox) };
    return {
      subject: fillFor(subject, person, ctx),
      body: fillFor(body, person, ctx),
      to: previewFor ? previewFor.email : (emails.shared[0]?.members ?? []).map((p) => p.email).join(", "),
    };
  }, [subject, body, sample, previewFor, emails, dealName, mailbox]);

  const applyTemplate = (t: Template) => {
    setTemplate(t.name);
    setSubject(t.subject);
    setBody(t.body);
  };

  /**
   * The common case, in one click: everybody at the same firm shares an email.
   *
   * Almost every reason to group is "these three are at Tarnwick" — so it is a
   * button rather than something to be assembled by hand. Firms with only one
   * person selected are left alone, since a group of one is not a group.
   */
  const groupSelectedByFirm = () => {
    const byFirm = new Map<string, string[]>();
    for (const p of chosen) {
      const firm = (p.company || "").trim().toLowerCase();
      if (!firm) continue;
      byFirm.set(firm, [...(byFirm.get(firm) ?? []), p.id]);
    }
    const next: Record<string, number> = {};
    let n = 0;
    for (const [, ids] of byFirm) {
      if (ids.length < 2) continue;
      n++;
      for (const id of ids) next[id] = n;
    }
    setInEmail(next);
  };

  const toggle = (set: Set<string>, id: string, put: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id); else n.add(id);
    put(n);
  };

  const submit = () =>
    startBusy(async () => {
      setResult(null);
      const r = await draftDealEmails({
        dealRef, mailbox, subject, body, template, kind,
        contactIds: chosen.map((p) => p.id), documentIds: [...docs],
        teaser: useTeaser && hasTeaser,
        cc, bcc,
        groups: emails.shared.map((g) => g.members.map((p) => p.id)),
      });
      setResult({ ok: r.ok, text: r.message });
      if (r.drafted > 0) router.refresh();
    });

  const attachedMb = documents.filter((d) => docs.has(d.id)).reduce((n, d) => n + d.bytes, 0);

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
      <div className="flex flex-col gap-5 lg:col-span-7">
        <Panel title="The email">
          <div className="flex flex-col gap-4 px-5 py-4">
            {/* THE FIRST CHOICE ON THE PAGE, because it decides the other two:
                which wording is offered, and who can be written to. */}
            <div>
              <p className="text-label uppercase tracking-wide text-ink-3">This email is</p>
              <div className="mt-2 flex gap-1" role="radiogroup" aria-label="First touch or follow-up">
                <Choice on={kind === "first"} onClick={() => pickKind("first")}>A first touch</Choice>
                <Choice on={kind === "follow"} onClick={() => pickKind("follow")}>A follow-up</Choice>
              </div>
              <p className="mt-2 text-micro leading-[1.5] text-ink-2">
                {kind === "first"
                  ? "A new email to people who have not heard from us on this raise."
                  : followable === 0
                    ? "Nobody on this deal has been emailed yet, so there is nothing to follow up."
                    : `A reply in the thread already sent, so it lands under the original rather than as a new email. ${followable} ${followable === 1 ? "person can" : "people can"} be followed up.`}
              </p>
            </div>

            {templatesForKind.length > 0 && (
              <div>
                <p className="text-label uppercase tracking-wide text-ink-3">Start from</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {templatesForKind.map((t) => (
                    <Button
                      key={t.id}
                      variant={template === t.name ? "primary" : "secondary"}
                      onClick={() => applyTemplate(t)}
                    >
                      {t.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {kind === "first" ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-label uppercase tracking-wide text-ink-3">Subject</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject line"
                  className="rounded-[6px] border border-line bg-paper px-3 py-2 text-body text-ink"
                />
              </label>
            ) : (
              /* Not an empty box to leave alone — there is no subject to write.
                 Outlook takes it from the thread, and a second one would either
                 be ignored or start a new conversation. */
              <p className="rounded-[6px] border border-line bg-sunken px-3 py-2 text-micro text-ink-2">
                No subject line: a reply keeps the original one, with “Re:” in front.
              </p>
            )}

            {/* Typed by hand — a colleague, a lawyer, the company itself. Kept
                under the subject where a person expects them, and collapsed
                until wanted so the common case stays uncluttered. */}
            <div className="flex flex-col gap-2">
              {!showCopies && !cc && !bcc ? (
                <button
                  type="button"
                  onClick={() => setShowCopies(true)}
                  className="self-start text-micro font-medium text-accent hover:underline"
                >
                  Add Cc or Bcc
                </button>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-label uppercase tracking-wide text-ink-3">Cc</span>
                    <input
                      value={cc}
                      onChange={(e) => setCc(e.target.value)}
                      placeholder="name@firm.example, second@firm.example"
                      className="rounded-[6px] border border-line bg-paper px-3 py-2 text-body text-ink"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-label uppercase tracking-wide text-ink-3">Bcc</span>
                    <input
                      value={bcc}
                      onChange={(e) => setBcc(e.target.value)}
                      placeholder="name@firm.example"
                      className="rounded-[6px] border border-line bg-paper px-3 py-2 text-body text-ink"
                    />
                  </label>
                </div>
              )}
              {/* Said before the button, not discovered in a sent folder. */}
              {(cc || bcc) && emails.count > 1 && (
                <p className="text-micro text-warn">
                  Anyone copied gets {emails.count} of these — one per email being written.
                </p>
              )}
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-label uppercase tracking-wide text-ink-3">Email</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                placeholder="Write the email, or pick a template above."
                className="rounded-[6px] border border-line bg-paper px-3 py-2 font-sans text-body leading-relaxed text-ink"
              />
            </label>

            <div>
              <p className="text-label uppercase tracking-wide text-ink-3">
                Drop these in and the CRM fills them per person
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TOKENS.map((t) => (
                  <button
                    key={t.token}
                    title={t.describes}
                    onClick={() => setBody((b) => `${b}${t.token}`)}
                    className="rounded-[5px] border border-line bg-sunken px-2 py-[3px] font-mono text-[11.5px] text-ink-2 hover:bg-paper"
                  >
                    {t.token}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        {preview && (subject || body) && (
          <Panel title={previewFor ? `How it reads to ${previewFor.name}` : "How it reads to a shared email"}>
            <div className="px-5 py-4">
              <p className="text-micro text-ink-3">To {preview.to}</p>
              <p className="mt-2 text-body font-medium text-ink">{preview.subject || "(no subject)"}</p>
              <div className="mt-3 flex max-w-[70ch] flex-col gap-3">
                {preview.body.split(/\n{2,}/).filter(Boolean).map((p, i) => (
                  <p key={i} className="whitespace-pre-line text-body text-ink-2">{p}</p>
                ))}
              </div>
            </div>
          </Panel>
        )}
      </div>

      <div className="flex flex-col gap-5 lg:col-span-5">
        <Panel title="Whose Drafts folder">
          <div className="flex flex-wrap gap-2 px-5 py-4">
            {mailboxes.map((m) => (
              <Button key={m} variant={mailbox === m ? "primary" : "secondary"} onClick={() => setMailbox(m)}>
                {shortName(m)}
              </Button>
            ))}
          </div>
          <p className="px-5 pb-4 text-micro text-ink-3">
            It goes out from this mailbox, so this is who the investor sees it from.
          </p>
        </Panel>

        <Panel title="Attachments">
          {documents.length === 0 && !hasTeaser ? (
            <p className="px-5 py-4 text-body text-ink-2">
              This deal has no documents saved. Uploads made before today were not kept.
            </p>
          ) : (
            <div className="flex flex-col gap-2 px-5 py-4">
              {hasTeaser && (
                <>
                  <label className="flex items-center gap-2 text-body text-ink-2">
                    <Tick on={useTeaser} onChange={() => setUseTeaser(!useTeaser)} label="Teaser (2 pages)" />
                    <span className="truncate font-medium text-ink">Teaser</span>
                    <span className="ml-auto shrink-0 text-micro text-ink-3">2 pages</span>
                  </label>
                  {documents.length > 0 && (
                    <p className="-mt-1 mb-1 text-micro leading-[1.45] text-ink-3">
                      {kind === "first"
                        ? "The teaser goes on a first email and the deck does not — an investor who wants the deck will ask."
                        : "They have seen the teaser; a follow-up is where the deck goes."}
                    </p>
                  )}
                </>
              )}
              {documents.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-body text-ink-2">
                  <Tick on={docs.has(d.id)} onChange={() => toggle(docs, d.id, setDocs)} label={d.name} />
                  <span className="truncate">{d.name}</span>
                  <span className="ml-auto shrink-0 text-micro text-ink-3">{mb(d.bytes)}</span>
                </label>
              ))}
              {(attachedMb > 0 || (useTeaser && hasTeaser)) && (
                <p className="text-micro text-ink-3">
                  {attachedMb > 0 ? `${mb(attachedMb)} of documents` : "The teaser alone"} on each of{" "}
                  {emails.count} {emails.count === 1 ? "email" : "emails"}.
                </p>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Going to" right={<span>{emails.count} {emails.count === 1 ? "email" : "emails"}</span>}>
          {/* WHAT WILL BE WRITTEN, above the list rather than after the fact.
              With people sharing some emails and not others, the count of
              ticks no longer equals the count of emails, and that difference
              is the whole feature — so it is stated. */}
          <div className="border-b border-line px-5 py-3">
            <p className="text-body text-ink">
              {emails.count === 0 ? "Nobody selected." : (
                <>
                  {emails.count} {emails.count === 1 ? "email" : "emails"} to {chosen.length}{" "}
                  {chosen.length === 1 ? "person" : "people"}
                  {emails.shared.length > 0 && (
                    <>
                      {" — "}
                      {emails.shared.map((g, i) => (
                        <span key={g.n}>{i > 0 && ", "}{g.members.length} together</span>
                      ))}
                      {emails.singles.length > 0 && `, ${emails.singles.length} on their own`}
                    </>
                  )}
                </>
              )}
            </p>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={chosen.length < 2}
                onClick={() => groupSelectedByFirm()}
                className="rounded-[6px] border border-line bg-paper px-2.5 py-[5px] text-[12.5px] font-medium text-ink-2 transition-colors hover:border-accent/50 hover:text-ink disabled:opacity-40"
              >
                Group by firm
              </button>
              <button
                type="button"
                disabled={chosen.length < 2}
                onClick={() => setInEmail(Object.fromEntries(chosen.map((p) => [p.id, 1])))}
                className="rounded-[6px] border border-line bg-paper px-2.5 py-[5px] text-[12.5px] font-medium text-ink-2 transition-colors hover:border-accent/50 hover:text-ink disabled:opacity-40"
              >
                Group into a single email
              </button>
              {emails.shared.length > 0 && (
                <button
                  type="button"
                  onClick={() => setInEmail({})}
                  className="rounded-[6px] border border-line bg-paper px-2.5 py-[5px] text-[12.5px] font-medium text-ink-2 transition-colors hover:border-accent/50 hover:text-ink"
                >
                  One email each
                </button>
              )}
            </div>

            {emails.shared.length > 0 && (
              /* The cost of sharing an email, stated where the choice is made. */
              <p className="mt-2 text-micro leading-[1.5] text-warn">
                A shared email is not personalised — {"{First name}"} becomes “there” and {"{Company}"}
                {" "}becomes “your firm”.
              </p>
            )}
            {kind === "follow" && (
              <p className="mt-2 text-micro leading-[1.5] text-ink-2">
                Grouping does not apply to a follow-up: it replies in the threads that already exist,
                so whoever shared an email the first time shares the reply.
              </p>
            )}
          </div>

          <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto px-5 py-4">
            {people.length === 0 && (
              <p className="text-body text-ink-2">Nobody is on this deal yet.</p>
            )}
            {people.map((p) => {
              const blocked = kind === "follow" && !p.canFollow;
              const on = picked.has(p.id) && !blocked;
              return (
              <label key={p.id} className={`flex items-start gap-2 py-[3px] text-body ${blocked ? "opacity-55" : ""}`}>
                <span className="pt-[3px]">
                  <Tick on={on} onChange={() => !blocked && toggle(picked, p.id, setPicked)} label={p.name} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{p.name}</span>
                  <span className="block truncate text-micro text-ink-3">
                    {p.email}
                    {p.company && ` · ${p.company}`}
                  </span>
                  {/* Why they cannot be picked, rather than a tick that does
                      nothing. The two reasons are different problems. */}
                  {blocked && (
                    <span className="block text-micro text-ink-3">
                      {p.status === "Sent" || p.status === "Replied"
                        ? "emailed, but the thread was not recorded — nothing to reply into"
                        : "not emailed on this deal yet"}
                    </span>
                  )}
                  {p.already && (
                    <span className="block text-micro" style={{ color: "var(--color-warn)" }}>
                      already has a draft in {shortName(p.already)}&apos;s Outlook
                    </span>
                  )}
                  {/* The whole reason the verdict is on a person's row at all:
                      this is the moment the mistake would be made. */}
                  {p.verdict === "Passed" && (
                    <span className="block text-micro font-medium" style={{ color: "var(--color-bad)" }}>
                      their firm passed on this deal
                    </span>
                  )}
                  {p.verdict === "Accepted" && (
                    <span className="block text-micro font-medium" style={{ color: "var(--color-good)" }}>
                      their firm accepted — send the deck
                    </span>
                  )}
                  {!blocked && (p.status === "Sent" || p.status === "Replied") ? (
                    <span className="block text-micro text-ink-3">already emailed on this deal</span>
                  ) : null}
                </span>

              </label>
            );})}
          </div>
        </Panel>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={busy || !chosen.length || (kind === "first" && !subject.trim()) || !body.trim()}
            onClick={submit}
          >
            {busy
              ? "Writing the drafts…"
              : kind === "follow"
                ? `Reply to ${chosen.length} in ${shortName(mailbox)}'s Outlook`
                : `Put ${emails.count} ${emails.count === 1 ? "draft" : "drafts"} in ${shortName(mailbox)}'s Outlook`}
          </Button>
          <span className="text-micro text-ink-3">Nothing is sent.</span>
        </div>

        {result && (
          <p
            className="rounded-[6px] px-3 py-2 text-micro"
            style={{
              background: result.ok ? "var(--color-good-bg)" : "var(--color-bad-bg)",
              color: result.ok ? "var(--color-good)" : "var(--color-bad)",
            }}
          >
            {result.text}
          </p>
        )}
      </div>
    </div>
  );
}
