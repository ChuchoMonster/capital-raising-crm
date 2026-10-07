"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { backParam } from "@/app/lib/back-link";
import { SegmentChip, StatusChip, Panel, TableHead } from "./ui";
import type { ContactRow } from "@/app/lib/search";

/**
 * The set-aside list. The contacts table without the tick-boxes.
 *
 * A copy rather than a flag on ContactTable, deliberately: that component's
 * whole reason to be a client component is the selection, and the selection is
 * what puts people on deals. Nothing here should be selectable, and the surest
 * way to guarantee that is for the code that selects not to be on the page.
 *
 * A name links to the person. A company does NOT: their firm is set aside too,
 * so the link would land on a page reached from nowhere else, and Halden Ridge asked for
 * people here, not firms.
 */
export function ExclusionTable({ rows }: { rows: ContactRow[] }) {
  const back = backParam(useSearchParams().toString());

  return (
    <Panel bodyClass="">
      <table className="w-full text-table">
        <TableHead cols={["Name", "Company", "Segment", "Email"]} />
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={i % 2 ? "bg-sunken/50" : ""}>
              <td className="px-4 py-[8px]">
                <Link
                  href={`/contacts/${r.id}${back}`}
                  className="inline-flex items-center gap-2 font-medium text-accent hover:underline"
                >
                  <StatusChip status={r.status ?? ""} bare />
                  {/* Two thirds have a name. The rest are shown by address
                      rather than as a blank row — the address is the only
                      thing we know about them, and it is what Halden Ridge would
                      recognise. */}
                  {r.name ?? r.email}
                </Link>
              </td>
              <td className="px-4 py-[8px] text-ink-2">
                {r.company || <span className="text-ink-3">—</span>}
              </td>
              <td className="px-4 py-[8px]"><SegmentChip segment={r.segment} /></td>
              <td className="px-4 py-[8px] font-mono text-[12px] text-ink-2">{r.email}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
