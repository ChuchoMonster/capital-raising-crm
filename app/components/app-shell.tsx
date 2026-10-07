"use client";

import { usePathname } from "next/navigation";
import { TopBar } from "./top-bar";

/**
 * The frame around every signed-in page.
 *
 * It used to wrap everything in a provider that downloaded the entire search
 * index — every contact's name and best email — the moment it mounted. That
 * file lived under public/, where no sign-in check can reach, so anyone who
 * could load a page already had the whole list.
 *
 * Search now runs in the database and results are rendered on the server.
 * Nothing about a contact reaches the browser except the rows on screen.
 */
const PUBLIC_ROUTES = ["/login"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

  if (isPublic) return <>{children}</>;

  return (
    <>
      <TopBar />
      <main>{children}</main>
    </>
  );
}
