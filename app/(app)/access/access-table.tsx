"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { STATE_LABEL, type AccessRow, type AccessState } from "@/app/lib/access";
import { addUser, revoke as revokeAccess, restore as restoreAccess } from "@/app/lib/access-actions";
import { Block } from "@/app/components/record";
import { TableHead, Button } from "@/app/components/ui";

/**
 * Who can get in, the way to let somebody in, and the way to stop them.
 *
 * A page rather than an item in the profile menu, because revoking somebody is
 * rare but consequential and needs context a dropdown cannot hold: when they
 * were added, and when they last actually signed in.
 *
 * "Last seen" is the column that earns this page. It is how you notice the
 * contractor who finished six weeks ago and still has a way into eighteen
 * thousand contacts.
 *
 * NOBODY TYPES ANYBODY ELSE'S PASSWORD HERE. Adding a person emails them a
 * link to choose their own — the obvious alternative puts the key to eighteen
 * thousand private addresses into a chat window and leaves it there.
 *
 * The screen updates before the server answers, then takes the server's word
 * for it. Revoking is one click on a rare, consequential action; making the
 * person wait on a round trip to see it register invites a second click.
 */
export function AccessTable({ rows: initial }: { rows: AccessRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<AccessRow[]>(initial);
  const [note, setNote] = useState<string | null>(null);
  const [, start] = useTransition();

  /** Move the row, run the action, and say what came back. */
  const act = (id: string, state: AccessState, run: () => Promise<{ ok: boolean; message: string }>) => {
    const before = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, state } : r)));
    setNote(null);
    start(async () => {
      const r = await run();
      setNote(r.message);
      if (!r.ok) setRows(before);   // the server refused; put the screen back
    });
  };

  const set = (id: string, state: AccessState) => {
    if (state === "revoked") act(id, state, () => revokeAccess(id));
    else act(id, state, () => restoreAccess(id));
  };

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [adding, startAdd] = useTransition();

  const add = () =>
    startAdd(async () => {
      setNote(null);
      const r = await addUser({ name, email });
      setNote(r.message);
      if (r.ok) { setName(""); setEmail(""); router.refresh(); }
    });

  const active = rows.filter((r) => r.state === "active");
  /* Revoked people stay visible with a way back — somebody who left and
     returned, or a contractor on a second engagement, should not have to be
     re-typed. "pending" and "declined" are legacy states from the old request
     form; nothing creates them now, but rows written before it was removed are
     still here and must not silently vanish off the page. */
  const closed = rows.filter((r) => r.state !== "active");

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-3.5 px-6 py-7">
      <Link href="/" className="text-micro text-ink-2 hover:text-ink">
        ← Home
      </Link>

      <Block title="Add someone">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
            <span className="text-label uppercase tracking-wide text-ink-3">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Their full name"
              className="rounded-[6px] border border-line bg-paper px-3 py-2 text-body text-ink"
            />
          </label>
          <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
            <span className="text-label uppercase tracking-wide text-ink-3">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="them@theirfirm.example"
              className="rounded-[6px] border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink"
            />
          </label>
          <Button variant="primary" disabled={adding || !name.trim() || !email.trim()} onClick={add}>
            {adding ? "Adding…" : "Add and email a link"}
          </Button>
        </div>
        <p className="mt-3 text-micro text-ink-3">
          They choose their own password from the link — you never see it, and it never
          travels through a chat window. The link lasts five days.
          Anyone at Halden Ridge signs in with Microsoft instead and does not need adding.
        </p>
      </Block>

      {note && (
        <p className="rounded-md border border-line bg-sunken px-4 py-3 text-[13px] leading-[1.5] text-ink-2">
          {note}
        </p>
      )}

      <Block title="Has access" right={<span>{active.length}</span>} flush>
        <table className="w-full text-table">
          <TableHead
            cols={["Name", "Signs in with", "Role", "Last seen", { label: "", align: "right" }]}
          />
          <tbody>
            {active.map((r, i) => (
              <tr key={r.id} className={i % 2 ? "bg-sunken/50" : ""}>
                <td className="px-4 py-[8px]">
                  <span className="font-medium text-ink">{r.name}</span>
                  <span className="ml-2 font-mono text-[12px] text-ink-2">{r.email}</span>
                </td>
                <td className="px-4 py-[8px] text-ink-2">
                  {r.kind === "microsoft" ? "Microsoft" : "Password"}
                </td>
                <td className="px-4 py-[8px] text-ink-2">{r.role}</td>
                {/* Never signed in is a different answer from a stale date. */}
                <td className={`px-4 py-[8px] ${r.lastSeen ? "text-ink-2" : "text-ink-3"}`}>
                  {r.lastSeen || "Never"}
                </td>
                <td className="px-4 py-[8px] text-right">
                  <button
                    type="button"
                    onClick={() => set(r.id, "revoked")}
                    className="text-[12.5px] font-medium text-bad hover:underline"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>

      {closed.length > 0 && (
        <Block title="No longer has access" right={<span>{closed.length}</span>} flush>
          <table className="w-full text-table">
            <TableHead cols={["Name", "", "Role", "", { label: "", align: "right" }]} />
            <tbody>
              {closed.map((r, i) => (
                <tr key={r.id} className={i % 2 ? "bg-sunken/50" : ""}>
                  <td className="px-4 py-[8px]">
                    <span className="font-medium text-ink-2">{r.name}</span>
                    <span className="ml-2 font-mono text-[12px] text-ink-3">{r.email}</span>
                  </td>
                  <td className="px-4 py-[8px] text-ink-3">{STATE_LABEL[r.state]}</td>
                  <td className="px-4 py-[8px] text-ink-3">{r.role}</td>
                  <td className="px-4 py-[8px]" />
                  <td className="px-4 py-[8px] text-right">
                    <button
                      type="button"
                      onClick={() => set(r.id, "active")}
                      className="text-[12.5px] font-medium text-accent hover:underline"
                    >
                      Give access back
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2.5 text-micro text-ink-3">
            Giving access back emails them a fresh link — revoking wiped their password,
            so there is nothing to restore them to without one.
          </p>
        </Block>
      )}

      <p className="text-micro text-ink-3">
        Only Grace and Alan see this page. Everyone at Halden Ridge signs in with Microsoft;
        this is for people outside the firm.
      </p>
    </div>
  );
}
