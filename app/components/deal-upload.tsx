"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";

/**
 * The one way a deal starts, and the one way one is added to.
 *
 * SEVERAL FILES, ONE DEAL. A raise arrives as a deck and a term sheet, often
 * with a resource statement behind them, and they describe one thing between
 * them — the amount is in the term sheet and the project detail is in the deck.
 * They are queued here and sent together so the write-up reconciles them, rather
 * than producing one half-written deal per file.
 *
 * A SECOND UPLOAD IS USUALLY THE SAME RAISE. A term sheet arrives a week after
 * the deck and belongs on the deal that already exists — so the choice between
 * starting a deal and adding to one is made HERE, before the files go anywhere,
 * rather than being discovered afterwards when the list holds two half-written
 * versions of one raise and nobody can tell which the emails went from.
 *
 * Two things this deliberately does NOT do. It does not let the person type a
 * deal in by hand — every deal on the list then carries the documents it came
 * from, so a write-up can always be checked against its source. And it does not
 * jump to the new deal the moment it lands: it shows what the documents did not
 * say first, because that list is the difference between a write-up that is
 * ready to send and one that quietly has no raise amount in it.
 */

const ACCEPT = ".pdf,.ppt,.pptx,.doc,.docx";
const MAX_TOTAL = 25 * 1024 * 1024;
const MAX_FILES = 8;

interface Change { field: string; from: string; to: string }

interface Result {
  ok: boolean;
  reference?: string;
  title?: string;
  gaps?: string[];
  /** Set by an ADD: the fields the new documents moved. */
  changes?: Change[];
  /** Set by an ADD: the new documents read as a different company name. */
  renamedTo?: string;
  message: string;
}

/** Just enough of a deal to choose it. */
export interface UploadTarget { id: string; name: string; status: string }

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

