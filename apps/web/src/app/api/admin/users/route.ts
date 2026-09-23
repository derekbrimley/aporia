import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@aporia/db";
import { apiUser, audit, createMagicLink } from "@/lib/auth";

const Invite = z.object({ orgId: z.string().uuid().optional(), cohortId: z.string().uuid().optional(), email: z.string().email(), name: z.string().min(1), role: z.enum(["associate", "pd_admin", "internal_admin", "internal_rater"]), sendLink: z.boolean().default(true) });

/** Invite: internal admins anywhere; PD admins may invite associates into their own firm only. */
export async function POST(req: Request) {
  const u = await apiUser(["internal_admin", "pd_admin"]);
  if (u instanceof Response) return u;
  const b = Invite.parse(await req.json());
  const orgId = u.role === "pd_admin" ? u.orgId : b.orgId ?? u.orgId;
  if (u.role === "pd_admin" && b.role !== "associate") return Response.json({ error: "PD admins can invite associates only" }, { status: 403 });
  const db = getDb();
  const email = b.email.toLowerCase();
  let user = (await db.select().from(schema.users).where(and(eq(schema.users.orgId, orgId), eq(schema.users.email, email))))[0];
  if (!user) [user] = await db.insert(schema.users).values({ orgId, email, name: b.name, firstName: b.name.split(" ")[0]!, role: b.role }).returning();
  else if (user.removedAt) await db.update(schema.users).set({ removedAt: null }).where(eq(schema.users.id, user.id));
  if (b.cohortId) {
    const cohort = (await db.select().from(schema.cohorts).where(and(eq(schema.cohorts.id, b.cohortId), eq(schema.cohorts.orgId, orgId))))[0];
    if (!cohort) return Response.json({ error: "cohort not in this firm" }, { status: 400 });
    await db.insert(schema.cohortMembers).values({ cohortId: b.cohortId, userId: user!.id, orgId }).onConflictDoNothing();
  }
  const link = b.sendLink ? await createMagicLink(email) : null;
  await audit(u, "user.invite", user!.id, { role: b.role, cohortId: b.cohortId });
  return Response.json({ user, devLink: link?.delivered === "log" ? link.url : undefined });
}

/** Remove an associate from the firm (soft delete; their data is retained per the firm's policy). */
export async function DELETE(req: Request) {
  const u = await apiUser(["internal_admin", "pd_admin"]);
  if (u instanceof Response) return u;
  const { userId } = (await req.json()) as { userId: string };
  const db = getDb();
  const target = (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0];
  if (!target || (u.role === "pd_admin" && (target.orgId !== u.orgId || target.role !== "associate"))) return Response.json({ error: "not found" }, { status: 404 });
  await db.update(schema.users).set({ removedAt: new Date() }).where(eq(schema.users.id, userId));
  await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, userId));
  await audit(u, "user.remove", userId);
  return Response.json({ ok: true });
}
