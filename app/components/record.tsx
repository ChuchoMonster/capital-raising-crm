import type { ReactNode } from "react";
import { Field, prettyList } from "@/app/components/ui";

/**
 * The shared furniture of a record page.
 *
 * Everything is on the page — no tabs (client, 2026-08-14). Each block is a
 * blue bar you scroll past, in the order you would read them, and an empty
 * field shows a dash rather than disappearing so a gap stays visible.
 */

/** A blue-barred block. `accent` marks the segment-specific one. */
export function Block({
  title,
  right,
  accent = false,
  flush = false,
  children,
}: {
  title: string;
  right?: ReactNode;
  accent?: boolean;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`overflow-hidden rounded-[8px] border border-head-line bg-paper ${
        accent ? "border-l-[4px] border-l-accent" : ""
      }`}
    >
      <header className="flex items-center gap-3 bg-head px-4 py-[9px]">
        <h2 className="text-[13px] font-semibold text-head-ink">{title}</h2>
        {right && <div className="ml-auto text-[12px] text-white/70">{right}</div>}
      </header>
      <div className={flush ? "" : "px-5 py-4"}>{children}</div>
    </section>
  );
}

/** Scalar fields, three to a row so paired values sit above one another. */
export function Grid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-3">{children}</dl>;
}

