import "server-only";
import { Pool } from "pg";

/**
 * The connection to the CRM database.
 *
 * `server-only` at the top is not decoration. Everything below reaches the
 * whole database with the rights to read every contact; if this file were ever
 * pulled into a client component the build must fail rather than ship it, and
 * that import is what makes it fail.
 *
 * Through the TRANSACTION pooler (port 6543), which is the one built for a
 * world where each request may land in a fresh container. A small pool per
 * container rather than a large one: dozens of containers each holding twenty
 * connections is how a serverless app exhausts a database that six people are
 * using.
 */
declare global {
  var __crmPool: Pool | undefined;
}

function makePool() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL is not set");
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

// Reused across hot reloads in development, so a save does not leak a pool.
export const pool = global.__crmPool ?? makePool();
if (process.env.NODE_ENV !== "production") global.__crmPool = pool;

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

export async function one<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
