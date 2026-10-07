import type { ReactNode } from "react";
import { SEGMENT_COLOR } from "../lib/types";

/* ── Segment chip: a 3px keyline in the segment colour. Tells you what every
      other field on the row means, so it goes first. ───────────────────── */
export function SegmentChip({ segment }: { segment: string }) {
  if (!segment) return null;
  const color = SEGMENT_COLOR[segment] ?? "var(--color-seg-excluded)";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-[4px] bg-sunken px-2 py-[3px] text-micro font-medium text-ink-2"
    >
      <span className="inline-block h-[9px] w-[3px] rounded-[1px]" style={{ background: color }} />
      {segment}
    </span>
  );
}

/* ── Email status. Dot + word, never a bare colour. ─────────────────────── */
const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  deliverable: { label: "Deliverable", fg: "var(--color-good)", bg: "var(--color-good-bg)" },
  unknown: { label: "Catch-all", fg: "var(--color-warn)", bg: "var(--color-warn-bg)" },
  invalid: { label: "Invalid", fg: "var(--color-bad)", bg: "var(--color-bad-bg)" },
};

export function StatusChip({ status, bare = false }: { status: string; bare?: boolean }) {
  const s = STATUS[status];
  if (!s) {
    return bare ? null : (
      <span className="inline-flex items-center gap-1.5 text-micro text-ink-3">
        <Dot color="var(--color-null)" /> Untested
      </span>
    );
  }
  if (bare) return <Dot color={s.fg} />;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-micro font-medium"
      style={{ color: s.fg, background: s.bg }}
    >
      <Dot color={s.fg} /> {s.label}
    </span>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: color }} />;
}

/* ── Replied: a word, never a tick. "Has replied" and "never replied" are the
      difference between a relationship and a one-way pitch. ────────────── */
export function RepliedChip({ replied }: { replied: boolean }) {
  return replied ? (
    <span className="inline-flex items-center gap-1 text-micro font-medium" style={{ color: "var(--color-good)" }}>
      ✓ Has replied
    </span>
  ) : (
    <span className="text-micro text-ink-3">Never replied</span>
  );
}

/* ── Owner initials. Whose relationship this is. ─────────────────────────── */
export function OwnerChips({ owner, light = false }: { owner: string; light?: boolean }) {
  const names = owner.split(",").map((s) => s.trim()).filter(Boolean);
  if (!names.length) return null;
  return (
    <span className="inline-flex items-center gap-1.5" title={`Owner: ${names.join(", ")}`}>
      {light && <span className="text-[11px] text-white/60">Owner</span>}
      {names.map((n) => (
        <span
          key={n}
          className={`inline-flex h-[19px] w-[19px] items-center justify-center rounded-full text-[10px] font-semibold ${
            light ? "bg-white/20 text-white" : "bg-sunken text-ink-2"
          }`}
        >
          {n === "Mailchimp-only" ? "M" : n[0]}
        </span>
      ))}
    </span>
  );
}

/* Fields holding a bare figure. `1961887313229` is not a number a human reads. */
const MONEY_FIELDS = new Set([
  "AUM $", "Market Cap", "Enterprise Value", "Cash", "Cheque Size", "Last Raise",
]);

export function formatMoney(raw: string): string {
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ""));
  if (!isFinite(n) || n === 0 || /[a-z]/i.test(raw.replace(/^[A-Z]{1,3}\$?/, ""))) return raw;
  const abs = Math.abs(n);
  const [div, suffix] =
    abs >= 1e12 ? [1e12, "tn"] : abs >= 1e9 ? [1e9, "bn"] : abs >= 1e6 ? [1e6, "m"] : abs >= 1e3 ? [1e3, "k"] : [1, ""];
  const val = n / div;
  const dp = val >= 100 || suffix === "" ? 0 : val >= 10 ? 1 : 2;
  return `$${val.toFixed(dp)}${suffix}`;
}

/** Semicolon-delimited lists are how the pipeline stores multi-values. */
export function prettyList(v: string): string {
  return v.includes(";") ? v.split(";").map((s) => s.trim()).filter(Boolean).join(", ") : v;
}

