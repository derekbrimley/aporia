import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { workosAuthorizeUrl, workosEnabled } from "@/lib/auth";

export async function GET() {
  if (!workosEnabled()) return NextResponse.json({ error: "WorkOS is not configured" }, { status: 404 });
  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(workosAuthorizeUrl(state));
  res.cookies.set("aporia_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
