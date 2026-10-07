import { LoginForm } from "./login-form";

/**
 * The sign-in screen.
 *
 * A server component wrapping the form for one reason: the two things the URL
 * carries — where to go afterwards, and whether the last attempt was refused —
 * are read here, on the server, and passed down. Reading them in the browser
 * instead meant the first paint disagreed with what the server had sent.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const q = await searchParams;

  /* Only ever a path on this site. An absolute URL here would let a crafted
     link bounce someone straight back out to another site immediately after
     they signed in. */
  const target = q.next;
  const next = target && target.startsWith("/") && !target.startsWith("//") ? target : "/";

  return <LoginForm next={next} signInError={Boolean(q.error)} />;
}
