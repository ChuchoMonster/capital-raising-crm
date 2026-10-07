"use client";

import { useState, type ReactNode } from "react";

export interface TabDef {
  id: string;
  label: string;
  badge?: string | number;
  content: ReactNode;
}

/**
 * Tabs attached to the top of a panel, in the style of the reference design:
 * the active tab is filled in the header blue and joins the panel below it,
 * inactive tabs sit back in grey.
 */
export function Tabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  const activeIndex = tabs.findIndex((t) => t.id === current?.id);

  return (
    <div>
      <div className="flex flex-wrap gap-1" role="tablist">
        {tabs.map((t) => {
          const on = t.id === current?.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              onClick={() => setActive(t.id)}
              // Fixed height and centred content, so a count badge cannot
              // shift one tab out of line with its neighbours.
              className={`relative z-10 -mb-px flex h-[38px] items-center gap-2 rounded-t-[6px] border border-b-0 px-4 text-[13px] font-medium transition-colors ${
                on
                  ? "border-head bg-head text-head-ink"
                  : "border-head-line bg-sunken text-ink-2 hover:bg-line/60 hover:text-ink"
              }`}
            >
              <span className="leading-none">{t.label}</span>
              {t.badge !== undefined && t.badge !== "" && (
                <span
                  className={`rounded-full px-1.5 py-[2px] text-[10px] font-semibold leading-none ${
                    on ? "bg-white/25 text-white" : "bg-line text-ink-2"
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Square off only the corner the active tab actually sits against. */}
      <div
        className={`rounded-b-[8px] rounded-tr-[8px] border border-head-line bg-paper p-5 ${
          activeIndex === 0 ? "" : "rounded-tl-[8px]"
        }`}
      >
        {current?.content}
      </div>
    </div>
  );
}