/** A list field, full width — these run long and read badly in a column. */
export function ChipField({ label, value }: { label: string; value?: string | null }) {
  const items = (value ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^n\/a$/i.test(s));

  return (
    <div className="min-w-0">
      <dt className="text-label uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-1.5">
        {items.length ? (
          <span className="flex flex-wrap gap-1.5">
            {items.map((s) => (
              <span
                key={s}
                className="rounded-[5px] border border-line bg-sunken px-2 py-[3px] text-[12px] text-ink-2"
              >
                {s}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-body text-ink-3" title="We haven't found this yet">
            —
          </span>
        )}
      </dd>
    </div>
  );
}

/** The header block: name, the line under it, and the actions. */
export function Identity({
  name,
  nameClass = "",
  chip,
  second,
  secondItalic = false,
  third,
  actions,
}: {
  name: string;
  nameClass?: string;
  chip?: ReactNode;
  second?: ReactNode;
  secondItalic?: boolean;
  third?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
      {/* One family, one scale, flush to the same left edge — only weight,
          italics and colour separate the three lines. */}
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <h1
          className={`flex flex-wrap items-center gap-2.5 text-[24px] font-semibold leading-[1.25] tracking-[-0.018em] ${nameClass}`}
        >
          {name}
          {chip}
        </h1>
        {second && (
          <p className={`text-[17px] leading-[1.35] ${secondItalic ? "italic text-ink-2" : ""}`}>
            {second}
          </p>
        )}
        {third && <p className="text-[17px] font-medium leading-[1.35]">{third}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** The research sentence. Not the user's note — this is why we filed them here. */
export function ResearchNote({ note }: { note: string }) {
  return (
    <Block title="Research note">
      {note ? (
        <p className="max-w-[80ch] text-body text-ink-2">{note}</p>
      ) : (
        <p className="text-body text-ink-3">Nothing recorded.</p>
      )}
    </Block>
  );
}

/**
 * The last row of every block: its long list, then the firm's locations.
 *
 * Same three columns as the rows above rather than a wider split, so Locations
 * lands under the middle column and every label in the block lines up.
 *
 * Module scope, not nested in SegmentBlock: a component declared during render
 * is a brand-new type on every pass, so React discards and rebuilds the subtree.
 */
function LastRow({
  label,
  value,
  locations,
}: {
  label: string;
  value: string;
  locations?: string;
}) {
  return (
    <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-3">
      <ChipField label={label} value={value} />
      {locations !== undefined && <ChipField label="Locations" value={locations} />}
    </dl>
  );
}

/**
 * The segment block. Scalar fields in a three-column grid so the pairs stack
 * — investor type over investment type, AUM band over the figure — then the
 * long list fields full width beneath.
 */
export function SegmentBlock({
  segment,
  fields,
  locations,
}: {
  segment: string;
  fields: Record<string, string>;
  /** Account page only — the firm's own countries, folded in here now that
   *  "About the firm" is gone. The website already sits in the header. */
  locations?: string;
}) {
  const F = (k: string) => fields[k] ?? "";
  const onAccount = locations !== undefined;


  /* All three investor segments — funds, family offices, individuals — read
     the same profile, because all three are enriched into account_investor. */
  if (INVESTOR.has(segment)) {
    return (
      <Block title="Investor profile" accent>
        <Grid>
          <Field label="Investor type" value={F("Investor Type")} />
          <Field label="AUM range" value={F("AUM Range")} />
          <Field label="Invests in countries" value={F("Invests In Countries")} />
          <Field label="Investment type" value={F("Invests Via")} />
          <Field label="AUM $" value={F("AUM $")} />
          <ChipField label="Sector focus" value={F("Invests In")} />
        </Grid>
        {/* The workbook still calls this "Holds Halden Ridge Companies"; it is the
            firm's portfolio, and that is what it should read as. */}
        <LastRow label="Portfolio companies" value={F("Holds Halden Ridge Companies")} locations={locations} />
      </Block>
    );
  }

  if (segment === "Intermediaries") {
    return (
      <Block title="Firm profile" accent>
        <Grid>
          <Field label="Intermediary type" value={F("Intermediary Type")} />
        </Grid>
        <LastRow label="Sector focus" value={F("Sector Focus")} locations={locations} />
      </Block>
    );
  }

  if (segment === "Business") {
    return (
      <Block title="Company profile" accent>
        <Grid>
          <Field label="Industry" value={F("Industry")} />
          <Field label="Stage" value={F("Stage")} />
          <Field label="HQ city" value={F("HQ City")} />
          <Field label="Lead project" value={F("Lead Project")} />
          <Field label="Study level" value={F("Study Level")} />
          <Field label="Ticker" value={F("Ticker")} />
          <Field label="Market Cap" value={F("Market Cap")} />
          <Field label="Enterprise Value" value={F("Enterprise Value")} />
          <Field label="Cash" value={F("Cash")} />
          <Field label="Cash runway" value={F("Cash Runway (mo)") && `${F("Cash Runway (mo)")} months`} />
          <Field label="Employees" value={F("Employees")} />
          <Field label="Figures as of" value={F("Financials As Of")} />
        </Grid>
        <LastRow label="Operating countries" value={F("Project Countries")} locations={locations} />
      </Block>
    );
  }

  if (segment === "Government/Strategic") {
    return (
      <Block title="Entity profile" accent>
        <Grid>
          <Field label="Entity kind" value={F("Entity Kind")} />
        </Grid>
        <LastRow label="Mandate focus" value={F("Mandate Focus")} locations={locations} />
      </Block>
    );
  }

  // Pending and anything else: no profile of its own, but on an account the
  // location and contact count still have to land somewhere.
  if (onAccount) {
    return (
      <Block title="Firm details" accent>
        <dl className="grid grid-cols-1 gap-5">
          <ChipField label="Locations" value={locations} />
        </dl>
      </Block>
    );
  }
  return null;
}

export { prettyList };

/* ══════════════════════════════════════════════════════════════════════════
   Record page furniture, second generation (2026-08-18).

   The stacked full-width blocks read as a pile on a detail page: a header card
   sitting on a profile card sitting on a table, all the same width and weight,
   with a dozen dashes in the middle of it. These lay the same content out as a
   grid, and split the profile from the money.

   Added ALONGSIDE the originals rather than replacing them, so the contact
   page keeps rendering exactly as it does today until it gets the same pass.
   ══════════════════════════════════════════════════════════════════════════ */

/** The segment's keyline colour — an account page should be recognisable as
 *  investor or company before a word of it is read. */
/** The segments enriched into account_investor: funds, family offices and
    wealthy individuals. Spelled out here rather than imported because this is
    a client component and scope.ts is server-only. */
const INVESTOR = new Set(["Investors", "Family Offices", "High Net Worth"]);

export function segAccent(segment: string): string {
  if (INVESTOR.has(segment)) return "var(--color-seg-investor)";
  if (segment === "Business") return "var(--color-seg-business)";
  if (segment === "Intermediaries") return "var(--color-seg-intermediary)";
  if (segment === "Government/Strategic") return "var(--color-seg-government)";
  return "var(--color-seg-excluded)";
}

/**
 * The record header — a photographic band, not a card.
 *
 * Same treatment as the section heroes on the list pages, using the skyline
 * from the landing page, so a record reads as part of the app rather than a
 * panel dropped on grey. The name is set in white at the display weight the
 * homepage uses; the scrim is tinted with the brand blue rather than neutral
 * black so the sky stays blue behind it.
 *
 * Back link left, actions right, name centred between them.
 */
export function RecordHero({
  image = "/img/placeholder.svg",
  back,
  name,
  subtitle,
  website,
  chip,
  actions,
}: {
  image?: string;
  back: ReactNode;
  name: string;
  /** A line between the name and the firm. On a person, their job title —
   *  which is the thing that says whether they are worth writing to. */
  subtitle?: ReactNode;
  website?: ReactNode;
  chip?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-top"
        style={{ backgroundImage: `url(${image})` }}
        aria-hidden
      />
      {/* Lighter than the list-page scrim, and blue rather than black — the
          top of this photograph is sky, and that is the colour being asked
          for. Deep enough at the foot to hold white type over the buildings. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(23,66,127,.68) 0%, rgba(20,55,108,.58) 45%, rgba(9,26,54,.82) 100%)",
        }}
        aria-hidden
      />
      <div className="relative mx-auto w-full max-w-[1180px] px-6 pb-9 pt-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">{back}</div>
          {actions && <div className="flex shrink-0 flex-wrap justify-end gap-2">{actions}</div>}
        </div>
        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          <h1 className="text-[34px] font-light leading-[1.12] tracking-tight text-white">
            {name}
          </h1>
          {subtitle && <div className="text-[15px] text-white/70">{subtitle}</div>}
          {website && <div>{website}</div>}
          {chip}
        </div>
      </div>
    </div>
  );
}

/** The back link, sized to be seen — it is the only way out of a record. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-[6px] border border-white/25 px-3 py-[7px] text-[13px] font-medium text-white/90 transition-colors hover:bg-white/12 hover:text-white"
    >
      <span aria-hidden className="text-[15px] leading-none">←</span>
      {children}
    </a>
  );
}

/**
 * The signal strip — four tiles reading the account at a glance.
 *
 * Every field here is filled for nearly every account (the type field runs
 * 88-100% across the four segments, and the last two are counts we always
 * hold), which is the whole reason these four were chosen: a strip of tiles
 * is worse than useless if half of them say "—".
 */
export function Signal({
  icon,
  label,
  value,
  sub,
  accent,
  action,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent: string;
  /** Top-right of the tile — a copy button, and nothing heavier than that. */
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-[8px] border border-line bg-paper px-4 py-3.5">
      <span
        className="mt-[1px] flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px]"
        style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className="block flex-1 text-label uppercase tracking-wide text-ink-3">{label}</span>
          {action}
        </span>
        {/* Truncated on the tile, whole on hover.
            A raise reads "Up to $15 million current Ser…" because the tile is a
            quarter of the row and the text is a sentence. Widening the tiles to
            fit the longest value would make every other one mostly empty, so the
            value stays clipped and hovering shows all of it.
            The VALUE only. The line underneath is a figure or a country list and
            already fits — repeating it in the tooltip would be noise. */}
        <span className="group/val relative mt-[3px] block">
          <span className="block truncate text-[15px] font-medium leading-[1.3] text-ink">
            {value}
          </span>
          {typeof value === "string" && value.length > 22 && (
            <span
              role="tooltip"
              className="pointer-events-none absolute left-0 top-[calc(100%+5px)] z-30 hidden w-max max-w-[320px] rounded-[6px] bg-ink px-2.5 py-1.5 text-[12.5px] font-normal leading-[1.45] text-white shadow-lg group-hover/val:block"
            >
              {value}
            </span>
          )}
        </span>
        {sub && <span className="mt-[1px] block truncate text-[12px] text-ink-3">{sub}</span>}
      </span>
    </div>
  );
}

export function SignalRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

/**
 * A card in the grid. Quieter than `Block`: a plain rule under the title
 * rather than a filled blue bar, because four of these side by side in blue
 * is a lot of blue.
 */
export function Card({
  title,
  right,
  span = "",
  flush = false,
  children,
}: {
  title: string;
  right?: ReactNode;
  span?: string;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`overflow-hidden rounded-[8px] border border-head-line bg-paper ${span}`}>
      <header className="flex items-center gap-3 bg-head px-5 py-[10px]">
        <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-head-ink">{title}</h2>
        {right && <div className="ml-auto text-[12px] text-white/70">{right}</div>}
      </header>
      <div className={flush ? "" : "px-5 py-4"}>{children}</div>
    </section>
  );
}

/** Two per row inside a card — a card is half the page, so three columns crush. */
export function Pairs({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <dl
      className={`grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 ${wide ? "lg:grid-cols-4" : ""}`}
    >
      {children}
    </dl>
  );
}

/**
 * The fields we have nothing for, named in one quiet line instead of a dozen
 * dashes.
 *
 * The original design showed every empty field as "—" so a gap stayed visible,
 * and that intent is kept: the gap is still named, just not given equal weight
 * to a real answer. On a company where five of twelve fields are known, this is
 * the single biggest thing standing between the page and looking finished.
 */
export function NotRecorded({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <p className="mt-4 border-t border-line pt-3 text-[12px] leading-[1.5] text-ink-3">
      <span className="uppercase tracking-wide">Not recorded</span>
      <span className="mx-1.5" aria-hidden>
        ·
      </span>
      {labels.join(", ")}
    </p>
  );
}

/** What each segment puts in its two cards. Left is who they are, right is
 *  the money — and a segment with no money fields simply gets no second card
 *  rather than an empty one. */
export function cardsFor(segment: string): {
  profile: {
    title: string;
    scalars: [string, string][];
    lists: [string, string][];
  };
  money?: {
    title: string;
    scalars: [string, string][];
    lists: [string, string][];
  };
} {
  if (INVESTOR.has(segment))
    return {
      profile: {
        title: "Investor profile",
        scalars: [["Investor type", "Investor Type"]],
        lists: [
          ["Sector focus", "Invests In"],
          ["Invests in countries", "Invests In Countries"],
        ],
      },
      money: {
        title: "Capital",
        scalars: [
          ["AUM range", "AUM Range"],
          ["AUM $", "AUM $"],
          ["Cheque size", "Cheque Size"],
          ["Investment type", "Invests Via"],
        ],
        lists: [["Portfolio companies", "Holds Halden Ridge Companies"]],
      },
    };

  if (segment === "Business")
    return {
      profile: {
        title: "Company profile",
        scalars: [
          ["Industry", "Industry"],
          ["Stage", "Stage"],
          ["HQ city", "HQ City"],
          ["Lead project", "Lead Project"],
          ["Study level", "Study Level"],
          ["Employees", "Employees"],
        ],
        lists: [["Operating countries", "Project Countries"]],
      },
      money: {
        title: "Financials",
        scalars: [
          ["Ticker", "Ticker"],
          ["Market cap", "Market Cap"],
          ["Enterprise value", "Enterprise Value"],
          ["Cash", "Cash"],
          ["Cash runway", "Cash Runway (mo)"],
          ["Figures as of", "Financials As Of"],
        ],
        lists: [],
      },
    };

  if (segment === "Intermediaries")
    return {
      profile: {
        title: "Firm profile",
        scalars: [["Intermediary type", "Intermediary Type"]],
        lists: [["Sector focus", "Sector Focus"]],
      },
    };

  if (segment === "Government/Strategic")
    return {
      profile: {
        title: "Entity profile",
        scalars: [["Entity kind", "Entity Kind"]],
        lists: [["Mandate focus", "Mandate Focus"]],
      },
    };

  return { profile: { title: "Firm details", scalars: [], lists: [] } };
}

/** A card of fields, with everything we have nothing for named once at the
 *  foot instead of a column of dashes. */
export function FieldCard({
  title,
  fields,
  scalars,
  lists,
  span,
  emptyNote,
  wide = false,
  extra,
}: {
  title: string;
  fields: Record<string, string>;
  scalars: [string, string][];
  lists: [string, string][];
  span?: string;
  /** Four columns instead of two, for a card that spans the page. */
  wide?: boolean;
  /** Anything that is not a plain field — rendered under them, full width. */
  extra?: ReactNode;
  /** Shown INSTEAD of a column of missing labels when the card is entirely
   *  empty. A private company has no ticker or market cap — that is an answer,
   *  not a gap, and saying so beats listing six things we will never have. */
  emptyNote?: string;
}) {
  const has = (k: string) => Boolean((fields[k] ?? "").trim());
  const shownScalars = scalars.filter(([, k]) => has(k));
  const shownLists = lists.filter(([, k]) => has(k));
  const missing = [...scalars, ...lists]
    .filter(([, k]) => !has(k))
    .map(([l]) => l);

  const empty = shownScalars.length === 0 && shownLists.length === 0;

  if (empty)
    return (
      <Card title={title} span={span}>
        <p className="text-body text-ink-2">
          {emptyNote ?? "Nothing recorded yet."}
        </p>
        {!emptyNote && <NotRecorded labels={missing} />}
      </Card>
    );

  return (
    <Card title={title} span={span}>
      {shownScalars.length > 0 && (
        <Pairs wide={wide}>
          {shownScalars.map(([label, key]) => (
            <Field
              key={key}
              label={label}
              value={
                key === "Cash Runway (mo)"
                  ? `${fields[key]} months`
                  : fields[key]
              }
            />
          ))}
        </Pairs>
      )}
      {shownLists.length > 0 && (
        <dl
          className={`grid grid-cols-1 gap-y-4 ${shownScalars.length ? "mt-4" : ""}`}
        >
          {shownLists.map(([label, key]) => (
            <ChipField key={key} label={label} value={fields[key]} />
          ))}
        </dl>
      )}
      {extra}
      <NotRecorded labels={missing} />
    </Card>
  );
}
