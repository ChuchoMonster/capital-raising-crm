"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewImport, commitImport, type ImportPreview } from "@/app/lib/import/run";
import { Button } from "./ui";

/**
 * Adding people or firms from a spreadsheet somebody already keeps.
 *
 * READ, SHOW, THEN WRITE. The file is parsed and the columns are matched, and
 * what that produced is put on screen before anything is saved — which column
 * was taken to be the email, which headings nothing matched, how many rows are
 * new, and the first few exactly as they would be written.
 *
 * That middle step is the whole design. A column read wrongly and a column
 * read correctly look identical once the rows are in the CRM, and this is the
 * only moment at which the difference can be seen. Automatic mapping without
 * it would be a machine confidently filing people under the wrong name.
 */

const ACCEPT = ".csv,.xlsx,.tsv,.txt";

export function BulkUpload({ kind }: { kind: "contacts" | "accounts" }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enriched, setEnriched] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const noun = kind === "contacts" ? "contacts" : "accounts";

  function reset() {
    setPreview(null); setDone(null); setEnriched(null); setFileName("");
    if (input.current) input.current.value = "";
  }

  async function take(file: File | undefined) {
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      /* Base64 through a server action rather than a signed upload: these are
         spreadsheets of a few thousand rows, well inside what a request body
         holds, and a storage round-trip would add a failure mode for nothing.
         A file too big for it is refused with the reason. */
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      setPreview(await previewImport(kind, file.name, btoa(binary)));
    } catch {
      setPreview({ ok: false, message: "That file could not be read here. If it is very large, save it as CSV and try again." });
    } finally {
      setBusy(false);
    }
  }

  function commit() {
    if (!preview?.token) return;
    setBusy(true);
    (async () => {
      const r = await commitImport(preview.token!);
      setDone(r.message);
      setPreview(null);
      setBusy(false);
      startTransition(() => router.refresh());

      /* Then find out who they are. A separate call because each firm is a web
         search and a page read — minutes, not seconds — and the rows are
         already saved, so nothing is lost if this is interrupted or the window
         is closed. Whatever it does not reach, the hourly job finishes. */
      if (r.added > 0 && kind === "contacts") {
        setEnriching(true);
        try {
          const res = await fetch("/api/import/enrich", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ max: 40 }),
          });
          const e = await res.json();
          setEnriched(e.message ?? "");
        } catch {
          setEnriched("They are saved. Identifying the firms behind them did not finish here — the hourly job will pick it up.");
        } finally {
          setEnriching(false);
          startTransition(() => router.refresh());
        }
      }
    })();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); reset(); }}
        className="rounded-md border border-white/25 px-3 py-[7px] text-[13px] font-medium text-white transition-colors hover:bg-white/15"
      >
        Upload {noun}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-10"
          onClick={() => !busy && setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`Upload ${noun}`}
        >
          <div
            className="w-full max-w-[680px] rounded-[10px] border border-line bg-paper shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold text-ink">Upload {noun}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="text-[18px] leading-none text-ink-3 hover:text-ink disabled:opacity-40"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4">
              {!preview && !done && (
                <>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) take(e.dataTransfer.files[0]); }}
                    onClick={() => !busy && input.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) input.current?.click(); }}
                    className={`flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-[9px] border-2 border-dashed px-6 py-7 text-center transition-colors ${
                      drag ? "border-accent bg-accent/[0.07]" : "border-head-line hover:border-accent/50 hover:bg-sunken/50"
                    } ${busy ? "pointer-events-none opacity-70" : ""}`}
                  >
                    <p className="text-[15px] font-medium text-ink">
                      {busy ? `Reading ${fileName}…` : "Drop a CSV or Excel file, or click to choose one"}
                    </p>
                    <p className="mt-1.5 max-w-[46ch] text-[13px] leading-[1.5] text-ink-2">
                      The first row must be the column headings. They are matched automatically and
                      you are shown what was matched before anything is saved.
                    </p>
                    <input
                      ref={input}
                      type="file"
                      accept={ACCEPT}
                      className="hidden"
                      onChange={(e) => take(e.target.files?.[0])}
                    />
                  </div>
                  {/* Said BEFORE the file is chosen, not discovered in the
                      skipped list afterwards. Somebody with a column of names
                      and no addresses should know it will not work before
                      they go looking for the file. */}
                  <p className="mt-3 text-micro leading-[1.5] text-ink-2">
                    {kind === "contacts" ? (
                      <>
                        <strong className="font-medium text-ink">An email address is required.</strong>{" "}
                        It is what a person is matched and deduped on, so any row without one is
                        skipped and listed back to you.
                      </>
                    ) : (
                      <>
                        <strong className="font-medium text-ink">A web address is required.</strong>{" "}
                        It is what a firm is keyed on here, so any row without one is skipped and
                        listed back to you.
                      </>
                    )}
                  </p>
                </>
              )}

              {done && (
                <>
                  <p className="rounded-[6px] px-3.5 py-3 text-body"
                     style={{ background: "var(--color-good-bg)", color: "var(--color-good)" }}>
                    {done}
                  </p>

                  {/* The second half of the job, reported separately, because
                      it is a different question with a different answer:
                      saving them always works, identifying them does not. */}
                  {enriching && (
                    <p className="mt-3 flex items-center gap-2 text-body text-ink-2">
                      <Spinner />
                      Identifying them — searching the web for each new firm, and for each person
                      on a personal address. This takes a minute or two and you can close this;
                      it carries on.
                    </p>
                  )}
                  {enriched && (
                    <p className="mt-3 rounded-[6px] border border-line px-3.5 py-3 text-body text-ink-2">
                      {enriched}
                    </p>
                  )}

                  <div className="mt-4 flex justify-end gap-2">
                    <Button onClick={reset} disabled={enriching}>Upload another</Button>
                    <Button variant="primary" onClick={() => setOpen(false)}>Done</Button>
                  </div>
                </>
              )}

              {preview && !preview.ok && (
                <>
                  <p className="rounded-[6px] px-3.5 py-3 text-body"
                     style={{ background: "var(--color-bad-bg)", color: "var(--color-bad)" }}>
                    {preview.message}
                  </p>
                  <div className="mt-4 flex justify-end">
                    <Button onClick={reset}>Try another file</Button>
                  </div>
                </>
              )}

              {preview?.ok && (
                <>
                  <p className="text-body font-medium text-ink">{preview.message}</p>
                  <p className="mt-0.5 text-micro text-ink-2">
                    {fileName} · {preview.fileRows?.toLocaleString()} rows read
                    {preview.knownRows ? ` · ${preview.knownRows.toLocaleString()} already in the CRM` : ""}
                  </p>

                  {/* WHAT THE COLUMNS WERE TAKEN TO MEAN. The reason this
                      screen exists at all. */}
                  <div className="mt-4 rounded-[8px] border border-line">
                    <p className="border-b border-line bg-sunken px-3.5 py-2 text-label uppercase tracking-wide text-ink-3">
                      Columns matched
                    </p>
                    <div className="flex flex-col gap-1 px-3.5 py-3 text-[13px]">
                      {Object.entries(preview.mapped ?? {}).map(([field, heading]) => (
                        <div key={field} className="flex gap-2">
                          <span className="w-[110px] shrink-0 text-ink-3">{label(field)}</span>
                          <span className="truncate text-ink">{heading}</span>
                        </div>
                      ))}
                      {preview.ignored && preview.ignored.length > 0 && (
                        /* Named, not dropped in silence — a column nothing
                           matched is usually the one somebody cared about. */
                        <p className="mt-1.5 border-t border-line pt-2 text-micro text-ink-2">
                          Not used: {preview.ignored.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>

                  {preview.sample && preview.sample.length > 0 && (
                    <div className="mt-3 overflow-x-auto rounded-[8px] border border-line">
                      <p className="border-b border-line bg-sunken px-3.5 py-2 text-label uppercase tracking-wide text-ink-3">
                        First {preview.sample.length}, as they would be saved
                      </p>
                      <table className="w-full text-table">
                        <thead>
                          <tr className="border-b border-line">
                            {Object.keys(preview.sample[0]).map((h) => (
                              <th key={h} className="px-3.5 py-1.5 text-left text-micro font-medium text-ink-3">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.sample.map((r, i) => (
                            <tr key={i} className={i % 2 ? "bg-sunken/50" : ""}>
                              {Object.values(r).map((v, j) => (
                                <td key={j} className="max-w-[190px] truncate px-3.5 py-1.5 text-ink-2">{v || "—"}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {preview.unusable && preview.unusable.length > 0 && (
                    <div className="mt-3 rounded-[8px] px-3.5 py-3"
                         style={{ background: "var(--color-warn-bg)" }}>
                      <p className="text-micro font-medium" style={{ color: "var(--color-warn)" }}>
                        {preview.unusable.length} rows will be skipped
                      </p>
                      <ul className="mt-1 flex flex-col gap-0.5 text-micro" style={{ color: "var(--color-warn)" }}>
                        {preview.unusable.slice(0, 6).map((u) => (
                          <li key={u.row}>Row {u.row}: {u.why}</li>
                        ))}
                        {preview.unusable.length > 6 && <li>…and {preview.unusable.length - 6} more</li>}
                      </ul>
                    </div>
                  )}

                  {!!preview.truncated && (
                    <p className="mt-3 text-micro text-warn">
                      Only the first rows were read; {preview.truncated.toLocaleString()} more were not.
                      Split the file if you need all of them.
                    </p>
                  )}

                  <p className="mt-4 text-micro leading-[1.5] text-ink-2">
                    {kind === "contacts"
                      ? "Anyone whose web address matches a firm already here is attached to it and takes its segment. For the rest, the firm behind the address is looked up on the web straight after saving. Somebody on a personal address is looked up as a PERSON instead — who they are and who they work for — and placed by their employer. Anything that cannot be established stays in Pending; nobody is excluded for not being found."
                      : "New firms go to Pending. Nothing is classified from a spreadsheet alone."}
                  </p>

                  <div className="mt-4 flex justify-end gap-2">
                    <Button onClick={reset} disabled={busy}>Choose another file</Button>
                    <Button variant="primary" onClick={commit} disabled={busy || !preview.newRows}>
                      {busy ? "Adding…" : `Add ${(preview.newRows ?? 0).toLocaleString()} ${kind === "contacts" ? "people" : "firms"}`}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="shrink-0 animate-spin">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const LABELS: Record<string, string> = {
  email: "Email", name: "Name", firstName: "First name", lastName: "Last name",
  jobTitle: "Job title", company: "Company", domain: "Web address",
  country: "Country", phone: "Phone", linkedin: "LinkedIn", note: "Note",
  type: "Type",
};
const label = (f: string) => LABELS[f] ?? f;
