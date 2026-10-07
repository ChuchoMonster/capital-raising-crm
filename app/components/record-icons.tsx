/**
 * Icons for the record header strip.
 *
 * Drawn inline at the same 1.5px stroke as `section-icons.tsx` rather than
 * pulled from a library, so the whole app has one drawing hand.
 *
 * `TypeIcon` picks from the account's OWN type value — a solar developer gets
 * a sun, a gold miner gets a pick. That is the point of it: the icon carries
 * information the row already holds instead of decorating the card. Where the
 * value does not match anything known it falls back to a building, which is
 * honest rather than wrong.
 */

const S = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type P = { className?: string };
const wrap = (children: React.ReactNode, className?: string) => (
  <svg {...S} className={className ?? "h-[22px] w-[22px]"} aria-hidden>
    {children}
  </svg>
);

/* ── the sector set ── */
const Pick = (p: P) => wrap(<><path d="M3 20.5 12.5 11" /><path d="M8 5.5c3.5-2 8-1.5 11 1.5-3 3-7.5 3.5-11 1.5" /><path d="M19 7c-2.5 2.5-5 4-8.5 5" /></>, p.className);
const Drop = (p: P) => wrap(<><path d="M12 3.5c3.2 4 5 6.6 5 9.2a5 5 0 0 1-10 0c0-2.6 1.8-5.2 5-9.2Z" /></>, p.className);
const Sun = (p: P) => wrap(<><circle cx="12" cy="12" r="3.8" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>, p.className);
const Battery = (p: P) => wrap(<><rect x="3" y="7.5" width="15" height="9" rx="2" /><path d="M21 10.5v3" /><path d="m10.5 9.5-2 3.2h3l-2 2.8" /></>, p.className);
const Bolt = (p: P) => wrap(<><path d="M13.5 3 5.5 13.5h5L10 21l8-10.5h-5z" /></>, p.className);
const Ingot = (p: P) => wrap(<><path d="M6 10.5h12l2.5 6H3.5z" /><path d="M8.5 6h7l1.5 4.5h-10z" /></>, p.className);
const Car = (p: P) => wrap(<><path d="M4.5 15.5h15" /><path d="M6 15.5V12l1.8-4h8.4L18 12v3.5" /><circle cx="8" cy="17" r="1.6" /><circle cx="16" cy="17" r="1.6" /></>, p.className);
/* ── the capital set ── */
const Growth = (p: P) => wrap(<><path d="M4 18 9.5 12l3.5 3.2L20 7" /><path d="M15.5 7H20v4.5" /></>, p.className);
const Columns = (p: P) => wrap(<><path d="M3.5 9.5 12 4.5l8.5 5" /><path d="M5.5 9.5v8M10 9.5v8M14 9.5v8M18.5 9.5v8" /><path d="M3.5 19.5h17" /></>, p.className);
const Home = (p: P) => wrap(<><path d="M4 10.5 12 4l8 6.5" /><path d="M6 10v9.5h12V10" /><path d="M10 19.5v-5h4v5" /></>, p.className);
const Shield = (p: P) => wrap(<><path d="M12 3.5 19 6v6c0 4-3 6.8-7 8.5-4-1.7-7-4.5-7-8.5V6z" /></>, p.className);
const Handshake = (p: P) => wrap(<><path d="M3.5 9.5 7 6h4l2 2 2-2h4l3.5 3.5" /><path d="M6.5 12.5 10 16l1.5-1.5L13 16l1.5-1.5L17.5 12" /></>, p.className);
const Landmark = (p: P) => wrap(<><path d="M12 3.5 20 8H4z" /><path d="M6.5 8v9M11 8v9M15.5 8v9" /><path d="M3.5 20.5h17" /></>, p.className);
const Building = (p: P) => wrap(<><path d="M4 20.5h16" /><path d="M6.5 20.5V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15.5" /><path d="M14.5 20.5V9.5h3a1 1 0 0 1 1 1v10" /><path d="M9 7.5h3M9 11h3M9 14.5h3" /></>, p.className);

const RULES: [RegExp, (p: P) => React.ReactElement][] = [
  [/rare earth|lithium|graphite|batter|critical mineral|storage/i, Battery],
  [/oil|gas|petroleum|hydrocarbon/i, Drop],
  [/renewab|solar|wind|clean/i, Sun],
  [/power|utilit|electric|grid/i, Bolt],
  [/steel|metals/i, Ingot],
  [/automotive|\bev\b|vehicle/i, Car],
  [/mining|minera|gold|copper|nickel|silver|uranium|coal/i, Pick],
  [/family office|hnwi|individual/i, Home],
  [/bank|cib/i, Columns],
  [/pension|sovereign/i, Shield],
  [/private equity|venture|credit|lender|hedge|asset manager|investor/i, Growth],
  [/broker|placement|advisory|merchant|trader|law|research|exchange|consultant|conference|intermediar/i, Handshake],
  [/ministry|regulator|agency|government|defense|defence|development finance|program/i, Landmark],
];

/** The icon for a type value — sector, investor type, entity kind, whatever the segment uses. */
export function TypeIcon({ value, className }: { value: string; className?: string }) {
  const hit = RULES.find(([re]) => re.test(value || ""));
  const C = hit ? hit[1] : Building;
  return <C className={className} />;
}

export const IconGlobe = (p: P) => wrap(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5Z" /></>, p.className);
export const IconPeople = (p: P) => wrap(<><circle cx="9.5" cy="8.5" r="3" /><path d="M3.5 19a6 6 0 0 1 12 0" /><path d="M16 6.2a3 3 0 0 1 0 5.6" /><path d="M17.5 14.2A5.2 5.2 0 0 1 20.5 19" /></>, p.className);
export const IconReply = (p: P) => wrap(<><path d="M9 5.5 3.5 11 9 16.5" /><path d="M3.5 11h9a8 8 0 0 1 8 8v.5" /></>, p.className);

export const IconMail = (p: P) => wrap(<><rect x="3.2" y="6" width="17.6" height="12" rx="2" /><path d="m3.6 7 8.4 5.8L20.4 7" /></>, p.className);
export const IconList = (p: P) => wrap(<><path d="M9 7h11M9 12h11M9 17h7" /><circle cx="5" cy="7" r="1.1" /><circle cx="5" cy="12" r="1.1" /><circle cx="5" cy="17" r="1.1" /></>, p.className);
