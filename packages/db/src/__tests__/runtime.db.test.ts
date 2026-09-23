import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const MSG = randomUUID();
const THREAD = randomUUID();
import { loadScenario, scenarioDir, DEFAULT_SCENARIO_ID } from "@aporia/scenario";
import { migrate } from "../migrate.js";
import { getDb, getPool, closeDb, databaseUrl } from "../client.js";
import { seedDevData } from "../seed.js";
import { appendEvent, getSessionState, listEvents, rebuildProjections } from "../runtime.js";

const { pkg } = loadScenario(scenarioDir(DEFAULT_SCENARIO_ID));

describe("event log runtime", () => {
  let sessionId: string;
  beforeAll(async () => {
    await migrate(databaseUrl());
    const seeded = await seedDevData(getDb(), pkg, { slug: `test-${Date.now()}`, testMode: true });
    sessionId = seeded.sessionId;
  });
  afterAll(async () => {
    await closeDb();
  });

  it("appends events with contiguous seq, steps the engine, projects and enqueues jobs", async () => {
    const r = await appendEvent(sessionId, { type: "session_started", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: "0.1.0", associateFirstName: "Sam" } }, "api", pkg);
    expect(r.seq).toBe(1);
    expect(r.jobs.map((j) => j.kind)).toEqual(["beat"]);
    const queued = await getPool().query(`select queue_name, task_identifier from graphile_worker.jobs`);
    expect(queued.rows.some((row) => row.queue_name === `session:${sessionId}`)).toBe(true);

    const r2 = await appendEvent(sessionId, {
      type: "message_delivered",
      payload: { messageId: MSG, threadId: THREAD, threadKey: "orientation", beatId: "B-M1-welcome", kind: "beat", from: "senior_associate", to: ["associate"], cc: [], subject: "Start here", body: "Welcome", attachments: [], jobKey: "beat:B-M1-welcome" },
    }, "worker", pkg, { idempotencyKey: `${sessionId}:deliver:beat:B-M1-welcome` });
    expect(r2.seq).toBe(2);
    expect(r2.state.assignments["A1"]?.status).toBe("open");
    const msgs = await getPool().query(`select * from messages where session_id = $1`, [sessionId]);
    expect(msgs.rowCount).toBe(1);
    const sess = await getPool().query(`select status, current_milestone from sessions where id = $1`, [sessionId]);
    expect(sess.rows[0]).toEqual({ status: "in_progress", current_milestone: "M1" });
  });

  it("ignores duplicate idempotency keys", async () => {
    const dup = await appendEvent(sessionId, {
      type: "message_delivered",
      payload: { messageId: MSG, threadId: THREAD, threadKey: "orientation", beatId: "B-M1-welcome", kind: "beat", from: "senior_associate", to: ["associate"], cc: [], subject: "Start here", body: "Welcome", attachments: [] },
    }, "worker", pkg, { idempotencyKey: `${sessionId}:deliver:beat:B-M1-welcome` });
    expect(dup.duplicate).toBe(true);
    expect((await listEvents(sessionId)).length).toBe(2);
  });

  it("rebuilds projections and snapshot from the log to the same state", async () => {
    const before = await getSessionState(sessionId, pkg);
    await getPool().query(`delete from session_snapshots where session_id = $1`, [sessionId]);
    const replayed = await getSessionState(sessionId, pkg);
    expect(replayed).toEqual(before);
    const rebuilt = await rebuildProjections(sessionId, pkg);
    expect(rebuilt).toEqual(before);
    const msgs = await getPool().query(`select count(*)::int as n from messages where session_id = $1`, [sessionId]);
    expect(msgs.rows[0].n).toBe(1);
  });

  it("refuses to update or delete events", async () => {
    await expect(getPool().query(`update events set type = 'x' where session_id = $1`, [sessionId])).rejects.toThrow(/append-only/);
    await expect(getPool().query(`delete from events where session_id = $1`, [sessionId])).rejects.toThrow(/append-only/);
  });
});
