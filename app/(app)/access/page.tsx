import { redirect } from "next/navigation";
import { requireUser } from "@/app/lib/session";
import { isApprover } from "@/app/lib/allowed";
import { listPeople } from "@/app/lib/access-store";
import { AccessTable } from "./access-table";

/**
 * Who can get in — and the way to stop them.
 *
 * A page rather than an item in the profile menu, because revoking somebody is
 * rare but consequential and needs context a dropdown cannot hold: when they
 * were added, who approved them, and when they last actually signed in.
 *
 * "Last seen" is the column that earns this page. It is how you notice the
 * contractor who finished six weeks ago and still has a way into eighteen
 * thousand contacts.
 *
 * Guarded twice over. The layout hides the link from anyone who is not an
 * approver; this checks again, because a hidden link is not a permission and
 * the address can be typed.
 */
export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const user = await requireUser();
  if (!isApprover(user.email)) redirect("/");
  return <AccessTable rows={await listPeople()} />;
}
