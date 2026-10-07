#!/usr/bin/env node
/**
 * READ-ONLY. Copies the SHAPE of the live database — table and column names,
 * types, defaults, keys, and view definitions. It reads no rows of data.
 * Output: demo/schema.sql
 */
import pg from "pg";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  (existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("set session characteristics as transaction read only");

const q = async (sql, p = []) => (await db.query(sql, p)).rows;

const tables = await q(`
  select table_name from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE' order by table_name`);

const views = await q(`
  select table_name, pg_get_viewdef(('public.'||quote_ident(table_name))::regclass, true) as def
  from information_schema.views where table_schema='public' order by table_name`);

const matviews = await q(`
  select matviewname as table_name, definition as def
  from pg_matviews where schemaname='public' order by matviewname`);

const enums = await q(`
  select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
  from pg_type t join pg_enum e on e.enumtypid=t.oid
  join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'
  group by t.typname order by t.typname`);

let out = "-- Structure only. Copied from the live database; contains no data.\n\n";
for (const e of enums) {
  out += `create type ${e.typname} as enum (${e.labels.map((l) => `'${l.replace(/'/g, "''")}'`).join(", ")});\n`;
}
out += "\n";

for (const t of tables) {
  const cols = await q(`
    select column_name, data_type, udt_name, character_maximum_length,
           numeric_precision, numeric_scale, is_nullable, column_default
    from information_schema.columns
    where table_schema='public' and table_name=$1 order by ordinal_position`, [t.table_name]);
  const defs = cols.map((c) => {
    let type = c.data_type;
    if (type === "ARRAY") type = c.udt_name.replace(/^_/, "") + "[]";
    else if (type === "USER-DEFINED") type = c.udt_name;
    else if (type === "character varying") type = c.character_maximum_length ? `varchar(${c.character_maximum_length})` : "text";
    else if (type === "numeric" && c.numeric_precision) type = `numeric(${c.numeric_precision},${c.numeric_scale})`;
    let s = `  ${JSON.stringify(c.column_name).replace(/"/g, '"')} ${type}`;
    if (c.column_default && !/nextval\(/.test(c.column_default)) s += ` default ${c.column_default}`;
    if (c.is_nullable === "NO") s += " not null";
    return s;
  });
  out += `create table if not exists "${t.table_name}" (\n${defs.join(",\n")}\n);\n\n`;
}

// keys and constraints, after every table exists
const cons = await q(`
  select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
  from pg_constraint where connamespace='public'::regnamespace
    and contype in ('p','u','f','c')
    order by case contype when 'p' then 1 when 'u' then 2 when 'f' then 3 else 4 end, conname`);
for (const c of cons) {
  out += `alter table ${c.tbl} add constraint "${c.conname}" ${c.def};\n`;
}
out += "\n";

const idx = await q(`
  select indexdef from pg_indexes where schemaname='public'
    and indexname not in (select conname from pg_constraint where connamespace='public'::regnamespace)`);
for (const i of idx) out += `${i.indexdef};\n`;
out += "\n";

for (const v of views) out += `create or replace view "${v.table_name}" as\n${v.def}\n\n`;
for (const v of matviews) out += `create materialized view if not exists "${v.table_name}" as\n${v.def};\n\n`;

writeFileSync(new URL("./schema.sql", import.meta.url), out);
console.log(`tables ${tables.length} · views ${views.length} · matviews ${matviews.length} · enums ${enums.length} · constraints ${cons.length}`);
console.log(tables.map((t) => t.table_name).join(", "));
await db.end();
