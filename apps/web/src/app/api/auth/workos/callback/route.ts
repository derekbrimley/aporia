import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { homeFor, workosSignIn } from "@/lib/auth";
import { env } from "@/lib/env";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = (await cookies()).get("aporia_oauth_state")?.value;
  if (!code || !state || state !== expected) return NextResponse.redirect(`${env.appUrl}/sign-in?error=state`);
  const user = await workosSignIn(code);
  if (!user) return NextResponse.redirect(`${env.appUrl}/sign-in?error=not_invited`);
  return NextResponse.redirect(`${env.appUrl}${homeFor(user.role)}`);
}
