import { NextResponse } from "next/server";
import { consumeMagicLink, homeFor } from "@/lib/auth";
import { env } from "@/lib/env";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const user = token ? await consumeMagicLink(token) : null;
  if (!user) return NextResponse.redirect(`${env.appUrl}/sign-in?error=expired`);
  return NextResponse.redirect(`${env.appUrl}${homeFor(user.role)}`);
}
