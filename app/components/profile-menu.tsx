"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut as endSession } from "next-auth/react";
import { useSession } from "./session-provider";

/**
 * Who you are, the way out, and — for the two who approve people — the way to
 * see who has a key.
 *
 * The name and address are the point, not decoration: these are shared
 * laptops, and the question "am I looking at this as me or as Ruth?" has a
 * real answer that changes what the Owner column means to you.
 *
 * Deliberately no Settings. Nothing in this app is configurable per person
 * yet, and a menu item that opens an empty page is worse than no menu item.
 * Manage access is the exception, because it does something.
 */

export function ProfileMenu() {
  const user = useSession();
  /* Null only on the sign-in screen, which does not render this menu. */
  const approver = user?.approver === true;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function away(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  /* No session means the sign-in screen, which has no profile menu. */
  if (!user) return null;

  function signOut() {
    /* Clears the session cookie server-side, then does a full page load to
       /login. The full load matters: the in-memory search index holds every
       name and address, and only a real navigation discards it. router.push
       would keep the React tree — and the data — alive.

       Microsoft's own session is deliberately left alone, so signing out here
       does not sign anyone out of Outlook. `prompt=select_account` on the way
       back in is what stops the next person at a shared laptop landing in as
       whoever used it last. */
    setOpen(false);
    void endSession({ callbackUrl: "/login", redirect: true });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Signed in as ${user.name}`}
        className={`flex h-[26px] w-[26px] items-center justify-center rounded-full text-[10.5px] font-semibold text-white transition-colors ${
          open ? "bg-white/30" : "bg-white/15 hover:bg-white/25"
        }`}
      >
        {user.initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-[248px] overflow-hidden rounded-[8px] border border-line bg-paper shadow-[0_8px_28px_rgba(16,32,64,.22)]"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.085em] text-ink-3">
              Signed in as
            </p>
            <p className="mt-1 truncate text-[14px] font-medium text-ink">{user.name}</p>
            <p className="truncate font-mono text-[12px] text-ink-2">{user.email}</p>
          </div>

          {approver && (
            <Link
              href="/access"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 border-b border-line px-4 py-2.5 text-left text-[13.5px] text-ink hover:bg-sunken"
            >
              <KeyIcon />
              Manage access
            </Link>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13.5px] text-ink hover:bg-sunken"
          >
            <SignOutIcon />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function KeyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden className="text-ink-3">
      <circle cx="5.5" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.7 7.7 13 13M11 11l1.6-1.6M13 13l1-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden className="text-ink-3">
      <path
        d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6M10.5 11 14 8l-3.5-3M14 8H6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
