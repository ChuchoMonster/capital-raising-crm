import { requireApprover } from "@/app/lib/session";

/**
 * Only the two who approve people may see who has a key.
 *
 * This is a layout rather than a check inside the page for a specific reason:
 * the page is a client component, and the access list is compiled into the
 * JavaScript sent to the browser. Deciding in the browser whether to render it
 * would mean shipping every contractor's name and address to everyone first
 * and then hiding it — which is not hiding it at all.
 *
 * Guarding on the server means someone who is not an approver never receives
 * the page, or its data, at all.
 */
export default async function AccessLayout({ children }: { children: React.ReactNode }) {
  await requireApprover();
  return <>{children}</>;
}
