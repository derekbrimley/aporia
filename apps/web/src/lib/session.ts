import { and, eq, isNull } from "drizzle-orm";
import { ENGINE_VERSION } from "@rematter/engine";
import { dateAnchor, forSession } from "@rematter/scenario";
import { appendEvent, ensureSession, getDb, getPool, getSessionState, recordActivity, schema } from "@rematter/db";
import type { CurrentUser } from "./auth.js";
import { getScenario } from "./scenario.js";
import { activeMatter } from "./matters.js";

/**
 * Finds the associate's session in the matter (cohort) they are working on, starting it on first load and
 * appending session_resumed when they come back after a gap. Test mode follows
 * the environment (REMATTER_TEST_MODE=1) for new sessions only.
 */
export async function bootstrapSession(user: CurrentUser) {
  const db = getDb();
  // The matter the associate is working on; null when they belong to none, or to several and haven't chosen.
  const cohort = (await activeMatter(user)).cohort;
  if (!cohort) return null;
  const { pkg } = getScenario(cohort.scenarioId, cohort.scenarioVersion);
  const session = await ensureSession(db, { orgId: user.orgId, userId: user.id, cohortId: cohort.id, scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: ENGINE_VERSION, testMode: process.env.REMATTER_TEST_MODE === "1" });
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
  const active = (await activeMatter(user)).cohort;
  if (!active) return null;
  const s = (await db.select().from(schema.sessions).where(and(eq(schema.sessions.userId, user.id), eq(schema.sessions.orgId, user.orgId), eq(schema.sessions.cohortId, active.id), isNull(schema.sessions.archivedAt))))[0];
  if (!s) return null;
  const cohort = (await db.select().from(schema.cohorts).where(eq(schema.cohorts.id, s.cohortId)))[0]!;
  const loaded = getScenario(s.scenarioId, s.scenarioVersion);
  const state = await getSessionState(s.id, loaded.pkg);
  // Deal dates follow the day this session started, in documents and everywhere else.
  const { pkg, documents } = forSession(loaded.pkg, loaded.documents, dateAnchor(state));
  return { session: s, cohort, pkg, documents, state };
}
