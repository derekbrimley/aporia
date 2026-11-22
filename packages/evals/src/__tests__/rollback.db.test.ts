import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseUrl, ensureSession, getDb, getPool, getSessionState, rollbackSession, sessionRollbackPoints } from "@rematter/db";
import { ENGINE_VERSION, type EngineEvent, type RollbackPoint } from "@rematter/engine";
import { DEFAULT_SCENARIO_ID, getScenario } from "@rematter/scenario";
import { getProvider } from "@rematter/worker";
import { BotAssociate } from "../bot.js";
import { loadPath } from "../path.js";
import { runPlaythrough, shutdown } from "../run.js";

const { pkg } = getScenario(DEFAULT_SCENARIO_ID);
const pool = () => getPool();

async function events(sessionId: string): Promise<EngineEvent[]> {
  const rows = (await pool().query<{ type: string; payload: unknown; occurred_at: Date }>(`select type, payload, occurred_at from events where session_id = $1 order by seq`, [sessionId])).rows;
  return rows.map((r) => ({ type: r.type, payload: r.payload, at: r.occurred_at.toISOString() }) as EngineEvent);
}

async function owner(sessionId: string) {
  return (await pool().query<{ user_id: string; cohort_id: string; org_id: string }>(`select user_id, cohort_id, org_id from sessions where id = $1`, [sessionId])).rows[0]!;
}

async function liveSessions(sessionId: string): Promise<string[]> {
  const o = await owner(sessionId);
  return (await pool().query<{ id: string }>(`select id from sessions where user_id = $1 and cohort_id = $2 and archived_at is null`, [o.user_id, o.cohort_id])).rows.map((r) => r.id);
}

