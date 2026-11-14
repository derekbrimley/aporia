import { randomUUID } from "node:crypto";
import type pg from "pg";
import { ENGINE_VERSION, findCheckpoints, forkEvents, initialState, step, type Checkpoint, type EngineEvent, type Job, type SessionState } from "@rematter/engine";
import type { ScenarioPackage } from "@rematter/scenario";
import { getPool } from "./client.js";
import { applyProjection } from "./projections.js";
import { enqueueJob } from "./runtime.js";

async function sourceEvents(client: pg.PoolClient | pg.Pool, sessionId: string): Promise<EngineEvent[]> {
  const rows = (await client.query<{ type: string; payload: unknown; occurred_at: Date }>(
    `select type, payload, occurred_at from events where session_id = $1 order by seq asc`,
    [sessionId],
  )).rows;
  return rows.map((r) => ({ type: r.type, payload: r.payload, at: r.occurred_at.toISOString() }) as EngineEvent);
}

/** The milestones a source session can be loaded from (see engine `findCheckpoints`). */
export async function sessionCheckpoints(sourceSessionId: string, pkg: ScenarioPackage): Promise<Checkpoint[]> {
  const pool = getPool();
  const sess = (await pool.query<{ test_mode: boolean }>(`select test_mode from sessions where id = $1`, [sourceSessionId])).rows[0];
  if (!sess) return [];
  return findCheckpoints(await sourceEvents(pool, sourceSessionId), pkg, { zeroDelays: sess.test_mode });
}

export interface ForkArgs {
  sourceSessionId: string;
  /** Must be one of the source's checkpoints. */
  eventCount: number;
  orgId: string;
  userId: string;
  cohortId: string;
  firstName: string;
  pkg: ScenarioPackage;
  now?: Date;
}

/**
 * Loads a test checkpoint for one associate: archives their current session in the cohort and
 * starts a new one from the first `eventCount` events of the source run, replayed through the
 * engine so projections, snapshot and pending jobs are exactly what a live session would have.
 * Nothing else in the cohort is touched.
 */
export async function forkSessionAtCheckpoint(args: ForkArgs): Promise<{ sessionId: string; state: SessionState }> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const src = (await client.query<{ scenario_id: string; scenario_version: string; test_mode: boolean; time_zone: string | null }>(
      `select scenario_id, scenario_version, test_mode, time_zone from sessions where id = $1`,
      [args.sourceSessionId],
    )).rows[0];
    if (!src) throw new Error(`Source session ${args.sourceSessionId} not found`);
    if (src.scenario_id !== args.pkg.meta.id || src.scenario_version !== args.pkg.meta.version) {
      throw new Error(`Source session is ${src.scenario_id}@${src.scenario_version}, not ${args.pkg.meta.id}@${args.pkg.meta.version}`);
    }
    const opts = { zeroDelays: src.test_mode };
    const all = await sourceEvents(client, args.sourceSessionId);
    if (!findCheckpoints(all, args.pkg, opts).some((c) => c.eventCount === args.eventCount)) throw new Error(`No checkpoint at event ${args.eventCount}`);
    const now = args.now ?? new Date();
    const events = forkEvents(all, args.eventCount, { now: now.toISOString(), newId: randomUUID, firstName: args.firstName });

    await client.query(`update sessions set archived_at = $3 where user_id = $1 and cohort_id = $2 and archived_at is null`, [args.userId, args.cohortId, now]);
    const sessionId = (await client.query<{ id: string }>(
      // The fork keeps the source's date anchor, so it keeps the source's time zone too: its dates then match the source's emails.
      `insert into sessions (org_id, user_id, cohort_id, scenario_id, scenario_version, engine_version, test_mode, time_zone) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [args.orgId, args.userId, args.cohortId, args.pkg.meta.id, args.pkg.meta.version, ENGINE_VERSION, src.test_mode, src.time_zone],
    )).rows[0]!.id;

    let state = initialState(args.pkg);
    const planned = new Map<string, { job: Job; at: string }>();
    let seq = 0;
    for (const ev of events) {
      const res = step(state, ev, args.pkg, opts);
      state = res.state;
      seq += 1;
      await client.query(
        `insert into events (org_id, session_id, seq, type, payload, actor, occurred_at) values ($1, $2, $3, $4, $5, $6, $7)`,
        [args.orgId, sessionId, seq, ev.type, JSON.stringify(ev.payload), "checkpoint", ev.at],
      );
      await applyProjection(client, { sessionId, orgId: args.orgId, seq }, ev, state, res.effects);
      for (const e of res.effects) if (e.type === "enqueue_job") planned.set(e.job.key, { job: e.job, at: ev.at });
    }
    await client.query(
      `insert into session_snapshots (session_id, org_id, event_seq, engine_version, state, updated_at) values ($1, $2, $3, $4, $5, now())`,
      [sessionId, args.orgId, seq, state.engineVersion, JSON.stringify(state)],
    );
    // Jobs the source run still had in flight at the checkpoint are planned again for this session.
    for (const [key, p] of planned) if (state.jobs[key] === "enqueued") await enqueueJob(client, sessionId, p.job, p.at);

    // Everything before the current milestone reads as already opened, so the inbox starts where the
    // associate would be: earlier threads read, this milestone's emails new.
    const entered = state.currentMilestone ? state.milestones[state.currentMilestone]?.enteredAt ?? null : null;
    const read = state.messageOrder.map((id) => state.messages[id]!).filter((m) => m.from !== "associate" && (state.status === "completed" || !entered || m.at < entered));
    for (const m of read) {
      await client.query(`insert into message_reads (session_id, message_id, org_id, read_at) values ($1, $2, $3, $4) on conflict do nothing`, [sessionId, m.id, args.orgId, m.at]);
    }
    // No "welcome back" recap for a session that was just loaded.
    await client.query(`update sessions set last_activity_at = $2 where id = $1`, [sessionId, now]);
    await client.query("commit");
    return { sessionId, state };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
