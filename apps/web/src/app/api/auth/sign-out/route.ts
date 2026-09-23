import { NextResponse } from "next/server";
import { signOut } from "@/lib/auth";
import { env } from "@/lib/env";

export async function POST() {
  await signOut();
  return NextResponse.redirect(`${env.appUrl}/sign-in`, { status: 303 });
}
