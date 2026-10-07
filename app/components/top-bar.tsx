"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProfileMenu } from "./profile-menu";

/** The four sections Halden Ridge works, in the order they are worked. */
const SECTIONS = [
  { href: "/contacts", label: "Contacts" },
  { href: "/accounts", label: "Accounts" },
  { href: "/deals", label: "Deals" },
  { href: "/outreach", label: "Outreach" },
];

/* Exclusions sits on the far right, against the avatar, rather than fifth in
   the row (John, 2026-08-27). Set aside is not a fifth section, and putting it
   at the end of the four read as though it were one. */
const ASIDE = { href: "/exclusions", label: "Exclusions" };

export function TopBar() {
  const path = usePathname();
  // On the landing page the four cards are the choice; the nav would
  // pre-empt it. Show the wordmark only.
  const onLanding = path === "/";


  return (
    <header className="sticky top-0 z-30 border-b border-line bg-brand-ink">
      <div className="mx-auto flex h-[52px] w-full max-w-[1180px] items-center gap-7 px-6">
        {/* The one place brand black and the wordmark appear. */}
        <Link href="/" className="text-[19px] font-medium tracking-tight text-white">
          Halden Ridge
        </Link>

        {!onLanding && (
        <nav className="flex items-center gap-1">
          {SECTIONS.map((s) => {
            const active = path.startsWith(s.href);
            return (
              <Link
                key={s.href}
                href={s.href}
                className={`rounded-[6px] px-3 py-[6px] text-[13px] font-medium transition-colors ${
                  active ? "bg-white/15 text-white" : "text-white/60 hover:text-white"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
        )}

        <div className="ml-auto flex items-center gap-3">
          {!onLanding && (
            <Link
              href={ASIDE.href}
              className={`rounded-[6px] px-3 py-[6px] text-[13px] font-medium transition-colors ${
                path.startsWith(ASIDE.href)
                  ? "bg-white/15 text-white"
                  : "text-white/45 hover:text-white/80"
              }`}
            >
              {ASIDE.label}
            </Link>
          )}

          {/* No "data as of" line. It dated a one-off research load that has
              nothing to do with what is on screen — the mailboxes are read
              every five minutes and a deal is current the moment it is
              uploaded, so a date from weeks ago read as staleness that was not
              there. Removed at John's request, 2026-08-26. */}
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
