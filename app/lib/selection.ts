import "server-only";
import { query } from "./db";
import type { Filters, RepliedFilter } from "./search";
import { EVER_REPLIED, REPLIED_JOIN } from "./search";
import { contactsInScope, accountsInScope } from "./scope";

/**
 * What "selected" means when the list is 11,357 people long.
 *
 * Ticking a box on screen selects a row. Ticking "select all 11,357" cannot
 * mean sending eleven thousand ids to the browser and back — so it doesn't.
 * A selection is either a short list of ids, or a DESCRIPTION of a search plus
 * the handful of rows the person then unticked. The server re-runs the search
 * when the selection is actually used.
 *
 * The practical consequence: between selecting everything and acting on it,
 * the underlying data could change. For a research load that runs monthly and
 * six people using this, that is not a real risk — and the alternative, a
 * frozen snapshot of eleven thousand ids in a browser tab, is worse.
 */
export type Selection =
  | { mode: "ids"; ids: string[] }
  | { mode: "all"; q: string; segment: string | null; filters: Filters;
      replied?: RepliedFilter; except: string[] };

export const EMPTY: Selection = { mode: "ids", ids: [] };

/** A hard ceiling. Nothing legitimate here selects more than the whole list. */
const MAX = 60_000;

function buildWhere(sel: Extract<Selection, { mode: "all" }>, table: "contacts" | "accounts") {
  const params: unknown[] = [];
  const where: string[] = [];
  const alias = table === "contacts" ? "c" : "a";

  /* Same scope as the list the person was looking at when they selected. A
     "select all matching" that resolved to a wider set than the screen showed
     would quietly put dead addresses on a deal. */
  if (sel.segment) { params.push(sel.segment); where.push(`${alias}.segment = $${params.length}`); }
  where.push(table === "contacts" ? contactsInScope(alias) : accountsInScope(alias));

  if (sel.q.trim()) {
    params.push(`%${sel.q.trim().toLowerCase()}%`);
    where.push(`${alias}.search_text ilike $${params.length}`);
  }

  const keys = ["country", "type", "sector", "commodity", "aum", "via", "invests_in", "stage", "project"];
  let needsFacets = false;
  for (const [key, values] of Object.entries(sel.filters)) {
    if (!values?.length || !keys.includes(key)) continue;
    params.push(values);
    where.push(`af.f_${key} && $${params.length}::text[]`);
    needsFacets = true;
  }

  /* The replied filter has to be re-applied here or "select all 4,000
     matching" would resolve to everybody — putting people who already answered
     onto a list the person had deliberately narrowed to those who never did.
     Contacts only: it reads c.replied and the inbound-mail join. */
  let needsReplied = false;
  if (table === "contacts" && (sel.replied === "yes" || sel.replied === "no")) {
    where.push(sel.replied === "yes" ? EVER_REPLIED : `not ${EVER_REPLIED}`);
    needsReplied = true;
  }

  if (sel.except.length) {
    params.push(sel.except);
    where.push(`${alias}.hr_id <> all($${params.length}::text[])`);
  }
  return { params, where: where.join(" and "), needsFacets, needsReplied, alias };
}

/**
 * Turn a selection into the actual rows it means.
 *
 * Called at the moment of use — exporting, or adding people to a deal — never
 * while someone is still ticking boxes.
 */
export async function resolveSelection(
  sel: Selection,
  table: "contacts" | "accounts",
): Promise<string[]> {
  if (sel.mode === "ids") return sel.ids.slice(0, MAX);

  const { params, where, needsFacets, needsReplied, alias } = buildWhere(sel, table);
  const facetJoin = needsFacets
    ? table === "contacts"
      ? "left join account_facets af on af.hr_id = c.account_id"
      : "left join account_facets af on af.hr_id = a.hr_id"
    : "";
  const repliedJoin = needsReplied ? REPLIED_JOIN : "";
  const rows = await query<{ hr_id: string }>(
    `select ${alias}.hr_id from ${table} ${alias} ${facetJoin} ${repliedJoin} where ${where} limit ${MAX}`,
    params,
  );
  return rows.map((r) => r.hr_id);
}

/** How many rows a selection covers, without listing them. */
export async function countSelection(sel: Selection, table: "contacts" | "accounts"): Promise<number> {
  if (sel.mode === "ids") return sel.ids.length;
  const { params, where, needsFacets, needsReplied, alias } = buildWhere(sel, table);
  const facetJoin = needsFacets
    ? table === "contacts"
      ? "left join account_facets af on af.hr_id = c.account_id"
      : "left join account_facets af on af.hr_id = a.hr_id"
    : "";
  const repliedJoin = needsReplied ? REPLIED_JOIN : "";
  const r = await query<{ n: string }>(
    `select count(*) n from ${table} ${alias} ${facetJoin} ${repliedJoin} where ${where}`, params);
  return Number(r[0]?.n ?? 0);
}
