/**
 * Draft the two-page teaser for a deal, from the command line.
 *
 *   node --import ./scripts/ts-resolve.mjs --conditions=react-server \
 *        --experimental-strip-types --env-file=.env.local \
 *        scripts/draft-teaser.ts <reference> [--pdf out.pdf]
 *   … --all      every deal that has no teaser yet
 *   … --render   render the PDF from what is already stored, drafting nothing
 *
 * TypeScript rather than the .mjs every other script here is, because it calls
 * the SAME code the upload path calls. A second implementation of the drafting
 * rules for the backfill is how the backfill ends up producing documents the
 * app would not have produced.
 *
 * `--conditions=react-server` is what lets `server-only` be imported outside
 * Next; `--experimental-strip-types` is Node running the TypeScript as-is; and
 * `--import ./scripts/ts-resolve.mjs` teaches Node the two resolution rules the
 * bundler normally supplies — extensionless imports and the `@/` alias.
 */
import { writeFile } from "node:fs/promises";
import { query } from "../app/lib/db";
import { buildTeaser, teaserPdf } from "../app/lib/deal/teaser-store";
import { pool } from "../app/lib/db";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : "";
};
const refs = args.filter((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--pdf");

async function targets(): Promise<string[]> {
  if (flag("all")) {
    const rows = await query<{ reference: string }>(
      `select reference from deals where teaser is null order by created_at`);
    return rows.map((r) => r.reference);
  }
  return refs;
}

const list = await targets();
if (!list.length) {
  console.error("Nothing to do. Give a deal reference, or --all.");
  process.exit(2);
}

for (const ref of list) {
  if (!flag("render")) {
    process.stdout.write(`drafting ${ref} … `);
    const t = await buildTeaser(ref);
    console.log(`${t.company}: ${t.problems.length} problems, ${t.solutions.length} strengths, ` +
      `${t.achieved.length} achieved, ${t.team.length} in the team, ` +
      `${t.economics ? `${t.economics.rows.length}-row table` : "no table"}, ` +
      `${t.milestones.length} milestones`);
    if (t.gaps.length) console.log(`  gaps: ${t.gaps.join(" · ")}`);
  }
  const out = await teaserPdf(ref);
  if (!out) { console.error(`  ${ref} has no teaser stored`); continue; }
  const path = value("pdf") || `scratch/${ref}-teaser.pdf`;
  await writeFile(path, out.bytes);
  console.log(`  ${path}  ${(out.bytes.length / 1024).toFixed(0)}KB`);
}

await pool.end();
