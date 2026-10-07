"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { forgotPassword } from "@/app/lib/access-actions";

/**
 * The way in — two doors.
 *
 * Microsoft is the front door: the partners at Halden Ridge already sign in to it every
 * morning, nothing is stored, and their admin revokes access in one place.
 *
 * Email and password is the side door, for people Halden Ridge's tenant does not know —
 * an IT contractor, an outside vendor. Those accounts are requested, not
 * created: see /login/request. Nobody self-serves their way into eighteen
 * thousand contacts.
 *
 * Both doors are live. The password one refuses IDENTICALLY whether the
 * address is unknown, pending, declined, revoked, or simply has the wrong
 * password — anything more helpful turns this form into a way of asking who is
 * on Halden Ridge's list, which is the thing it guards.
 */
export function LoginForm({ next, signInError }: { next: string; signInError: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  /* Auth.js reports every refusal as AccessDenied. For this app there is only
     one reason it happens, and saying so plainly saves a support call:
     Microsoft knows them, this app does not. */
  const [error, setError] = useState<string | null>(
    signInError
      ? "That account is not on the access list for this CRM. Ask Grace or Alan to add it."
      : null,
  );
  const [sentTo, setSentTo] = useState<string | null>(null);
  /* The server decides what to say. It answers identically for an unknown
     address and a real one, but it does tell somebody at Halden Ridge that they sign
     in with Microsoft and have no password to reset — hard-coding the "check
     your email" line here threw that away and left them waiting for an email
     that was never going to come. */
  const [sentMessage, setSentMessage] = useState<string>("");


  const [pending, start] = useTransition();

  function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }
    start(async () => {
      const r = await signIn("credentials", { email, password, redirect: false });
      if (r?.error) {
        /* One message for every refusal. See the note at the top of the file. */
        setError("That email address and password did not match an account here.");
        return;
      }
      window.location.href = next || "/";
    });
  }

  function forgot() {
    setError(null);
    if (!email.trim()) {
      setError("Enter your email address first, then choose Forgot password.");
      return;
    }
    start(async () => {
      const r = await forgotPassword(email);
      /* The server answers the same whether or not that address has an account,
         so this can simply show what it says. */
      if (r.ok) { setSentMessage(r.message); setSentTo(email.trim()); }
      else setError(r.message);
    });
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/img/placeholder.svg)" }}
        aria-hidden
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,10,20,.70) 0%, rgba(4,10,20,.45) 45%, rgba(4,10,20,.72) 100%)",
        }}
        aria-hidden
      />

      <div className="relative flex min-h-screen items-center justify-center px-6 py-14">
        <div className="w-full max-w-[400px]">
          <div className="mb-7">
            <div className="mb-4 h-[2px] w-[52px] bg-white/50" />
            <h1 className="text-[30px] font-light leading-[1.15] tracking-tight text-white">
              Halden Ridge Advisors
            </h1>
            <p className="mt-1.5 text-[14px] text-white/70">Contact intelligence</p>
          </div>

          <div className="rounded-[10px] border border-white/12 bg-[rgba(8,14,26,0.9)] p-7 shadow-[0_10px_36px_rgba(0,0,0,0.42)]">
            {sentTo ? (
              <div>
                <h2 className="text-[17px] font-medium text-white">
                  {sentMessage.includes("Microsoft") ? "Use Microsoft instead" : "Check your email"}
                </h2>
                <p className="mt-2 text-[13.5px] leading-[1.55] text-white/65">{sentMessage}</p>
                <button
                  type="button"
                  onClick={() => setSentTo(null)}
                  className="mt-5 text-[13px] font-medium text-accent hover:underline"
                >
                  ← Back to sign in
                </button>
              </div>
            ) : (
              <>
                {/* Microsoft first — it is what five of the six will use. */}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    /* Auth.js sends them to Microsoft and back. If they are not
                       on the access list the callback refuses and returns here
                       with ?error= — see the banner above. */
                    void signIn("microsoft-entra-id", { callbackUrl: next });
                  }}
                  className="flex w-full items-center justify-center gap-2.5 rounded-[7px] bg-white px-4 py-2.5 text-[14.5px] font-semibold text-[#1a1a1a] transition-colors hover:bg-white/90"
                >
                  <MicrosoftLogo />
                  Continue with Microsoft
                </button>

                <div className="my-5 flex items-center gap-3">
                  <span className="h-px flex-1 bg-white/12" />
                  <span className="text-[11px] uppercase tracking-[0.09em] text-white/35">or</span>
                  <span className="h-px flex-1 bg-white/12" />
                </div>

                <form onSubmit={signInWithPassword} noValidate>
                  <label htmlFor="email" className="block text-label uppercase tracking-wide text-white/45">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1.5 w-full rounded-[7px] border border-white/15 bg-white/[0.06] px-3 py-2.5 text-[14.5px] text-white outline-none transition-colors placeholder:text-white/30 focus:border-accent focus:bg-white/[0.09]"
                    placeholder="you@company.example"
                  />

                  <label
                    htmlFor="password"
                    className="mt-4 block text-label uppercase tracking-wide text-white/45"
                  >
                    Password
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="password"
                      type={show ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-[7px] border border-white/15 bg-white/[0.06] py-2.5 pl-3 pr-11 text-[14.5px] text-white outline-none transition-colors placeholder:text-white/30 focus:border-accent focus:bg-white/[0.09]"
                      placeholder="••••••••"
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

                  {error && (
                    <p role="alert" className="mt-4 text-[13px] leading-[1.5] text-[#ff9b8f]">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={pending}
                    className="mt-5 w-full rounded-[7px] bg-accent px-4 py-2.5 text-[14.5px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
                  >
                    {pending ? "Signing in…" : "Sign in"}
                  </button>

                  {/* No "Request access" any more. Accounts here are granted by
                      someone at Halden Ridge who already knows the person — a form that
                      invited strangers to apply was answering a question nobody
                      asks, and it was the most fragile part of getting in. */}
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <button
                      type="button"
                      onClick={forgot}
                      className="text-[13px] text-white/55 hover:text-white hover:underline"
                    >
                      Forgot password
                    </button>
                    <span className="text-[12.5px] text-white/40">
                      Need an account? Ask Halden Ridge.
                    </span>
                  </div>
                </form>
              </>
            )}
          </div>

          <p className="mt-5 text-center text-[12px] leading-[1.5] text-white/40">
            You stay signed in on this computer until you sign out.
          </p>
        </div>
      </div>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="0" y="0" width="7.4" height="7.4" fill="#F25022" />
      <rect x="8.6" y="0" width="7.4" height="7.4" fill="#7FBA00" />
      <rect x="0" y="8.6" width="7.4" height="7.4" fill="#00A4EF" />
      <rect x="8.6" y="8.6" width="7.4" height="7.4" fill="#FFB900" />
    </svg>
  );
}

/** Open eye, or crossed-through when the password is showing. */
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
      {off && (
        <path d="M3.5 3.5 16.5 16.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      )}
    </svg>
  );
}
