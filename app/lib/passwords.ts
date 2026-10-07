import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number, o?: object) => Promise<Buffer>;

/**
 * Storing and checking passwords.
 *
 * scrypt from Node's own crypto, not a dependency. It is a memory-hard hash
 * designed for exactly this, it ships with the runtime, and it removes a
 * package from the supply chain of an app that holds eighteen thousand
 * contacts. bcrypt would be equally correct and brings a native build.
 *
 * Parameters are stored IN the hash string. A cost raised in two years' time
 * must not invalidate every password set before it — an old hash keeps
 * verifying with the parameters it was made under.
 */

const N = 16384;   // CPU/memory cost
const r = 8;
const p = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, sN, sr, sp, salt64, key64] = parts;
  try {
    const key = Buffer.from(key64, "base64");
    const got = await scrypt(password, Buffer.from(salt64, "base64"), key.length, {
      N: Number(sN), r: Number(sr), p: Number(sp), maxmem: 64 * 1024 * 1024,
    });
    /* Constant time. A plain === leaks how much of the hash matched, one byte
       at a time, to anyone who can measure the response. */
    return got.length === key.length && timingSafeEqual(got, key);
  } catch { return false; }
}

/**
 * What counts as an acceptable password.
 *
 * Length only, and a floor rather than a character-class rule. "Must contain a
 * symbol" reliably produces Password1! and nothing safer; length is the part
 * that actually costs an attacker anything.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 200) return "That is longer than 200 characters.";
  if (!password.trim()) return "Enter a password.";
  return null;
}
