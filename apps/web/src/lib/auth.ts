import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@rematter/db";
import { env } from "./env.js";

export type Role = "associate" | "pd_admin" | "internal_admin" | "internal_rater";
export interface CurrentUser {
  id: string; orgId: string; email: string; name: string; firstName: string; role: Role;
  /** The internal admin viewing the app as this user ("View as tester"), if any. Everything is read-only then. */
  impersonator?: Impersonator;
}
export interface Impersonator { id: string; orgId: string; email: string; name: string; firstName: string; role: Role }

const COOKIE = "rematter_session";
const SESSION_DAYS = 14;
const LINK_MINUTES = 20;
/** "View as tester": the admin's own session token waits here, and the page to go back to. */
const ADMIN_COOKIE = "rematter_admin_session";
const RETURN_COOKIE = "rematter_admin_return";
const IMPERSONATION_HOURS = 2;

function hash(token: string): string {
  return crypto.createHmac("sha256", env.authSecret).update(token).digest("hex");
}

/**
 * The invited account for an email. The same person can have one in several firms; sign-in picks the
 * one used most recently (the matter picker reaches the others), never an arbitrary row.
 */
async function userByEmail(email: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.email, email.toLowerCase().trim()), isNull(schema.users.removedAt)))
    .orderBy(sql`${schema.users.lastSeenAt} desc nulls last`, desc(schema.users.invitedAt))
    .limit(1);
  return rows[0];
}

/** Issues a magic link for an existing, invited user. Returns the link (callers decide how to deliver it). */
export async function createMagicLink(email: string): Promise<{ url: string; delivered: "email" | "log" } | null> {
  const db = getDb();
  const user = await userByEmail(email);
  if (!user) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  await db.insert(schema.magicLinks).values({ userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) });
  const url = `${env.appUrl}/api/auth/callback?token=${token}`;
  if (env.postmarkToken) {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Postmark-Server-Token": env.postmarkToken },
      body: JSON.stringify({ From: env.emailFrom, To: user.email, Subject: `Sign in to ${env.productName}`, TextBody: `Sign in with this link (valid ${LINK_MINUTES} minutes):\n\n${url}\n\nIf you did not request this, ignore this email.`, MessageStream: "outbound" }),
    });
    // Not thrown: the sign-in form must not reveal which addresses are invited.
    if (!res.ok) console.error(JSON.stringify({ level: "error", event: "postmark_failed", status: res.status, body: await res.text() }));
    return { url, delivered: "email" };
  }
  console.log(JSON.stringify({ level: "info", event: "magic_link", email: user.email, url }));
  return { url, delivered: "log" };
}

/** Exchanges a magic-link token for a signed-in browser session. */
export async function consumeMagicLink(token: string): Promise<CurrentUser | null> {
  const db = getDb();
  // One statement, so two requests racing on the same link can't both sign in.
  const [link] = await db
    .update(schema.magicLinks)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.magicLinks.tokenHash, hash(token)), isNull(schema.magicLinks.usedAt), gt(schema.magicLinks.expiresAt, new Date())))
    .returning({ userId: schema.magicLinks.userId });
  if (!link) return null;
  return signIn(link.userId);
}

/**
 * Starts a browser session as `userId`. With `impersonator`, it is an admin's short, read-only
 * "View as tester" session, which doesn't count as the user being seen.
 */
export async function signIn(userId: string, impersonator?: Impersonator): Promise<CurrentUser> {
  const db = getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (impersonator ? IMPERSONATION_HOURS * 3_600_000 : SESSION_DAYS * 86_400_000));
  await db.insert(schema.authSessions).values({ userId, tokenHash: hash(token), expiresAt, impersonatorUserId: impersonator?.id ?? null });
  if (!impersonator) await db.update(schema.users).set({ lastSeenAt: new Date() }).where(eq(schema.users.id, userId));
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env.isProd, expires: expiresAt, path: "/" });
  return (await getCurrentUser())!;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await getDb().delete(schema.authSessions).where(eq(schema.authSessions.tokenHash, hash(token)));
  jar.delete(COOKIE);
  // Signing out while viewing as someone ends the admin's own session too.
  const adminToken = jar.get(ADMIN_COOKIE)?.value;
  if (adminToken) await getDb().delete(schema.authSessions).where(eq(schema.authSessions.tokenHash, hash(adminToken)));
  jar.delete(ADMIN_COOKIE);
  jar.delete(RETURN_COOKIE);
}

/**
 * "View as tester": signs this browser in as `targetUserId`, read-only, and parks the admin's own
 * session so `stopImpersonating` can bring it back. `returnTo` is the admin page to go back to.
 */
