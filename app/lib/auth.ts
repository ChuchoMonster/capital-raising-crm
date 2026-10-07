import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { findAllowed, initialsFor, normaliseEmail } from "./allowed";
import { findPerson, recordSignIn, normalise } from "./access-store";
import { verifyPassword } from "./passwords";

/**
 * Microsoft sign-in.
 *
 * Two separate questions, and conflating them is the mistake this file exists
 * to avoid:
 *
 *   1. Microsoft answers "is this really you?"      — authentication
 *   2. ALLOWED answers "and should you be here?"    — authorisation
 *
 * Passing (1) is not enough. The Halden Ridge tenant holds shared mailboxes, service
 * accounts and every guest anyone has ever invited to a Teams call. Any of
 * them would satisfy Microsoft. The `signIn` callback below is the gate, and
 * it fails closed: anything it does not positively recognise is refused.
 *
 * The session is a signed cookie, not a database row, because there is no
 * database yet. It carries the person's name, address and whether they may
 * approve access — nothing that is not already visible to a signed-in user.
 */

const TWELVE_HOURS = 12 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
      // openid/profile/email is all this app needs. It reads no mail and no
      // directory: asking for more would be a wider blast radius for nothing.
      authorization: {
        params: {
          scope: "openid profile email",
          /* Always ask which account, never silently reuse the one already
             signed in to Microsoft. On a shared laptop, signing out of the CRM
             and having the next person land straight back in as you is the
             failure this prevents. Signing them out of Outlook as well would
             be the alternative, and is worse. */
          prompt: "select_account",
        },
      },
    }),

    /**
     * The side door: email and password, for people the Halden Ridge tenant does not
     * know — an IT contractor, an outside vendor.
     *
     * These accounts are REQUESTED, never self-created (see /login/request).
     * `authorize` returning null is a refusal, and it refuses identically
     * whether the address is unknown, pending, declined, revoked or simply has
     * the wrong password. Distinguishing them would turn this form into a way
     * of asking whether an address is on Halden Ridge's list.
     */
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const email = normalise(raw?.email as string);
        const password = (raw?.password as string) ?? "";
        if (!email || !password) return null;

        const person = await findPerson(email);
        if (!person || person.state !== "active" || person.kind !== "password") return null;
        if (!(await verifyPassword(password, person.passwordHash))) return null;

        await recordSignIn(email);
        return { id: person.id, email: person.email, name: person.name };
      },
    }),
  ],

  session: {
    strategy: "jwt",
    // These are shared laptops. Twelve hours means someone signs in once a
    // day; because Microsoft already knows them it is one click, not a
    // password. A week-long session on a shared machine is the real risk.
    maxAge: TWELVE_HOURS,
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  callbacks: {
    /**
     * THE GATE. Returning false stops the sign-in dead.
     *
     * Microsoft returns the address under different keys depending on account
     * type — a member has `email`, a guest often only `preferred_username` in
     * the directory's mangled form. Checking all three is what lets a guest in
     * without widening the rule to "anyone in the tenant".
     */
    async signIn({ profile, account }) {
      /* The password door has already done its own checking in `authorize`;
         re-running it here would just be the same query twice. */
      if (account?.provider === "credentials") return true;

      const candidates = [
        profile?.email,
        (profile as { preferred_username?: string } | undefined)?.preferred_username,
        (profile as { upn?: string } | undefined)?.upn,
      ].map((c) => (c ? normaliseEmail(c) : null)).filter(Boolean) as string[];

      for (const c of candidates) {
        const person = await findPerson(c);
        if (person?.state === "active") { await recordSignIn(c); return true; }
      }
      return false;
    },

    /**
     * Runs on sign-in and on every subsequent request.
     *
     * Two jobs. At sign-in (`profile` present) it resolves who this is once.
     * On every later request it re-checks the allowlist and returns null if
     * they are no longer on it, which destroys the session.
     *
     * That re-check is the whole reason revocation works. Without it, removing
     * someone from ALLOWED would leave their existing cookie valid until it
     * expired — up to twelve hours of access after they were meant to lose it.
     */
    async jwt({ token, profile, user }) {
      if (profile || user) {
        const candidates = [
          user?.email,
          profile?.email,
          (profile as { preferred_username?: string } | undefined)?.preferred_username,
          (profile as { upn?: string } | undefined)?.upn,
        ].map((c) => (c ? normaliseEmail(c) : null)).filter(Boolean) as string[];

        for (const c of candidates) {
          const person = await findPerson(c);
          if (person?.state !== "active") continue;
          token.email = person.email;
          token.name = person.name;
          token.approver = findAllowed(person.email)?.approver === true;
          token.checked = Date.now();
          return token;
        }
        return null; // refused at the gate; belt and braces
      }

      /* Re-checked on later requests, which is the whole reason Revoke means
         anything: without it a revoked person keeps a valid cookie for up to
         twelve hours. Next 16 runs the proxy on Node, so the database is
         reachable here — under Edge it would not have been, and this check
         would have had to live in requireUser, leaving the static search index
         unguarded.
         Throttled to once a minute so a page of requests is not a page of
         queries. Revocation therefore takes effect within a minute rather than
         instantly, which is the trade being made. */
      const CHECK_EVERY = 60_000;
      const last = typeof token.checked === "number" ? token.checked : 0;
      if (Date.now() - last < CHECK_EVERY) return token;

      try {
        const still = await findPerson(token.email as string);
        if (!still || still.state !== "active") return null; // revoked — session ends now
        token.name = still.name;
        token.approver = findAllowed(still.email)?.approver === true;
        token.checked = Date.now();
        return token;
      } catch {
        /* The DATABASE SAYING NO and the DATABASE BEING UNREACHABLE are
           different answers. Ending every session on a transient outage would
           lock the whole firm out of a working app; the check simply stays due
           and runs again on the next request. */
        return token;
      }
    },

    /** Shape the token into what the app reads. */
    session({ session, token }) {
      if (session.user) {
        session.user.name = (token.name as string) ?? session.user.name;
        session.user.email = (token.email as string) ?? session.user.email;
      }
      session.approver = token.approver === true;
      session.initials = initialsFor((token.name as string) ?? "");
      return session;
    },
  },
});

export { normaliseEmail };
