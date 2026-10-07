"use client";

import { useSearchParams } from "next/navigation";
import { backParam } from "@/app/lib/back-link";

import Link from "next/link";
import { SegmentChip, Panel, TableHead } from "./ui";
import { Tick, SelectionBar, useRowSelection, type SelectionContext } from "./selectable-list";
import type { AccountRow } from "@/app/lib/search";

/** The accounts table, with tick-boxes. Same shape as the contacts one. */
export function AccountTable({ rows, total, ctx }: {
  rows: AccountRow[];
  total: number;
  ctx: SelectionContext;
}) {
  const sel = useRowSelection(rows.map((r) => r.id), ctx);
  const back = backParam(useSearchParams().toString());

  return (
    <>
      <SelectionBar
        count={sel.count} total={total} allMatching={sel.allMatching} onClear={sel.clear}
        selection={sel.selection} kind="accounts"
      />
      <Panel bodyClass="">
        <table className="w-full text-table">
          <TableHead
            cols={[
              { label: <Tick on={sel.pageAllTicked} onChange={sel.togglePage} label="Select this page" />, width: "36px" },
              "Company", "Type", "Segment", "Contacts",
            ]}
          />
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`${i % 2 ? "bg-sunken/50" : ""} ${sel.isTicked(r.id) ? "bg-accent/[0.07]" : ""}`}>
                <td className="px-4 py-[8px]">
                  <Tick on={sel.isTicked(r.id)} onChange={() => sel.toggle(r.id)} label={`Select ${r.name}`} />
                </td>
                <td className="px-4 py-[8px]">
                  <Link href={`/accounts/${r.id}${back}`} className="font-medium text-accent hover:underline">{r.name}</Link>
                  {r.domain && <span className="ml-2 font-mono text-[11px] text-ink-3">{r.domain}</span>}
                </td>
                <td className="px-4 py-[8px] text-ink-2">{r.type ?? ""}</td>
                <td className="px-4 py-[8px]"><SegmentChip segment={r.segment} /></td>
                <td className="px-4 py-[8px] text-ink-2">{r.contacts.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