export async function startImpersonating(admin: CurrentUser, targetUserId: string, returnTo: string): Promise<CurrentUser> {
  if (admin.role !== "internal_admin" || admin.impersonator) throw new Error("only an admin signed in as themselves can view as someone else");
  const jar = await cookies();
  const adminToken = jar.get(COOKIE)?.value;
  if (!adminToken) throw new Error("no admin session");
  const expires = new Date(Date.now() + IMPERSONATION_HOURS * 3_600_000);
  // The admin's own session lasts longer than this one; keep its cookie until it comes back.
  jar.set(ADMIN_COOKIE, adminToken, { httpOnly: true, sameSite: "lax", secure: env.isProd, maxAge: SESSION_DAYS * 86_400, path: "/" });
  jar.set(RETURN_COOKIE, safeAdminPath(returnTo), { httpOnly: true, sameSite: "lax", secure: env.isProd, expires, path: "/" });
  const { impersonator: _, ...self } = admin;
  return signIn(targetUserId, self);
}

/**
 * Ends "View as tester": drops the borrowed session and restores the admin's own. Returns the page
 * to go back to, or null when there was nothing to restore (the caller then sends them to sign in).
 */
export async function stopImpersonating(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const db = getDb();
  if (token) await db.delete(schema.authSessions).where(and(eq(schema.authSessions.tokenHash, hash(token)), sql`${schema.authSessions.impersonatorUserId} is not null`));
  const adminToken = jar.get(ADMIN_COOKIE)?.value;
  const back = safeAdminPath(jar.get(RETURN_COOKIE)?.value);
  jar.delete(ADMIN_COOKIE);
  jar.delete(RETURN_COOKIE);
  if (!adminToken) { jar.delete(COOKIE); return null; }
  const [row] = await db.select({ expiresAt: schema.authSessions.expiresAt }).from(schema.authSessions).where(and(eq(schema.authSessions.tokenHash, hash(adminToken)), gt(schema.authSessions.expiresAt, new Date())));
  if (!row) { jar.delete(COOKIE); return null; }
  jar.set(COOKIE, adminToken, { httpOnly: true, sameSite: "lax", secure: env.isProd, expires: row.expiresAt, path: "/" });
  return back;
}

/** True when this browser has an admin session parked behind a "View as tester" one, even an expired one. */
export async function hasParkedAdminSession(): Promise<boolean> {
  return Boolean((await cookies()).get(ADMIN_COOKIE)?.value);
}

