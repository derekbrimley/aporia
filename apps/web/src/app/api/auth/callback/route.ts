import { NextResponse } from "next/server";
import { consumeMagicLink, homeFor } from "@/lib/auth";
import { env } from "@/lib/env";

/** The link in the email. Shows a confirm button rather than signing in, so a mail scanner's fetch can't spend the token. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.redirect(`${env.appUrl}/sign-in?error=expired`);
  return NextResponse.redirect(`${env.appUrl}/sign-in/confirm?token=${encodeURIComponent(token)}`);
}

/** The confirm button. Spends the token and signs in. */
export async function POST(req: Request) {
  const form = await req.formData();
  const token = form.get("token");
  const user = typeof token === "string" && token ? await consumeMagicLink(token) : null;
  // 303 so the browser follows with a GET.
  if (!user) return NextResponse.redirect(`${env.appUrl}/sign-in?error=expired`, 303);
  return NextResponse.redirect(`${env.appUrl}${homeFor(user.role)}`, 303);
}
