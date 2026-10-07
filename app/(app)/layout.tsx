import { requireUser } from "@/app/lib/session";

/**
 * The gate for every page that shows real data.
 *
 * Everything under this layout — contacts, accounts, deals, outreach, access —
 * is refused to anyone without a session. middleware.ts already turned them
 * away; this is the second, independent lock, and the one that cannot be
 * switched off by editing a matcher.
 *
 * Sections render full-bleed so their hero image can span the viewport.
 * Each page wraps its own content in the max-width container.
 */
export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
