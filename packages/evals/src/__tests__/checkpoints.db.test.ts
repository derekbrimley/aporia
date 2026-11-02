import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseUrl, ensureSession, forkSessionAtCheckpoint, getDb, getPool, getSessionState, seedDevData, sessionCheckpoints } from "@rematter/db";
import { ENGINE_VERSION, findCheckpoints, forkEvents, type Checkpoint, type EngineEvent } from "@rematter/engine";
import { DEFAULT_SCENARIO_ID, getScenario } from "@rematter/scenario";
import { getProvider } from "@rematter/worker";
import { BotAssociate } from "../bot.js";
import { loadPath } from "../path.js";
import { runPlaythrough, shutdown } from "../run.js";

const { pkg } = getScenario(DEFAULT_SCENARIO_ID);

describe("test checkpoints", () => {
  let source: string;
  let checkpoints: Checkpoint[];
  let target: Awaited<ReturnType<typeof seedDevData>>;

  beforeAll(async () => {
    const report = await runPlaythrough({ pathName: "strong", seed: 3, quiet: true });
    expect(report.status).toBe("completed");
    source = report.sessionId;
    checkpoints = await sessionCheckpoints(source, pkg);
    // A separate firm and cohort, as a demo cohort would be.
    target = await seedDevData(getDb(), pkg, { slug: `checkpoint-${Date.now()}`, testMode: true });
  }, 120_000);
  afterAll(async () => {
    await shutdown();
  });

  it("finds one checkpoint per milestone, in order, plus the end of the run", () => {
    expect(checkpoints.map((c) => c.milestoneId)).toEqual([...pkg.milestones].sort((a, b) => a.order - b.order).map((m) => m.id).concat([null as unknown as string]));
    const counts = checkpoints.map((c) => c.eventCount);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  });

  it("ends each milestone's checkpoint just before the associate's first action in it", async () => {
    const rows = (await getPool().query<{ type: string; payload: unknown; occurred_at: Date }>(`select type, payload, occurred_at from events where session_id = $1 order by seq`, [source])).rows;
    const events = rows.map((r) => ({ type: r.type, payload: r.payload, at: r.occurred_at.toISOString() }) as EngineEvent);
    for (const c of checkpoints.filter((x) => x.milestoneId)) {
      expect(["email_sent", "document_opened", "documents_compared", "flag_raised"]).toContain(events[c.eventCount]!.type);
    }
    expect(findCheckpoints(events, pkg, { zeroDelays: true })).toEqual(checkpoints);
  });

  it("remaps ids, renames the associate and shifts times without moving deal dates", async () => {
    const rows = (await getPool().query<{ type: string; payload: unknown; occurred_at: Date }>(`select type, payload, occurred_at from events where session_id = $1 order by seq`, [source])).rows;
    const events = rows.map((r) => ({ type: r.type, payload: r.payload, at: r.occurred_at.toISOString() }) as EngineEvent);
    let n = 0;
    const forked = forkEvents(events, 30, { now: "2030-01-01T12:00:00.000Z", newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, firstName: "Derek" });
    expect(forked).toHaveLength(30);
    expect(forked[29]!.at).toBe("2030-01-01T12:00:00.000Z");
    const started = forked[0]!;
    expect(started.type === "session_started" && started.payload.associateFirstName).toBe("Derek");
    expect(started.type === "session_started" && started.payload.dateAnchor).toBe(events[0]!.at);
    const text = JSON.stringify(forked.slice(1).map((e) => e.payload));
    expect(text).not.toMatch(/\bSam\b/);
    for (const e of events.slice(0, 30)) {
      const id = (e.payload as { messageId?: string }).messageId;
      if (id) expect(text).not.toContain(id);
    }
  });

  it("loads a checkpoint into a fresh session for one associate and archives the old one", async () => {
    const m3 = checkpoints.find((c) => c.milestoneId === "M3")!;
    const before = await getSessionState(target.sessionId, pkg);
    expect(before.status).toBe("not_started");
    const { sessionId, state } = await forkSessionAtCheckpoint({ sourceSessionId: source, eventCount: m3.eventCount, orgId: target.orgId, userId: target.associateId, cohortId: target.cohortId, firstName: "Derek", pkg });
    expect(sessionId).not.toBe(target.sessionId);
    expect(state.currentMilestone).toBe("M3");
    expect(state.associateFirstName).toBe("Derek");
    const old = (await getPool().query(`select archived_at from sessions where id = $1`, [target.sessionId])).rows[0];
    expect(old.archived_at).not.toBeNull();
    // The app now finds the loaded session for this associate.
    const found = await ensureSession(getDb(), { orgId: target.orgId, userId: target.associateId, cohortId: target.cohortId, scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: ENGINE_VERSION });
    expect(found.id).toBe(sessionId);
    // Projections and snapshot match a fresh replay of the new log.
    const msgs = (await getPool().query(`select count(*)::int as n from messages where session_id = $1`, [sessionId])).rows[0].n;
    expect(msgs).toBe(state.messageOrder.length);
    expect((await getSessionState(sessionId, pkg)).messageOrder).toEqual(state.messageOrder);
    // The source run is untouched.
    expect((await getSessionState(source, pkg)).status).toBe("completed");
    // Earlier milestones read as opened; this milestone's emails are new.
    const unread = (await getPool().query(`select count(*)::int as n from messages m where m.session_id = $1 and m.from_participant <> 'associate' and not exists (select 1 from message_reads r where r.session_id = m.session_id and r.message_id = m.id)`, [sessionId])).rows[0].n;
    expect(unread).toBeGreaterThan(0);
    expect(unread).toBeLessThan(msgs);
  });

  it("plays on from a loaded checkpoint to closing", async () => {
    const m5 = checkpoints.find((c) => c.milestoneId === "M5")!;
    const { sessionId } = await forkSessionAtCheckpoint({ sourceSessionId: source, eventCount: m5.eventCount, orgId: target.orgId, userId: target.associateId, cohortId: target.cohortId, firstName: "Derek", pkg });
    const active = (await getPool().query(`select count(*)::int as n from sessions where user_id = $1 and cohort_id = $2 and archived_at is null`, [target.associateId, target.cohortId])).rows[0].n;
    expect(active).toBe(1);
    const bot = new BotAssociate(sessionId, pkg, loadPath("strong"), await getProvider(), databaseUrl(), 3);
    const end = await bot.run();
    expect(end.status).toBe("completed");
    expect(bot.log.stuck).toBe(false);
  }, 120_000);
});
