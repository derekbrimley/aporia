import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { loadScenario, scenarioDir, DEFAULT_SCENARIO_ID } from "@rematter/scenario";
import {
  appendEvent,
  closeDb,
  databaseUrl,
  getDb,
  getPool,
  getSessionState,
  migrate,
  seedDevData,
} from "@rematter/db";
import type { Job } from "@rematter/engine";
import { discardHeldEmail, releaseHeldEmail } from "../held.js";

const { pkg } = loadScenario(scenarioDir(DEFAULT_SCENARIO_ID));

describe("held emails", () => {
  let sessionId: string;
  let orgId: string;
  let adminId: string;
  const welcome: Job = {
    key: "beat:B-M1-welcome",
    kind: "beat",
    delaySeconds: 0,
    payload: { kind: "beat", beatId: "B-M1-welcome" },
  };

  async function hold(job: Job, payload: Record<string, unknown>) {
    const r = await getPool().query<{ id: string }>(
      `insert into held_emails (org_id, session_id, job_key, job_payload, proposed_delivery, violations) values ($1, $2, $3, $4, $5, '[]') returning id`,
      [
        orgId,
        sessionId,
        job.key,
        JSON.stringify(job),
        JSON.stringify({ type: "message_delivered", payload }),
      ],
    );
    await appendEvent(
      sessionId,
      { type: "message_held", payload: { jobKey: job.key, reason: "test", kind: "beat" } },
      "worker",
      pkg,
      { idempotencyKey: `${sessionId}:held:${job.key}` },
    );
    return r.rows[0]!.id;
  }

  beforeAll(async () => {
    await migrate(databaseUrl());
    const seeded = await seedDevData(getDb(), pkg, { slug: `held-${Date.now()}`, testMode: true });
    ({ sessionId, orgId, internalAdminId: adminId } = seeded);
    await appendEvent(
      sessionId,
      {
        type: "session_started",
        payload: {
          scenarioId: pkg.meta.id,
          scenarioVersion: pkg.meta.version,
          engineVersion: "0.4.0",
          associateFirstName: "Sam",
        },
      },
      "api",
      pkg,
    );
  });
  afterAll(async () => {
    await closeDb();
  });

  it("discarding a held beat tells the engine, which queues a rewrite", async () => {
    const id = await hold(welcome, {});
    await discardHeldEmail(id, adminId);
    const state = await getSessionState(sessionId, pkg);
    expect(state.jobs).toMatchObject({
      "beat:B-M1-welcome": "discarded",
      "beat:B-M1-welcome#2": "enqueued",
    });
    const queued = await getPool().query(
      `select key from graphile_worker.jobs where queue_name = $1`,
      [`session:${sessionId}`],
    );
    expect(queued.rows.map((r) => r.key)).toContain(`${sessionId}:beat:B-M1-welcome#2`);
    const row = await getPool().query(`select status from held_emails where id = $1`, [id]);
    expect(row.rows[0].status).toBe("discarded");
    await expect(discardHeldEmail(id, adminId)).rejects.toThrow(/already reviewed/);
  });

  it("releases a held email once, in one transaction", async () => {
    const job: Job = { ...welcome, key: "beat:B-M1-welcome#2" };
    const messageId = randomUUID();
    const id = await hold(job, {
      messageId,
      threadId: randomUUID(),
      threadKey: "orientation",
      beatId: "B-M1-welcome",
      kind: "beat",
      from: "senior_associate",
      to: ["associate"],
      cc: [],
      subject: "Start here",
      body: "Welcome",
      attachments: [],
      jobKey: job.key,
    });
    await releaseHeldEmail(id, adminId, "Welcome, edited");
    const state = await getSessionState(sessionId, pkg);
    expect(state.beats["B-M1-welcome"]).toBe("delivered");
    expect(state.jobs[job.key]).toBe("completed");
    expect(state.messages[messageId]?.body).toBe("Welcome, edited");
    await expect(releaseHeldEmail(id, adminId)).rejects.toThrow(/already reviewed/);
  });
});
