"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "../lib/session";

/**
 * Carries the signed-in person from the server down to the handful of client
 * components that show it (the avatar, the profile menu).
 *
 * Deliberately just a value passed down, not a fetch. The server already knows
 * who this is; asking the browser to go and ask again would add a round trip,
 * a loading state, and a second place for the answer to be wrong.
 *
 * This is for DISPLAY only. Nothing here decides what anyone may see — a
 * client component cannot be trusted to, because the person reading the screen
 * can edit it. Every real decision is made by the server guards.
 */
const Ctx = createContext<SessionUser | null>(null);

export function SessionProvider({
  user,
  children,
}: {
  user: SessionUser | null;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}

/** The signed-in person. Null on the sign-in screen. */
export function useSession(): SessionUser | null {
  return useContext(Ctx);
}
