"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeFromDeal } from "@/app/lib/actions";
import { StatusChip, TableHead, Button } from "./ui";
import { OutreachChip } from "./deal-bits";
import { formatDate } from "./last-contact";
import { Tick } from "./selectable-list";

export interface DealPerson {
  contactId: string;
  personId: string;
  name: string;
  jobTitle: string;
  company: string;
  email: string;
  emailStatus: string;
  status: string;
  date: string;
  sender: string;
}

/**
 * The people on a deal, and the way to take one off.
 *
 * Removing is deliberately a tick and a separate button rather than an ✕ on
 * every row. A stray click on a row-level ✕ takes somebody off a pitch list
 * with no chance to notice, and the list is the point of the deal — so the
 * action asks to be aimed before it will fire.
 *
 * Nothing about the person is deleted. They stay in the CRM, and any email
 * that actually went to them stays on their record; only their place on this
 * list goes. That is what makes it safe to offer at all.
 */
export function DealContacts({ dealRef, rows }: { dealRef: string; rows: DealPerson[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const allOn = rows.length > 0 && picked.size === rows.length;
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(rows.map((r) => r.contactId)));

  const remove = () =>
    start(async () => {
      setNote(null);
      const r = await removeFromDeal(dealRef, [...picked]);
      setNote({ ok: r.ok, text: r.message });
      if (r.ok) { setPicked(new Set()); router.refresh(); }
    });

  const n = picked.size;

  return (
    <>
      <table className="w-full text-table">
        {/* Eight columns now, so the gutters come in from px-4 to px-3 —
            head and cells together, or the headings sit off their columns. */}
        <TableHead
          light
          tight
          cols={[
            { label: <Tick on={allOn} onChange={toggleAll} label="Select every person on this deal" />, width: "34px" },
            "Name", "Job title", "Company", "Email", "Status", "Sent", "By",
          ]}
        />
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.contactId}
              className={picked.has(r.contactId) ? "bg-accent-weak" : i % 2 ? "bg-sunken/50" : ""}
            >
              <td className="w-[34px] px-3 py-[7px]">
                <Tick on={picked.has(r.contactId)} onChange={() => toggle(r.contactId)} label={`Select ${r.name}`} />
              </td>
              <td className="px-3 py-[7px]">
                <Link
                  href={`/contacts/${r.personId}`}
                  className="inline-flex items-center gap-2 text-accent hover:underline"
                >
                  <StatusChip status={r.emailStatus} bare />
                  {r.name}
                </Link>
              </td>
              <td className="max-w-[170px] truncate px-3 py-[7px] text-ink-2" title={r.jobTitle}>
                {r.jobTitle || <span className="text-ink-3">—</span>}
              </td>
              <td className="max-w-[170px] truncate px-3 py-[7px] text-ink-2">{r.company || "—"}</td>
              <td className="px-3 py-[7px] font-mono text-[12.5px] text-ink-2">{r.email}</td>
              <td className="px-3 py-[7px]"><OutreachChip status={r.status as never} /></td>
              <td className="whitespace-nowrap px-3 py-[7px] text-micro text-ink-3">
                {r.date ? formatDate(r.date) : "—"}
              </td>
              <td className="px-3 py-[7px] text-micro text-ink-3">{r.sender || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
        <span className="text-micro text-ink-2">
          {n === 0 ? "Tick anyone you want to take off this deal" : `${n} selected`}
        </span>
        <span className="flex-1" />
        {n > 0 && (
          <>
            <Button onClick={() => setPicked(new Set())} disabled={busy}>Cancel</Button>
            <Button onClick={remove} disabled={busy}>
              {busy ? "Removing…" : `Remove ${n === 1 ? "from" : `${n} from`} this deal`}
            </Button>
          </>
        )}
      </div>

      {note && (
        <p
          className="mx-5 mb-3 rounded-[6px] px-3 py-2 text-micro"
          style={{
            background: note.ok ? "var(--color-good-bg)" : "var(--color-bad-bg)",
            color: note.ok ? "var(--color-good)" : "var(--color-bad)",
          }}
        >
          {note.text}
        </p>
      )}
    </>
  );
}
