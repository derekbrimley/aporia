import { NextResponse } from "next/server";
import { signOut, workosLogoutUrl } from "@/lib/auth";
import { env } from "@/lib/env";

export async function POST() {
  await signOut();
  const signInUrl = `${env.appUrl}/sign-in`;
  // After a WorkOS sign-in, also end the AuthKit session, which then sends the browser back to /sign-in.
  const workos = await workosLogoutUrl(signInUrl);
  return NextResponse.redirect(workos ?? signInUrl, { status: 303 });
}
