"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { LoginFrame } from "../frame";
import { setPassword as savePassword } from "@/app/lib/access-actions";

/**
 * Set your own password, from the link Grace's approval sent.
 *
 * The link works as many times as needed and lasts five days (John,
 * 2026-08-16) — a one-shot link that dies on a mistyped password is a support
 * call, and the risk it guards against is small next to the annoyance. If it
 * does run out, the person requests access again rather than being stuck.
 *
 * The same screen serves a forgotten password, arriving with `&reset=1`. The
 * only difference is the wording and the two-hour link, so a second nearly
 * identical page would be two places to fix one bug.
 */
export default function SetPasswordPage() {
  const params = useSearchParams();
  const token = params.get("t") ?? "";
  const isReset = params.get("reset") === "1";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    /* Eight, matching the server. Length is the only part of a password rule
       that costs an attacker anything, and the check that matters runs on the
       server — this one is here so the person is told before a round trip. */
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setError(null);
    start(async () => {
      const r = await savePassword(token, password, isReset ? "reset" : "set-password");
      if (r.ok) setDone(true);
      else setError(r.message);
    });
  }

  if (!token) {
    return (
      <LoginFrame>
        <h2 className="text-[17px] font-medium text-white">This link is incomplete</h2>
        <p className="mt-2 text-[13.5px] leading-[1.55] text-white/65">
          Open the link from your email exactly as it was sent. If it has stopped working, use
          Forgot password on the sign-in screen.
        </p>
        <Link href="/login" className="mt-5 inline-block text-[13px] font-medium text-accent hover:underline">
          ← Back to sign in
        </Link>
      </LoginFrame>
    );
  }

  if (done) {
    return (
      <LoginFrame>
        <h2 className="text-[17px] font-medium text-white">Password set</h2>
        <p className="mt-2 text-[13.5px] leading-[1.55] text-white/65">
          You can sign in with your email address and this password.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-block rounded-[7px] bg-accent px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-accent-hover"
        >
          Go to sign in
        </Link>
      </LoginFrame>
    );
  }

  return (
    <LoginFrame>
      <h2 className="text-[17px] font-medium text-white">Set your password</h2>
      <p className="mt-1.5 text-[13.5px] leading-[1.5] text-white/60">
        Halden Ridge approved your access. Choose a password and you are in.
      </p>

      <form onSubmit={submit} noValidate className="mt-5">
        <label htmlFor="pw" className="block text-label uppercase tracking-wide text-white/45">
          New password
        </label>
        <div className="relative mt-1.5">
          <input
            id="pw"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-[7px] border border-white/15 bg-white/[0.06] py-2.5 pl-3 pr-11 text-[14.5px] text-white outline-none transition-colors placeholder:text-white/30 focus:border-accent focus:bg-white/[0.09]"
            placeholder="At least 8 characters"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-[5px] p-2 text-white/45 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <EyeIcon off={show} />
          </button>
        </div>

        <label htmlFor="pw2" className="mt-4 block text-label uppercase tracking-wide text-white/45">
          Again, to be sure
        </label>
        <input
          id="pw2"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1.5 w-full rounded-[7px] border border-white/15 bg-white/[0.06] px-3 py-2.5 text-[14.5px] text-white outline-none transition-colors focus:border-accent focus:bg-white/[0.09]"
        />

        {error && (
          <p role="alert" className="mt-4 text-[13px] leading-[1.5] text-[#ff9b8f]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-5 w-full rounded-[7px] bg-accent px-4 py-2.5 text-[14.5px] font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          Set password
        </button>

        <p className="mt-4 text-center text-[12px] leading-[1.5] text-white/40">
          This link works for five days. If it runs out, request access again.
        </p>
      </form>
    </LoginFrame>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M1.5 10S4.6 4.5 10 4.5 18.5 10 18.5 10 15.4 15.5 10 15.5 1.5 10 1.5 10Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.4" />
      {off && <path d="M3.5 3.5 16.5 16.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
    </svg>
  );
}