export function DealUpload({ deals = [] }: { deals?: UploadTarget[] }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [queue, setQueue] = useState<File[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [, startTransition] = useTransition();

  /* Which deal these documents belong to. "" means a new one.

     A NEW DEAL IS THE DEFAULT and always will be: adding to the wrong deal
     rewrites a live raise, while starting an unwanted deal leaves a row
     somebody can delete. When the two are not equally recoverable, the
     recoverable one is the default. */
  const [target, setTarget] = useState("");
  const chosen = deals.find((d) => d.id === target) ?? null;

  const total = queue.reduce((n, f) => n + f.size, 0);

  /** Add to the queue rather than replace it — a second drop is usually a second document. */
  function accept(list: FileList | null) {
    if (!list?.length) return;
    setResult(null);
    setProblem(null);
    const incoming = Array.from(list);

    const bad = incoming.find((f) => !ACCEPT.split(",").some((e) => f.name.toLowerCase().endsWith(e)));
    if (bad) { setProblem(`${bad.name} is not a PDF, PowerPoint or Word file.`); return; }

    /* Dropping the same file twice is a slip, not an instruction. */
    const merged = [...queue];
    for (const f of incoming) {
      if (!merged.some((q) => q.name === f.name && q.size === f.size)) merged.push(f);
    }
    if (merged.length > MAX_FILES) { setProblem(`${MAX_FILES} files at once is the limit.`); return; }
    if (merged.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) {
      setProblem("Those come to more than 25MB together. Send the main documents and add the rest later.");
      return;
    }
    setQueue(merged);
  }

  /**
   * Read a response that might not be JSON.
   *
   * When a request is too big, the PLATFORM refuses it before any of our code
   * runs and answers in plain text. Assuming JSON turned that into "the server
   * sent back something unreadable", which told nobody anything — least of all
   * that the file was too large.
   */
  async function readResult(res: Response, whenTooBig: string): Promise<Result> {
    const text = await res.text().catch(() => "");
    try { return JSON.parse(text) as Result; } catch { /* not ours */ }
    if (res.status === 413 || /TOO_LARGE/i.test(text)) return { ok: false, message: whenTooBig };
    return { ok: false, message: `The upload failed (${res.status}). Nothing was saved — try again.` };
  }

  async function send() {
    if (!queue.length || busy) return;
    setResult(null);
    setProblem(null);
    setBusy(true);
    setStage("Uploading");
    try {
      /* The documents go STRAIGHT TO STORAGE, not through the app. A serverless
         function refuses a body over about 4.5MB, and a deck plus a term sheet
         is routinely more than that — which is exactly what failed here. Only
         the storage paths are posted to the drafting route. */
      const signRes = await fetch("/api/deals/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: queue.map((f) => ({ name: f.name, size: f.size })) }),
      });
      const signed = await readResult(signRes, "Those files are too large to prepare.");
      if (!signRes.ok || !("targets" in signed)) { setResult(signed); return; }

      const targets = (signed as unknown as { targets: { name: string; path: string; url: string; token: string }[] }).targets;

      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const file = queue.find((f) => f.name === t.name);
        if (!file) continue;
        if (targets.length > 1) setStage(`Uploading ${i + 1} of ${targets.length}`);
        /* The content type is set explicitly. A browser leaves `file.type`
           empty whenever the OS does not recognise the extension, and fetch
           then sends a default that storage rejects outright — so the upload
           would fail for exactly the unusual files that most need it. Our own
           extension check has already run, twice. */
        const put = await fetch(t.url, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${t.token}`,
            "x-upsert": "true",
            "content-type": file.type || "application/octet-stream",
          },
          body: file,
        });
        if (!put.ok) {
          setResult({ ok: false, message: `${t.name} did not upload. Check your connection and try again.` });
          return;
        }
      }

      setStage(chosen ? "Re-reading" : "Drafting");
      /* Two routes, not one with a flag. Starting a deal and changing a live
         one are different acts, and the second can move a figure that has
         already gone out in an email. */
      const res = await fetch(chosen ? "/api/deals/add" : "/api/deals/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(chosen ? { reference: chosen.id } : {}),
          files: targets.map((t) => ({ name: t.name, path: t.path })),
        }),
      });
      const json = await readResult(res, "Those files come to more than 25MB together.");
      setResult(json);
      if (json.ok) {
        setQueue([]);
        // Refresh the list behind the panel so the change is there when they look.
        startTransition(() => router.refresh());
      }
    } catch {
      setResult({ ok: false, message: "The upload did not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
      setStage("");
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className="mb-5">
      {/* The choice sits ABOVE the drop zone and only exists once there is
          something to add to. Asked before the files are picked, because it
          changes what the panel is about — and answered by default as "a new
          deal", which is the recoverable one of the two. */}
      {deals.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-line bg-sunken/50 px-3.5 py-2.5">
          <span className="text-micro uppercase tracking-wide text-ink-3">These documents are for:</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Where these documents go">
            <Choice on={!chosen} disabled={busy} onClick={() => setTarget("")}>A new deal</Choice>
            <Choice on={!!chosen} disabled={busy} onClick={() => setTarget(deals[0].id)}>A current deal</Choice>
          </div>
          {chosen && (
            <label className="ml-auto flex items-center gap-2 text-[13px] text-ink-2">
              <span className="sr-only">Which deal</span>
              <select
                value={target}
                disabled={busy}
                onChange={(e) => { setTarget(e.target.value); setResult(null); }}
                className="max-w-[280px] rounded-[6px] border border-line bg-paper px-2.5 py-[5px] text-[13px] text-ink disabled:opacity-50"
              >
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.status === "Live" ? "" : ` (${d.status.toLowerCase()})`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) accept(e.dataTransfer.files); }}
        onClick={() => !busy && input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) input.current?.click(); }}
        className={`flex min-h-[190px] cursor-pointer flex-col items-center justify-center rounded-[10px] border-2 border-dashed px-6 py-8 text-center transition-colors ${
          drag ? "border-accent bg-accent/[0.07]" : "border-head-line bg-paper hover:border-accent/50 hover:bg-sunken/40"
        } ${busy ? "pointer-events-none opacity-70" : ""}`}
      >
        <div className={`mb-3 text-ink-3 ${drag ? "text-accent" : ""}`}>
          {busy ? <Spinner large /> : <IconUpload />}
        </div>
        <h2 className="text-[16px] font-semibold text-ink">
          {busy
            ? stage === "Drafting" ? "Reading the documents and drafting the write-up"
            : stage === "Re-reading" ? "Reading everything on this deal again"
            : stage || "Uploading"
            : chosen ? `Add documents to ${chosen.name}` : "Upload Deal"}
        </h2>
        <p className="mt-1.5 max-w-[52ch] text-[13px] leading-[1.55] text-ink-2">
          {busy
            ? "This takes up to a couple of minutes for a long deck, or one that has to be read as pictures."
            : `PDF, PowerPoint or Word, up to ${MAX_FILES} files, 25MB in total.`}
        </p>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => accept(e.target.files)}
        />
      </div>

      {queue.length > 0 && (
        <div className="mt-3 rounded-[8px] border border-line bg-paper px-4 py-3">
          <ul className="flex flex-col gap-1.5">
            {queue.map((f) => (
              <li key={`${f.name}-${f.size}`} className="flex items-center gap-3 text-[13.5px]">
                <IconDoc />
                <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                <span className="shrink-0 text-micro text-ink-3">{size(f.size)}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setQueue((q) => q.filter((x) => !(x.name === f.name && x.size === f.size)))}
                  className="shrink-0 text-micro font-medium text-ink-3 hover:text-bad disabled:opacity-40"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
            <span className="text-micro text-ink-3">
              {queue.length} {queue.length === 1 ? "file" : "files"} · {size(total)}
            </span>
            <div className="ml-auto flex gap-2">
              <Button onClick={() => setQueue([])} disabled={busy}>Clear</Button>
              <Button variant="primary" onClick={send} disabled={busy}>
                <span className="inline-flex items-center gap-1.5">
                  {busy && <Spinner />}
                  {busy ? `${stage || "Working"}…`
                    : chosen ? `Add to ${chosen.name}`
                    : queue.length === 1 ? "Draft this deal"
                    : `Draft one deal from these ${queue.length}`}
                </span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {problem && (
        <p className="mt-3 rounded-[6px] px-3.5 py-3 text-body"
           style={{ background: "var(--color-bad-bg)", color: "var(--color-bad)" }}>
          {problem}
        </p>
      )}

      {result && (
        <div
          className="mt-3 rounded-[6px] px-3.5 py-3 text-body"
          style={{
            background: result.ok ? "var(--color-good-bg)" : "var(--color-bad-bg)",
            color: result.ok ? "var(--color-good)" : "var(--color-bad)",
          }}
        >
          <p className="font-medium">{result.message}</p>

          {/* WHAT MOVED, in full. A figure that has already gone out in an email
              must never change with nobody told — so an update reads out every
              field it altered, old value and new, rather than a count. */}
          {result.ok && result.changes && result.changes.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {result.changes.map((c) => (
                <li key={c.field} className="text-[13px] leading-[1.5]">
                  <span className="font-medium">{c.field}</span>{" "}
                  {c.from ? (
                    <>
                      <span className="line-through opacity-70">{trim(c.from)}</span>
                      {" \u2192 "}
                      <span>{trim(c.to)}</span>
                    </>
                  ) : (
                    <>was blank {"\u2192"} <span>{trim(c.to)}</span></>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Reported, never acted on. Renaming a live raise breaks the link in
              email colleagues have already sent, so this is a person's call. */}
          {result.ok && result.renamedTo && (
            <p className="mt-2 text-[13px] leading-[1.5]">
              These documents call the company <span className="font-medium">{result.renamedTo}</span>.
              The deal keeps its name — rename it on the deal itself if that is right.
            </p>
          )}

          {result.ok && result.reference && (
            <p className="mt-1.5">
              <a href={`/deals/${result.reference}`} className="underline underline-offset-[3px]">
                Open {result.title} and check it
              </a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** A long summary would swamp the change list; the field name and the shape of
    the change are the point, and the deal page has the full text. */
function trim(v: string): string {
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > 110 ? `${s.slice(0, 110)}\u2026` : s;
}

function Choice({ on, disabled, onClick, children }: {
  on: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-[6px] border px-2.5 py-[5px] text-[13px] font-medium transition-colors disabled:opacity-50 ${
        on ? "border-accent bg-accent text-white" : "border-line bg-paper text-ink-2 hover:border-accent/50 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function IconUpload() {
  return (
    <svg viewBox="0 0 16 16" width="30" height="30" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 10.5V2.5M8 2.5 5 5.5M8 2.5l3 3" />
      <path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="shrink-0 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M9 1.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5z" />
      <path d="M9 1.5V5h3.5" />
    </svg>
  );
}

function Spinner({ large }: { large?: boolean } = {}) {
  const n = large ? 30 : 14;
  return (
    <svg viewBox="0 0 16 16" width={n} height={n} aria-hidden className="animate-spin">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
