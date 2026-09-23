import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@aporia/db";
import { env } from "./env.js";

export type Role = "associate" | "pd_admin" | "internal_admin" | "internal_rater";
export interface CurrentUser { id: string; orgId: string; email: string; name: string; firstName: string; role: Role }

const COOKIE = "aporia_session";
const SESSION_DAYS = 14;
const LINK_MINUTES = 20;

function hash(token: string): string {
  return crypto.createHmac("sha256", env.authSecret).update(token).digest("hex");
}

/** Issues a magic link for an existing, invited user. Returns the link (callers decide how to deliver it). */
export async function createMagicLink(email: string): Promise<{ url: string; delivered: "email" | "log" } | null> {
  const db = getDb();
  const user = (await db.select().from(schema.users).where(and(eq(schema.users.email, email.toLowerCase().trim()), isNull(schema.users.removedAt))))[0];
  if (!user) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  await db.insert(schema.magicLinks).values({ userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) });
  const url = `${env.appUrl}/api/auth/callback?token=${token}`;
  if (env.postmarkToken) {
    await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Postmark-Server-Token": env.postmarkToken },
      body: JSON.stringify({ From: env.emailFrom, To: user.email, Subject: `Sign in to ${env.productName}`, TextBody: `Sign in with this link (valid ${LINK_MINUTES} minutes):\n\n${url}\n\nIf you did not request this, ignore this email.`, MessageStream: "outbound" }),
    });
    return { url, delivered: "email" };
  }
  console.log(JSON.stringify({ level: "info", event: "magic_link", email: user.email, url }));
  return { url, delivered: "log" };
}

/** Exchanges a magic-link token for a signed-in browser session. */
export async function consumeMagicLink(token: string): Promise<CurrentUser | null> {
  const db = getDb();
  const link = (await db.select().from(schema.magicLinks).where(and(eq(schema.magicLinks.tokenHash, hash(token)), isNull(schema.magicLinks.usedAt), gt(schema.magicLinks.expiresAt, new Date()))))[0];
  if (!link) return null;
  await db.update(schema.magicLinks).set({ usedAt: new Date() }).where(eq(schema.magicLinks.id, link.id));
  return signIn(link.userId);
}

export async function signIn(userId: string): Promise<CurrentUser> {
  const db = getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.authSessions).values({ userId, tokenHash: hash(token), expiresAt });
  await db.update(schema.users).set({ lastSeenAt: new Date() }).where(eq(schema.users.id, userId));
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env.isProd, expires: expiresAt, path: "/" });
  return (await getCurrentUser())!;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await getDb().delete(schema.authSessions).where(eq(schema.authSessions.tokenHash, hash(token)));
  jar.delete(COOKIE);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const rows = await db
    .select({ id: schema.users.id, orgId: schema.users.orgId, email: schema.users.email, name: schema.users.name, firstName: schema.users.firstName, role: schema.users.role, removedAt: schema.users.removedAt })
    .from(schema.authSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
    .where(and(eq(schema.authSessions.tokenHash, hash(token)), gt(schema.authSessions.expiresAt, new Date())));
  const u = rows[0];
  if (!u || u.removedAt) return null;
  return { id: u.id, orgId: u.orgId, email: u.email, name: u.name, firstName: u.firstName, role: u.role as Role };
}

export async function requireUser(roles?: Role[]): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/sign-in");
  if (roles && !roles.includes(u.role)) redirect(homeFor(u.role));
  return u;
}

export function homeFor(role: Role): string {
  return role === "associate" ? "/" : role === "pd_admin" ? "/pd" : role === "internal_rater" ? "/rater" : "/admin";
}

/** API-route variant: returns a 401/403 Response instead of redirecting. */
export async function apiUser(roles?: Role[]): Promise<CurrentUser | Response> {
  const u = await getCurrentUser();
  if (!u) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (roles && !roles.includes(u.role)) return Response.json({ error: "forbidden" }, { status: 403 });
  return u;
}

export async function audit(actor: CurrentUser, action: string, target?: string, details?: unknown) {
  await getDb().insert(schema.auditLog).values({ orgId: actor.orgId, actorUserId: actor.id, action, target: target ?? null, details: details ?? null });
}

// ---------------------------------------------------------------- WorkOS AuthKit (SSO/SAML later, same user table)
export function workosEnabled(): boolean {
  return Boolean(env.workosApiKey && env.workosClientId);
}

export function workosAuthorizeUrl(state: string): string {
  const u = new URL("https://api.workos.com/user_management/authorize");
  u.searchParams.set("client_id", env.workosClientId!);
  u.searchParams.set("redirect_uri", `${env.appUrl}/api/auth/workos/callback`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("provider", "authkit");
  u.searchParams.set("state", state);
  return u.toString();
}

/** Exchanges an AuthKit code for the user's email, then signs in the matching invited user. Never creates users. */
export async function workosSignIn(code: string): Promise<CurrentUser | null> {
  const res = await fetch("https://api.workos.com/user_management/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.workosClientId, client_secret: env.workosApiKey, grant_type: "authorization_code", code }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { user?: { id: string; email: string } };
  if (!json.user) return null;
  const db = getDb();
  const user = (await db.select().from(schema.users).where(and(eq(schema.users.email, json.user.email.toLowerCase()), isNull(schema.users.removedAt))))[0];
  if (!user) return null;
  await db.update(schema.users).set({ authSubject: json.user.id }).where(eq(schema.users.id, user.id));
  return signIn(user.id);
}
