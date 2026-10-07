import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "./components/app-shell";
import { SessionProvider } from "./components/session-provider";
import { currentUser } from "./lib/session";

/* Inter, not Figtree. Figtree is the closer match to Proxima Nova, but nine
   tenths of this app is 12–14px table text and Inter is drawn for that:
   aligned figures, slashed zero, letters that cannot be confused. Misreading
   a digit in an AUM figure is a real business error at this firm. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Halden Ridge CRM",
  description: "Halden Ridge Advisors — contact intelligence",
};

/* Reading the session here makes every page request-specific, which is also
   what stops an authenticated page being rendered once and served from a
   shared cache. `currentUser` returns null rather than redirecting, because
   this layout also wraps the sign-in screen. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <SessionProvider user={user}>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
