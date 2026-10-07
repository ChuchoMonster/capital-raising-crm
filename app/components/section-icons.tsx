/**
 * One icon per section. Drawn inline rather than pulled from a library —
 * four icons is not worth a dependency, and these match the 1.5px stroke
 * weight used everywhere else.
 */

const S = {
  width: 28,
  height: 28,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Contacts — a person. */
export function IconContacts() {
  return (
    <svg {...S} aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

/** Accounts — a building. */
export function IconAccounts() {
  return (
    <svg {...S} aria-hidden>
      <path d="M4 20h16" />
      <path d="M6 20V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15" />
      <path d="M14 20V9h3a1 1 0 0 1 1 1v10" />
      <path d="M8.5 7.5h3M8.5 11h3M8.5 14.5h3" />
    </svg>
  );
}

/** Deals — a signed agreement. A handshake does not read at 28px. */
export function IconDeals() {
  return (
    <svg {...S} aria-hidden>
      <path d="M13.5 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5" />
      <path d="m8.75 14.25 2 2 4-4.5" />
    </svg>
  );
}

/** Outreach — an envelope in flight. */
export function IconOutreach() {
  return (
    <svg {...S} aria-hidden>
      <path d="M4 6.5h16v11H4z" />
      <path d="m4 7.5 8 5.5 8-5.5" />
    </svg>
  );
}

/* ── Segment filters. Smaller, since they sit on smaller cards. ─────────── */
const T = { ...S, width: 18, height: 18 };

/** Investors — a rising line. Capital going to work. */
export function IconInvestors() {
  return (
    <svg {...T} aria-hidden>
      <path d="M4 19h16" />
      <path d="m5 15 4.5-4.5 3 3L19 7" />
      <path d="M15.5 7H19v3.5" />
    </svg>
  );
}

/** Family Offices — a house. One family's money, run from its own roof. */
export function IconFamilyOffice() {
  return (
    <svg {...T} aria-hidden>
      <path d="M3.5 10.5 12 4l8.5 6.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </svg>
  );
}

/** High Net Worth — one person. An individual investing their own money. */
export function IconIndividual() {
  return (
    <svg {...T} aria-hidden>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

/** Businesses — a mine/plant headframe. These are the operating companies. */
export function IconBusinesses() {
  return (
    <svg {...T} aria-hidden>
      <path d="M3 20h18" />
      <path d="M5 20v-7l5-3.5V20" />
      <path d="M10 13.5 15 10v10" />
      <path d="M15 12h4v8" />
      <path d="M7.5 4h5l-1 3h-3z" />
    </svg>
  );
}

/** Government — a portico. */
export function IconGovernment() {
  return (
    <svg {...T} aria-hidden>
      <path d="M3 20h18" />
      <path d="m12 3.5 8 4H4z" />
      <path d="M6.5 10.5v6M10.5 10.5v6M13.5 10.5v6M17.5 10.5v6" />
    </svg>
  );
}

/** Intermediaries — a link between two parties. */
export function IconIntermediaries() {
  return (
    <svg {...T} aria-hidden>
      <path d="M9.5 14.5 8 16a3.2 3.2 0 0 1-4.5-4.5L6 9" />
      <path d="M14.5 9.5 16 8a3.2 3.2 0 0 1 4.5 4.5L18 15" />
      <path d="m9.5 14.5 5-5" />
    </svg>
  );
}

/* ── Set aside. Same 18px weight as the segment filters. ────────────────── */

/** Exclusions — the section on the top nav. A person, crossed through. */
export function IconExclusions() {
  return (
    <svg {...S} aria-hidden>
      <circle cx="11" cy="8" r="3.5" />
      <path d="M4 20a7 7 0 0 1 11.2-5.6" />
      <path d="m15.5 17.5 5 5M20.5 17.5l-5 5" />
    </svg>
  );
}

/** Pending — a question still open. */
export function IconPending() {
  return (
    <svg {...T} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.75 9.5a2.25 2.25 0 1 1 3 2.12V13" />
      <path d="M12.75 16h-.01" />
    </svg>
  );
}

/** Bad emails — an envelope that came back. */
export function IconBadEmail() {
  return (
    <svg {...T} aria-hidden>
      <path d="M3.5 6.5h13v11h-13z" />
      <path d="m3.5 7.5 6.5 4.5 6.5-4.5" />
      <path d="m16.5 15.5 4 4M20.5 15.5l-4 4" />
    </svg>
  );
}

/** Excluded — set aside. A box with a line through it. */
export function IconExcluded() {
  return (
    <svg {...T} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6.5 6.5 11 11" />
    </svg>
  );
}
