import { and, eq } from "drizzle-orm";
import { ENGINE_VERSION } from "@aporia/engine";
import { appendEvent, ensureSession, getDb, getPool, getSessionState, recordActivity, schema } from "@aporia/db";
import type { CurrentUser } from "./auth.js";
import { getScenario } from "./scenario.js";

/**
 * Finds the associate's session in their cohort, starting it on first load and
 * appending session_resumed when they come back after a gap. Test mode follows
 * the environment (APORIA_TEST_MODE=1) for new sessions only.
 */
export async function bootstrapSession(user: CurrentUser) {
  const db = getDb();
  const membership = (await db
    .select({ cohort: schema.cohorts })
    .from(schema.cohortMembers)
    .innerJoin(schema.cohorts, eq(schema.cohorts.id, schema.cohortMembers.cohortId))
    .where(and(eq(schema.cohortMembers.userId, user.id), eq(schema.cohortMembers.orgId, user.orgId))))[0];
  if (!membership) return null;
  const cohort = membership.cohort;
  const { pkg } = getScenario(cohort.scenarioId, cohort.scenarioVersion);
  const session = await ensureSession(db, { orgId: user.orgId, userId: user.id, cohortId: cohort.id, scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: ENGINE_VERSION, testMode: process.env.APORIA_TEST_MODE === "1" });
  const row = (await getPool().query<{ status: string; last_activity_at: Date | null }>(`select status, last_activity_at from sessions where id = $1`, [session.id])).rows[0]!;
  const now = new Date();
  if (row.status === "not_started") {
    await appendEvent(session.id, { type: "session_started", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: ENGINE_VERSION, associateFirstName: user.firstName } }, "api", pkg);
  } else if (row.status === "in_progress" && row.last_activity_at) {
    const gapDays = Math.floor((now.getTime() - row.last_activity_at.getTime()) / 86_400_000);
    if (gapDays >= 1) await appendEvent(session.id, { type: "session_resumed", payload: { gapDays } }, "api", pkg, { idempotencyKey: `${session.id}:resumed:${now.toISOString().slice(0, 13)}` });
  }
  await recordActivity(session.id, now);
  return { session, cohort, pkg };
}

export async function sessionForUser(user: CurrentUser) {
  const db = getDb();
  const s = (await db.select().from(schema.sessions).where(and(eq(schema.sessions.userId, user.id), eq(schema.sessions.orgId, user.orgId))))[0];
  if (!s) return null;
  const cohort = (await db.select().from(schema.cohorts).where(eq(schema.cohorts.id, s.cohortId)))[0]!;
  const loaded = getScenario(s.scenarioId, s.scenarioVersion);
  return { session: s, cohort, pkg: loaded.pkg, documents: loaded.documents, state: await getSessionState(s.id, loaded.pkg) };
}
