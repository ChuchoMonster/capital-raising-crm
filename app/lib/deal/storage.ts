import "server-only";
import { randomUUID } from "node:crypto";

/**
 * Somewhere to put an uploaded document that is NOT a Vercel function.
 *
 * A serverless function accepts a request body of about 4.5MB and refuses
 * anything larger with a plain-text 413 that never reaches our code. The upload
 * route said 25MB, which was simply untrue: a deck and a term sheet together
 * are routinely past 4.5MB, and the browser reported the platform's HTML error
 * as "the server sent back something unreadable".
 *
 * So the file does not go through the function at all. The browser is handed a
 * signed URL and uploads straight to Supabase Storage — the same project that
 * already holds the contacts, so no new service and no new bill — and only the
 * short storage path is posted to the route. The server then reads the file
 * back from storage, where nothing caps it at 4.5MB.
 *
 * The bucket is PRIVATE. These are confidential raise documents; a public
 * bucket would put every deck Halden Ridge is sent on a guessable URL.
 *
 * It does NOT restrict file types. That was tried and removed: storage matches
 * on the Content-Type the browser sends, a browser sends nothing useful when the
 * OS does not recognise an extension, and the upload then fails for precisely
 * the unusual files that most need to get through. The extension is checked
 * twice in our own code instead — once before a URL is signed, once before the
 * document is read.
 */

const BUCKET = "deal-uploads";

function config() {
  /* SUPABASE_URL, not NEXT_PUBLIC_SUPABASE_URL. Nothing here runs in a browser,
     and Vercel refuses to hold a NEXT_PUBLIC_ variable as a secret in
     production precisely because that prefix means "this is baked into the
     client bundle" — reading it on the server was muddled, and the platform
     said so. The public name is still accepted as a fallback so a local
     .env.local that only has the old one keeps working. */
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL is not set — storage cannot be reached.");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — storage cannot be reached.");
  return { url, key };
}

/** A path nobody can guess, keeping the extension so the reader can dispatch on it. */
export function pathFor(fileName: string): string {
  const ext = (fileName.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
}

/** A one-shot URL the browser can PUT to. Valid for a couple of minutes. */
export async function signedUpload(path: string): Promise<{ url: string; token: string }> {
  const { url, key } = config();
  const res = await fetch(`${url}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: 300 }),
  });
  if (!res.ok) throw new Error(`Could not prepare the upload: ${res.status} ${(await res.text()).slice(0, 120)}`);
  const body = await res.json();
  /* Supabase returns the signed path with the token on it. The browser PUTs
     there directly; the service key never leaves the server. */
  return { url: `${url}/storage/v1${body.url}`, token: body.token };
}

/**
 * Put a file into the bucket from the server.
 *
 * The browser path above is signed because a 25MB deck cannot go through a
 * Vercel function. This one is for files WE make — the teaser's hero picture,
 * pulled out of a deck — which are small and never leave the server anyway.
 */
export async function put(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { url, key } = config();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`, apikey: key,
      "content-type": contentType,
      /* Overwrite rather than fail: re-drafting a teaser writes the picture
         again, and a stale one left behind because the write was refused would
         be the version that goes to investors. */
      "x-upsert": "true",
    },
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`Could not save ${path}: ${res.status} ${(await res.text()).slice(0, 120)}`);
}

export async function download(path: string): Promise<ArrayBuffer> {
  const { url, key } = config();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`That upload could not be read back (${res.status}).`);
  return res.arrayBuffer();
}

/**
 * Remove an upload.
 *
 * NO LONGER THE NORMAL PATH. The document used to be deleted as soon as its
 * text had been read, on the reasoning that keeping every confidential deck Halden Ridge
 * is sent, indefinitely, was a liability for no benefit. That was right until
 * the CRM started drafting the emails: the deck goes out attached, and you
 * cannot attach a file you have thrown away. Uploads are now KEPT and recorded
 * in `deal_documents`.
 *
 * This is still called when the deal could not be created, so a failed upload
 * does not leave a file nothing points at. Failure to delete is logged, never
 * raised — a deal that exists must not be reported as failed because a cleanup
 * did not land.
 */
export async function remove(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    const { url, key } = config();
    await fetch(`${url}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
  } catch (e) {
    console.error("could not remove temporary upload", paths, e);
  }
}
