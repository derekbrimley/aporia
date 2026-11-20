import { NextResponse } from "next/server";
import { getCurrentUser, signOut, workosLogoutUrl } from "@/lib/auth";
import { env } from "@/lib/env";

export async function POST() {
  // While viewing as a tester, "Sign out" means leave their account, not the admin's.
  if ((await getCurrentUser())?.impersonator) return NextResponse.redirect(`${env.appUrl}/api/auth/view-as/stop`, { status: 303 });
  await signOut();
  const signInUrl = `${env.appUrl}/sign-in`;
  // After a WorkOS sign-in, also end the AuthKit session, which then sends the browser back to /sign-in.
  const workos = await workosLogoutUrl(signInUrl);
  return NextResponse.redirect(workos ?? signInUrl, { status: 303 });
}