function safeAdminPath(p: string | undefined): string {
  return p && /^\/admin(\/[A-Za-z0-9/_-]*)?$/.test(p) ? p : "/admin";
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const rows = await db
    .select({ id: schema.users.id, orgId: schema.users.orgId, email: schema.users.email, name: schema.users.name, firstName: schema.users.firstName, role: schema.users.role, removedAt: schema.users.removedAt, impersonatorUserId: schema.authSessions.impersonatorUserId })
    .from(schema.authSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
    .where(and(eq(schema.authSessions.tokenHash, hash(token)), gt(schema.authSessions.expiresAt, new Date())));
  const u = rows[0];
  if (!u || u.removedAt) return null;
  const user: CurrentUser = { id: u.id, orgId: u.orgId, email: u.email, name: u.name, firstName: u.firstName, role: u.role as Role };
  if (!u.impersonatorUserId) return user;
  // A borrowed session only holds while the admin behind it is still an admin.
  const [a] = await db
    .select({ id: schema.users.id, orgId: schema.users.orgId, email: schema.users.email, name: schema.users.name, firstName: schema.users.firstName, role: schema.users.role, removedAt: schema.users.removedAt })
    .from(schema.users)
    .where(eq(schema.users.id, u.impersonatorUserId));
  if (!a || a.removedAt || a.role !== "internal_admin") return null;
  return { ...user, impersonator: { id: a.id, orgId: a.orgId, email: a.email, name: a.name, firstName: a.firstName, role: a.role as Role } };
}

export async function requireUser(roles?: Role[]): Promise<CurrentUser> {
  const u = await getCurrentUser();
  // A "View as tester" session ran out: go back to the admin account rather than to sign-in.
  if (!u) redirect((await hasParkedAdminSession()) ? "/api/auth/view-as/stop" : "/sign-in");
  if (roles && !roles.includes(u.role)) redirect(homeFor(u.role));
  return u;
}

export function homeFor(role: Role): string {
  return role === "associate" ? "/" : role === "pd_admin" ? "/pd" : role === "internal_rater" ? "/rater" : "/admin";
}

/**
 * API-route variant: returns a 401/403 Response instead of redirecting. Pass `{ write: true }` from
 * any route that changes something: an admin viewing as a tester can look but never act for them.
 */
export async function apiUser(roles?: Role[], opts?: { write?: boolean }): Promise<CurrentUser | Response> {
  const u = await getCurrentUser();
  if (!u) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (roles && !roles.includes(u.role)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (opts?.write && u.impersonator) return Response.json({ error: `Read-only: you are viewing as ${u.name}.`, readOnly: true }, { status: 403 });
  return u;
}

export async function audit(actor: CurrentUser | Impersonator, action: string, target?: string, details?: unknown) {
  await getDb().insert(schema.auditLog).values({ orgId: actor.orgId, actorUserId: actor.id, action, target: target ?? null, details: details ?? null });
}

// ---------------------------------------------------------------- WorkOS AuthKit (SSO/SAML later, same user table)
export function workosEnabled(): boolean {
  return Boolean(env.workosApiKey && env.workosClientId);
}

/** `loginHint` pre-fills the email on the AuthKit page. It is only a convenience: the callback still checks the verified email. */
export function workosAuthorizeUrl(state: string, loginHint?: string | null): string {
  const u = new URL("https://api.workos.com/user_management/authorize");
  u.searchParams.set("client_id", env.workosClientId!);
  u.searchParams.set("redirect_uri", `${env.appUrl}/api/auth/workos/callback`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("provider", "authkit");
  u.searchParams.set("state", state);
  if (loginHint && loginHint.length <= 320 && loginHint.includes("@")) u.searchParams.set("login_hint", loginHint);
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
  const json = (await res.json()) as { user?: { id: string; email: string; email_verified?: boolean }; access_token?: string };
  // Users are matched by email, so an unverified address could claim someone else's invite.
  if (!json.user?.email_verified) return null;
  const db = getDb();
  const user = await userByEmail(json.user.email);
  if (!user) return null;
  await db.update(schema.users).set({ authSubject: json.user.id }).where(eq(schema.users.id, user.id));
  const signedIn = await signIn(user.id);
  // Remember the WorkOS session so sign-out can end it too. Otherwise AuthKit signs the next person straight back in.
  const sid = workosSessionId(json.access_token);
  if (sid) (await cookies()).set(WORKOS_SID_COOKIE, sid, { httpOnly: true, sameSite: "lax", secure: env.isProd, maxAge: SESSION_DAYS * 86_400, path: "/" });
  return signedIn;
}

const WORKOS_SID_COOKIE = "rematter_workos_sid";

/** Reads the `sid` claim from the AuthKit access token. Not verified: the token came straight from WorkOS over TLS, and the sid is only used to log out. */
function workosSessionId(accessToken?: string): string | null {
  const payload = accessToken?.split(".")[1];
  if (!payload) return null;
  try {
    const sid = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sid?: unknown }).sid;
    return typeof sid === "string" ? sid : null;
  } catch {
    return null;
  }
}

/** Clears the stored WorkOS session and returns the AuthKit logout URL, or null if this browser has no WorkOS session. */
export async function workosLogoutUrl(returnTo: string): Promise<string | null> {
  const jar = await cookies();
  const sid = jar.get(WORKOS_SID_COOKIE)?.value;
  if (!sid) return null;
  jar.delete(WORKOS_SID_COOKIE);
  if (!workosEnabled()) return null;
  const u = new URL("https://api.workos.com/user_management/sessions/logout");
  u.searchParams.set("session_id", sid);
  u.searchParams.set("return_to", returnTo);
  return u.toString();
}

// ---------------------------------------------------------------- session export API token
/**
 * Read-only access to session exports for scripts and Claude, without a browser sign-in:
 * `Authorization: Bearer $EXPORT_API_TOKEN`. Off unless the variable is set (32+ characters).
 * The token only works on the GET export routes that call this; it never signs anyone in.
 */
export function exportTokenValid(req: Request): boolean {
  const want = process.env.EXPORT_API_TOKEN;
  if (!want || want.length < 32) return false;
  const got = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!got) return false;
  const a = crypto.createHash("sha256").update(got).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

/** An internal admin's cookie session, or the export token. Tokens are audited with no actor. */
export async function exportReader(req: Request): Promise<{ user: CurrentUser | null } | Response> {
  if (req.headers.get("authorization")) {
    if (!exportTokenValid(req)) return Response.json({ error: "invalid export token" }, { status: 401 });
    return { user: null };
  }
  const u = await apiUser(["internal_admin"]);
  return u instanceof Response ? u : { user: u };
}

export async function auditExport(reader: { user: CurrentUser | null }, action: string, target?: string, details?: Record<string, unknown>) {
  if (reader.user) return audit(reader.user, action, target, details);
  await getDb().insert(schema.auditLog).values({ orgId: null, actorUserId: null, action, target: target ?? null, details: { ...details, via: "export_token" } });
}