describe("admin session rollback", () => {
  let source: string;
  let points: RollbackPoint[];
  const admin = randomUUID();

  beforeAll(async () => {
    const report = await runPlaythrough({ pathName: "strong", seed: 4, quiet: true });
    expect(report.status).toBe("completed");
    source = report.sessionId;
    points = await sessionRollbackPoints(source, pkg);
  }, 120_000);
  afterAll(async () => {
    await shutdown();
  });

  it("offers a point before each email and at each milestone, never halfway through a job", async () => {
    const all = await events(source);
    const created = all.filter((e) => e.type === "email_sent" || e.type === "message_delivered").length;
    expect(points.filter((p) => p.beforeMessageId).length).toBeGreaterThan(created / 2);
    expect(points.filter((p) => p.milestoneId).map((p) => p.milestoneId)).toEqual([...pkg.milestones].sort((a, b) => a.order - b.order).map((m) => m.id));
    for (const p of points) expect(["intent_classified", "assessment_recorded", "message_released"]).not.toContain(all[p.eventCount - 1]!.type);
  });

  it("refuses a cut that isn't a rollback point", async () => {
    const all = await events(source);
    const mid = all.findIndex((e) => e.type === "intent_classified") + 1;
    await expect(rollbackSession({ sessionId: source, eventCount: mid, adminUserId: admin, pkg })).rejects.toThrow(/rollback point/);
    expect(await liveSessions(source)).toEqual([source]);
  });

  it("rolls back to before an associate email: old run archived intact, new run keeps the prefix, reads and name", async () => {
    const all = await events(source);
    const before = await getSessionState(source, pkg);
    // The associate's first email in M3.
    const p = points.find((x) => x.beforeMessageId && before.messages[x.beforeMessageId]?.from === "associate" && (before.milestones.M3?.enteredAt ?? "~") < before.messages[x.beforeMessageId]!.at)!;
    expect(p).toBeTruthy();
    // Mark everything read in the source so we can see reads carry over.
    const o = await owner(source);
    for (const id of before.messageOrder) await pool().query(`insert into message_reads (session_id, message_id, org_id) values ($1, $2, $3) on conflict do nothing`, [source, id, o.org_id]);

    const r = await rollbackSession({ sessionId: source, eventCount: p.eventCount, adminUserId: admin, pkg });
    expect(r.archived).toEqual([source]);
    expect(r.droppedEvents).toBe(all.length - p.eventCount);
    const sessionId = r.sessionId!;
    expect(await liveSessions(source)).toEqual([sessionId]);
    const found = await ensureSession(getDb(), { orgId: o.org_id, userId: o.user_id, cohortId: o.cohort_id, scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: ENGINE_VERSION });
    expect(found.id).toBe(sessionId);

    // The old run is untouched.
    expect(await events(source)).toHaveLength(all.length);
    expect((await getSessionState(source, pkg)).status).toBe("completed");

    // The new run is the kept prefix: same emails up to the cut, same name, same milestone.
    const state = (await getSessionState(sessionId, pkg));
    const cut = before.messageOrder.indexOf(p.beforeMessageId!);
    expect(state.messageOrder).toHaveLength(cut);
    expect(state.messageOrder.map((id) => state.messages[id]!.subject)).toEqual(before.messageOrder.slice(0, cut).map((id) => before.messages[id]!.subject));
    expect(state.associateFirstName).toBe(before.associateFirstName);
    expect(state.currentMilestone).toBe("M3");
    expect(state.status).toBe("in_progress");
    const lineage = (await pool().query(`select forked_from_session_id, forked_from_event_count from sessions where id = $1`, [sessionId])).rows[0];
    expect(lineage).toEqual({ forked_from_session_id: source, forked_from_event_count: p.eventCount });
    const n = (await pool().query(`select count(*)::int as n from messages where session_id = $1`, [sessionId])).rows[0].n;
    expect(n).toBe(cut);
    const reads = (await pool().query(`select count(*)::int as n from message_reads where session_id = $1`, [sessionId])).rows[0].n;
    expect(reads).toBe(cut);
  });

  it("plays on from a rolled-back session to closing", async () => {
    const [live] = await liveSessions(source);
    const bot = new BotAssociate(live!, pkg, loadPath("strong"), await getProvider(), databaseUrl(), 4);
    const end = await bot.run();
    expect(end.status).toBe("completed");
    expect(bot.log.stuck).toBe(false);
  }, 120_000);

  it("rolls back to before a character's email and writes it again", async () => {
    const [live] = await liveSessions(source);
    const st = await getSessionState(live!, pkg);
    const pts = await sessionRollbackPoints(live!, pkg);
    const p = pts.filter((x) => x.beforeMessageId && st.messages[x.beforeMessageId]!.from !== "associate").at(-1)!;
    const r = await rollbackSession({ sessionId: live!, eventCount: p.eventCount, adminUserId: admin, pkg });
    const after = await getSessionState(r.sessionId!, pkg);
    expect(after.messageOrder).toHaveLength(st.messageOrder.indexOf(p.beforeMessageId!));
    // The job that wrote it is planned again on the new session's queue.
    const jobs = (await pool().query(`select count(*)::int as n from graphile_worker.jobs where queue_name = $1`, [`session:${r.sessionId}`])).rows[0].n;
    expect(jobs).toBeGreaterThan(0);
    const bot = new BotAssociate(r.sessionId!, pkg, loadPath("strong"), await getProvider(), databaseUrl(), 4);
    expect((await bot.run()).status).toBe("completed");
  }, 120_000);

  it("discards held emails of the archived run, and a new run can hold the same beat", async () => {
    const [live] = await liveSessions(source);
    const o = await owner(live!);
    await pool().query(`insert into held_emails (org_id, session_id, job_key, job_payload, proposed_delivery, violations) values ($1, $2, 'beat:test', '{}', '{}', '[]')`, [o.org_id, live]);
    const pts = await sessionRollbackPoints(live!, pkg);
    const r = await rollbackSession({ sessionId: live!, eventCount: pts.at(-1)!.eventCount, adminUserId: admin, pkg });
    expect(r.discardedHeld).toBe(1);
    const held = (await pool().query(`select status, reviewed_by from held_emails where session_id = $1`, [live])).rows[0];
    expect(held).toEqual({ status: "discarded", reviewed_by: admin });
    await pool().query(`insert into held_emails (org_id, session_id, job_key, job_payload, proposed_delivery, violations) values ($1, $2, 'beat:test', '{}', '{}', '[]')`, [o.org_id, r.sessionId]);
  });

  it("resets: archives the run and leaves the tester with no live session until they come back", async () => {
    const [live] = await liveSessions(source);
    const r = await rollbackSession({ sessionId: live!, eventCount: 0, adminUserId: admin, pkg });
    expect(r.sessionId).toBeNull();
    expect(r.archived).toEqual([live]);
    expect(await liveSessions(source)).toEqual([]);
    expect((await events(live!)).length).toBeGreaterThan(0);
  });
});
