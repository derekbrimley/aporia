import { and, asc, eq, sql } from "drizzle-orm";
import type pg from "pg";
import { initialState, replay, step, type Effect, type EngineEvent, type Job, type SessionState, type StepOptions } from "@aporia/engine";
import type { ScenarioPackage } from "@aporia/scenario";
import { getDb, getPool, type Db } from "./client.js";
import { applyProjection, clearProjections } from "./projections.js";
import * as t from "./schema.js";

export const SESSION_TASK = "session_job";

export interface AppendResult {
  seq: number;
  eventId: string;
  state: SessionState;
  effects: Effect[];
  jobs: Job[];
  /** True when the idempotency key was already present and nothing was appended. */
  duplicate: boolean;
}

export interface SessionRow {
  id: string;
  orgId: string;
  userId: string;
  cohortId: string;
  scenarioId: string;
  scenarioVersion: string;
  testMode: boolean;
}

/**
 * Appends one event to a session's log, steps the engine, writes projections
 * and enqueues the planned jobs, all in one transaction on one row lock.
 * This is the only write path for events: the API and the worker both use it.
 */
export async function appendEvent(
  sessionId: string,
  event: Omit<EngineEvent, "at"> & { at?: string },
  actor: string,
  pkg: ScenarioPackage,
  opts: { idempotencyKey?: string; stepOptions?: StepOptions; client?: pg.PoolClient } = {},
): Promise<AppendResult> {
  const own = !opts.client;
  const client = opts.client ?? (await getPool().connect());
  try {
    if (own) await client.query("begin");
    const sess = (await client.query<{ id: string; org_id: string; test_mode: boolean; scenario_id: string; scenario_version: string }>(
      `select id, org_id, test_mode, scenario_id, scenario_version from sessions where id = $1 for update`,
      [sessionId],
    )).rows[0];
    if (!sess) throw new Error(`Session ${sessionId} not found`);
    if (sess.scenario_id !== pkg.meta.id || sess.scenario_version !== pkg.meta.version) {
      throw new Error(`Session ${sessionId} is pinned to ${sess.scenario_id}@${sess.scenario_version}, not ${pkg.meta.id}@${pkg.meta.version}`);
    }
    if (opts.idempotencyKey) {
      const dup = await client.query(`select 1 from events where idempotency_key = $1`, [opts.idempotencyKey]);
      if (dup.rowCount) {
        const snap = await loadSnapshot(client, sessionId, pkg);
        if (own) await client.query("commit");
        return { seq: snap.seq, eventId: "", state: snap.state, effects: [], jobs: [], duplicate: true };
      }
    }
    const at = event.at ?? new Date().toISOString();
    const full = { ...event, at } as EngineEvent;
    const stepOpts: StepOptions = { zeroDelays: sess.test_mode, ...opts.stepOptions };

    const snap = await loadSnapshot(client, sessionId, pkg, stepOpts);
    const seq = snap.seq + 1;
    const { state, effects } = step(snap.state, full, pkg, stepOpts);

    const inserted = await client.query<{ id: string }>(
      `insert into events (org_id, session_id, seq, type, payload, actor, idempotency_key, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [sess.org_id, sessionId, seq, full.type, JSON.stringify(full.payload), actor, opts.idempotencyKey ?? null, at],
    );
    await client.query(
      `insert into session_snapshots (session_id, org_id, event_seq, engine_version, state, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (session_id) do update set event_seq = excluded.event_seq, engine_version = excluded.engine_version, state = excluded.state, updated_at = now()`,
      [sessionId, sess.org_id, seq, state.engineVersion, JSON.stringify(state)],
    );
    await applyProjection(client, { sessionId, orgId: sess.org_id, seq }, full, state, effects);

    const jobs: Job[] = [];
    for (const e of effects) {
      if (e.type !== "enqueue_job") continue;
      jobs.push(e.job);
      await enqueueJob(client, sessionId, e.job, at);
    }
    if (own) await client.query("commit");
    return { seq, eventId: inserted.rows[0]!.id, state, effects, jobs, duplicate: false };
  } catch (e) {
    if (own) await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    if (own) client.release();
  }
}

/** Enqueues a job on the session's serial lane using graphile-worker's SQL API (transactional). */
export async function enqueueJob(client: pg.PoolClient | pg.Client, sessionId: string, job: Job, fromIso: string): Promise<void> {
  const runAt = new Date(Date.parse(fromIso) + job.delaySeconds * 1000).toISOString();
  await client.query(
    `select graphile_worker.add_job($1, payload := $2::json, queue_name := $3, run_at := $4::timestamptz, max_attempts := $5, job_key := $6, job_key_mode := 'preserve_run_at')`,
    [SESSION_TASK, JSON.stringify({ sessionId, job }), `session:${sessionId}`, runAt, 4, `${sessionId}:${job.key}`],
  );
}

export async function loadSnapshot(client: pg.PoolClient | pg.Client, sessionId: string, pkg: ScenarioPackage, stepOpts: StepOptions = {}): Promise<{ seq: number; state: SessionState }> {
  const snap = (await client.query<{ event_seq: number; state: SessionState; engine_version: string }>(
    `select event_seq, state, engine_version from session_snapshots where session_id = $1`,
    [sessionId],
  )).rows[0];
  const last = (await client.query<{ seq: number }>(`select coalesce(max(seq), 0) as seq from events where session_id = $1`, [sessionId])).rows[0]!.seq;
  if (snap && snap.event_seq === last && snap.engine_version === initialState(pkg).engineVersion) return { seq: last, state: snap.state };
  // Snapshot missing or stale: replay.
  const rows = (await client.query<{ type: string; payload: unknown; occurred_at: Date }>(
    `select type, payload, occurred_at from events where session_id = $1 order by seq asc`,
    [sessionId],
  )).rows;
  const events = rows.map((r) => ({ type: r.type, payload: r.payload, at: r.occurred_at.toISOString() }) as EngineEvent);
  return { seq: last, state: replay(events, pkg, initialState(pkg), stepOpts) };
}

/** Current state for a session (from the snapshot, replaying if stale). */
export async function getSessionState(sessionId: string, pkg: ScenarioPackage): Promise<SessionState> {
  const client = await getPool().connect();
  try {
    const sess = (await client.query<{ test_mode: boolean }>(`select test_mode from sessions where id = $1`, [sessionId])).rows[0];
    if (!sess) throw new Error(`Session ${sessionId} not found`);
    return (await loadSnapshot(client, sessionId, pkg, { zeroDelays: sess.test_mode })).state;
  } finally {
    client.release();
  }
}

export async function listEvents(sessionId: string): Promise<(EngineEvent & { seq: number; actor: string; id: string })[]> {
  const db = getDb();
  const rows = await db.select().from(t.events).where(eq(t.events.sessionId, sessionId)).orderBy(asc(t.events.seq));
  return rows.map((r) => ({ id: r.id, seq: r.seq, actor: r.actor, type: r.type, payload: r.payload, at: r.occurredAt.toISOString() }) as EngineEvent & { seq: number; actor: string; id: string });
}

/** Drops and rebuilds every projection row for a session from its event log. */
export async function rebuildProjections(sessionId: string, pkg: ScenarioPackage): Promise<SessionState> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const sess = (await client.query<{ org_id: string; test_mode: boolean }>(`select org_id, test_mode from sessions where id = $1 for update`, [sessionId])).rows[0];
    if (!sess) throw new Error(`Session ${sessionId} not found`);
    await clearProjections(client, sessionId);
    const rows = (await client.query<{ seq: number; type: string; payload: unknown; occurred_at: Date }>(
      `select seq, type, payload, occurred_at from events where session_id = $1 order by seq asc`,
      [sessionId],
    )).rows;
    let state = initialState(pkg);
    const opts: StepOptions = { zeroDelays: sess.test_mode };
    let seq = 0;
    for (const r of rows) {
      const ev = { type: r.type, payload: r.payload, at: r.occurred_at.toISOString() } as EngineEvent;
      const res = step(state, ev, pkg, opts);
      state = res.state;
      seq = r.seq;
      await applyProjection(client, { sessionId, orgId: sess.org_id, seq: r.seq }, ev, state, res.effects);
    }
    await client.query(
      `insert into session_snapshots (session_id, org_id, event_seq, engine_version, state, updated_at) values ($1, $2, $3, $4, $5, now())
       on conflict (session_id) do update set event_seq = excluded.event_seq, engine_version = excluded.engine_version, state = excluded.state, updated_at = now()`,
      [sessionId, sess.org_id, seq, state.engineVersion, JSON.stringify(state)],
    );
    await client.query("commit");
    return state;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Finds or creates the associate's session in a cohort. Does not start it. */
export async function ensureSession(db: Db, args: { orgId: string; userId: string; cohortId: string; scenarioId: string; scenarioVersion: string; engineVersion: string; testMode?: boolean }): Promise<SessionRow> {
  const existing = await db.select().from(t.sessions).where(and(eq(t.sessions.userId, args.userId), eq(t.sessions.cohortId, args.cohortId))).limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db.insert(t.sessions).values({
    orgId: args.orgId, userId: args.userId, cohortId: args.cohortId, scenarioId: args.scenarioId, scenarioVersion: args.scenarioVersion,
    engineVersion: args.engineVersion, testMode: args.testMode ?? false,
  }).returning();
  return row!;
}

/** Adds activity time (capped per gap) to the session's total. */
export async function recordActivity(sessionId: string, at: Date): Promise<void> {
  await getPool().query(
    `update sessions set active_seconds = active_seconds + least(greatest(extract(epoch from ($2::timestamptz - coalesce(last_activity_at, $2::timestamptz))), 0), 900)::int,
       last_activity_at = $2 where id = $1`,
    [sessionId, at.toISOString()],
  );
}

export { sql };
