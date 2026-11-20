import { cookies } from "next/headers";
import { audit, getCurrentUser, stopImpersonating } from "@/lib/auth";
import { env } from "@/lib/env";
import { MATTER_COOKIE } from "@/lib/matters";

/** Ends "View as tester" and returns to the admin's own account, on the page they started from. */
async function stop() {
  const u = await getCurrentUser();
  if (u?.impersonator) await audit(u.impersonator, "user.view_as.stop", u.id);
  const back = await stopImpersonating();
  // The matter cookie was set for the tester's inbox; the admin doesn't need it.
  (await cookies()).delete(MATTER_COOKIE);
  return Response.redirect(`${env.appUrl}${back ?? "/sign-in"}`, 303);
}

export const POST = stop;
// GET too, so an expired view-as session can drop the admin straight back to their account.
export const GET = stop;