/* ── Field: renders all 40+ fields, including the three empty states.
      "Not applicable" and "we haven't found this" are different answers. ── */
export function Field({ label, value }: { label: string; value?: string | null }) {
  let v = (value ?? "").trim();
  if (v && MONEY_FIELDS.has(label)) v = formatMoney(v);
  else if (v) v = prettyList(v);
  const na = /^(n\/a|not applicable)$/i.test(v);
  return (
    <div className="min-w-0">
      <dt className="text-label uppercase tracking-wide text-ink-3">{label}</dt>
      <dd
        className={
          na
            ? "text-body italic text-ink-3"
            : v
              ? "text-body text-ink"
              : "text-body text-ink-3"
        }
        title={!v ? "We haven't found this yet" : undefined}
      >
        {na ? "Not applicable" : v || "—"}
      </dd>
    </div>
  );
}

/* ── Disclosure. Native <details>, so it is keyboard- and screen-reader-
      correct for free and works before hydration.
      The collapsed preview is the whole mechanic: a row that just says
      "Financials ⌄" is a mystery box nobody opens. ─────────────────────── */
export function Disclosure({
  title,
  preview,
  children,
  defaultOpen = false,
}: {
  title: string;
  preview?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group border-b border-line last:border-b-0">
      <summary className="flex items-center gap-3 px-5 py-3 hover:bg-sunken/60">
        <span className="text-ink-3 transition-transform group-open:rotate-90">›</span>
        <span className="text-h2 shrink-0">{title}</span>
        <span className="min-w-0 flex-1 truncate text-right text-micro text-ink-2">{preview}</span>
      </summary>
      <div className="px-5 pb-5 pt-1">{children}</div>
    </details>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-line bg-paper ${className}`}>{children}</div>
  );
}

/* ── Panel: a bordered card with a solid blue header bar, in the style of the
      reference design. The bar names the section and anchors the eye; the
      border ties the whole block together. ─────────────────────────────── */
export function Panel({
  title,
  right,
  children,
  bodyClass = "p-5",
}: {
  /** Omit for a panel whose own content already carries its heading —
   *  a table with a blue header row does not need a blue bar above it too. */
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
}) {
  return (
    <section className="overflow-hidden rounded-[8px] border border-head-line bg-paper">
      {title && (
        <header className="flex items-center gap-3 bg-head px-4 py-[9px]">
          <h2 className="text-[13px] font-semibold text-head-ink">{title}</h2>
          {right && <div className="ml-auto text-[12px] text-white/70">{right}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/* ── Table with a blue header row, as in the reference. ─────────────────── */
export function TableHead({
  cols,
  light = false,
  tight = false,
}: {
  /* A label may be a node, not just text — the first column of a selectable
     table is a tick-box rather than a word. */
  cols: (string | { label: React.ReactNode; align?: "right"; width?: string })[];
  /** White row with black text — for a table that already sits under a blue
   *  section header, where a second blue bar would stack on the first. */
  light?: boolean;
  /** Narrower gutters, for a table carrying seven or eight columns. The CELLS
   *  must be set to match (px-3) or the headings sit off their columns. */
  tight?: boolean;
}) {
  return (
    <thead>
      <tr className={light ? "border-b border-line bg-paper" : "bg-head"}>
        {cols.map((c, i) => {
          const label = typeof c === "string" ? c : c.label;
          const align = typeof c === "string" ? undefined : c.align;
          return (
            <th
              key={i}
              style={typeof c === "string" ? undefined : c.width ? { width: c.width } : undefined}
              className={`${tight ? "px-3" : "px-4"} py-[7px] text-label font-semibold uppercase tracking-wide ${
                light ? "text-ink" : "text-head-ink"
              } ${align === "right" ? "text-right" : "text-left"}`}
            >
              {label}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

export function Button({
  children,
  variant = "secondary",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  const base =
    "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-[7px] text-[13px] font-medium transition-colors disabled:opacity-40";
  const styles =
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-hover"
      : "border border-line bg-paper text-ink hover:bg-sunken";
  return (
    <button className={`${base} ${styles}`} {...rest}>
      {children}
    </button>
  );
}
