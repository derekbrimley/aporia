import { randomUUID } from "node:crypto";
import type pg from "pg";
import { forkEvents, replay, initialState, rollbackPoints, type EngineEvent, type RollbackPoint, type SessionState } from "@rematter/engine";
import type { ScenarioPackage } from "@rematter/scenario";
import { replayIntoNewSession } from "./checkpoints.js";
import { getPool } from "./client.js";

async function sessionEvents(client: pg.PoolClient | pg.Pool, sessionId: string): Promise<EngineEvent[]> {
  const rows = (await client.query<{ type: string; payload: unknown; occurred_at: Date }>(
    `select type, payload, occurred_at from events where session_id = $1 order by seq asc`,
    [sessionId],
  )).rows;
  return rows.map((r) => ({ type: r.type, payload: r.payload, at: r.occurred_at.toISOString() }) as EngineEvent);
}

/** Where an admin can roll this session back to (see engine `rollbackPoints`). */
export async function sessionRollbackPoints(sessionId: string, pkg: ScenarioPackage): Promise<RollbackPoint[]> {
  const pool = getPool();
  const sess = (await pool.query<{ test_mode: boolean }>(`select test_mode from sessions where id = $1`, [sessionId])).rows[0];
  if (!sess) return [];
  return rollbackPoints(await sessionEvents(pool, sessionId), pkg, { zeroDelays: sess.test_mode });
}

export interface RollbackArgs {
  sessionId: string;
  /**
   * How many events to keep: one of the session's rollback points. 0 is a full reset: the tester's
   * run is archived and they get a brand-new session (welcome email and all) the next time they open the inbox.
   */
  eventCount: number;
  /** Recorded on held emails this throws away. */
  adminUserId: string;
  pkg: ScenarioPackage;
  now?: Date;
}

export interface RollbackResult {
  /** Sessions archived by this rollback: the one rolled back, if it was live, and any other live run it replaced. */
  archived: string[];
  /** The new session, or null after a full reset. */
  sessionId: string | null;
  state: SessionState | null;
  /** Events of the old run that the new session doesn't have. */
  droppedEvents: number;
  /** Held emails in the archived runs that were waiting for review and are now discarded. */
  discardedHeld: number;
}

/**
 * Rolls a tester's session back to an earlier point, without deleting anything.
 *
 * The event log is append-only, so the session isn't edited: it's archived whole (events, emails, model
 * generations, flags: still on the admin page and still exportable), and its first `eventCount` events are
 * replayed into a new session for the same associate, with the same name, deal dates and time zone. Times
 * shift so the last kept event is now. Jobs that were planned but not done at that point (a reply, a scheduled
 * email) are planned again, so anything after the cut is written afresh by the model.
 *
 * Nothing is sent to the tester: in-game emails only live in the app's inbox, leftover jobs of an archived
 * session do nothing (see the worker's `runSessionJob`), and held emails in the archived run are discarded.
 * Emails they had opened stay opened.
 */
export async function rollbackSession(args: RollbackArgs): Promise<RollbackResult> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    // Locking the row makes the cut wait for any event being appended right now, so the log can't move under it.
    const sess = (await client.query<{ org_id: string; user_id: string; cohort_id: string; scenario_id: string; scenario_version: string; test_mode: boolean; time_zone: string | null }>(
      `select org_id, user_id, cohort_id, scenario_id, scenario_version, test_mode, time_zone from sessions where id = $1 for update`,
      [args.sessionId],
    )).rows[0];
    if (!sess) throw new Error(`Session ${args.sessionId} not found`);
    if (sess.scenario_id !== args.pkg.meta.id || sess.scenario_version !== args.pkg.meta.version) {
      throw new Error(`Session is ${sess.scenario_id}@${sess.scenario_version}, not ${args.pkg.meta.id}@${args.pkg.meta.version}`);
    }
    const opts = { zeroDelays: sess.test_mode };
    const all = await sessionEvents(client, args.sessionId);
    if (args.eventCount !== 0 && !rollbackPoints(all, args.pkg, opts).some((p) => p.eventCount === args.eventCount)) {
      throw new Error(`Can't roll back to event ${args.eventCount}: it isn't one of this session's rollback points.`);
    }
    const now = args.now ?? new Date();

    const archived = (await client.query<{ id: string }>(
      `update sessions set archived_at = $3 where user_id = $1 and cohort_id = $2 and archived_at is null returning id`,
      [sess.user_id, sess.cohort_id, now],
    )).rows.map((r) => r.id);
    const discardedHeld = (await client.query(
      `update held_emails set status = 'discarded', reviewed_by = $2, reviewed_at = $3 where session_id = any($1::uuid[]) and status = 'held'`,
      [[...new Set([...archived, args.sessionId])], args.adminUserId, now],
    )).rowCount ?? 0;

    if (args.eventCount === 0) {
      await client.query("commit");
      return { archived, sessionId: null, state: null, droppedEvents: all.length, discardedHeld };
    }

    const started = all.find((e) => e.type === "session_started");
    const firstName = started?.type === "session_started" ? started.payload.associateFirstName : "";
    const events = forkEvents(all, args.eventCount, { now: now.toISOString(), newId: randomUUID, firstName });
    const { sessionId, state } = await replayIntoNewSession(client, {
      orgId: sess.org_id, userId: sess.user_id, cohortId: sess.cohort_id, pkg: args.pkg, testMode: sess.test_mode, timeZone: sess.time_zone,
      events, actor: "rollback", forkedFrom: { sessionId: args.sessionId, eventCount: args.eventCount },
    });

    // Emails they had opened stay opened. Messages come out of the replay in the same order, so the old
    // prefix's message order maps old ids to new ones.
    const oldOrder = replay(all.slice(0, args.eventCount), args.pkg, initialState(args.pkg), opts).messageOrder;
    const idMap = new Map(oldOrder.map((id, i) => [id, state.messageOrder[i]!] as const));
    const reads = (await client.query<{ message_id: string; read_at: Date }>(
      `select message_id, read_at from message_reads where session_id = $1 and message_id = any($2::uuid[])`,
      [args.sessionId, oldOrder],
    )).rows;
    for (const r of reads) {
      const id = idMap.get(r.message_id);
      if (!id) continue;
      await client.query(`insert into message_reads (session_id, message_id, org_id, read_at) values ($1, $2, $3, $4) on conflict do nothing`, [sessionId, id, sess.org_id, r.read_at]);
    }
    // The rollback isn't a return from a break: no "welcome back" recap for it.
    await client.query(`update sessions set last_activity_at = $2 where id = $1`, [sessionId, now]);
    await client.query("commit");
    return { archived, sessionId, state, droppedEvents: all.length - args.eventCount, discardedHeld };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
