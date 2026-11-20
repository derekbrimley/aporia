import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool, getSessionState } from "@rematter/db";
import { getScenario } from "@rematter/scenario";
import { MockProvider } from "@rematter/worker";
import { CaseError, FlagCaseSchema, buildFlagCase, caseState, loadCases, replayCase, type FlagCase } from "../cases.js";
import { runPlaythrough, shutdown } from "../run.js";

const SCENARIO = "acme-merger-01";
const { pkg } = getScenario(SCENARIO);

describe("eval cases from tester flags", () => {
  let sessionId: string;
  let messageCase: FlagCase;
  let threadCase: FlagCase;
  let flagged: { id: string; threadId: string; body: string; from: string };

  beforeAll(async () => {
    const report = await runPlaythrough({ pathName: "realistic", seed: 2, scenarioId: SCENARIO, quiet: true });
    sessionId = report.sessionId;
    const state = await getSessionState(sessionId, pkg);
    const m = state.messageOrder.map((id) => state.messages[id]!).find((x) => x.from === "senior_associate" && x.kind === "reply")!;
    flagged = { id: m.id, threadId: m.threadId, body: m.body, from: m.from };
    const row = (await getPool().query<{ org_id: string; user_id: string }>(`select org_id, user_id from sessions where id = $1`, [sessionId])).rows[0]!;
    const insert = async (targetType: string, targetId: string, note: string) =>
      (await getPool().query<{ id: string }>(`insert into flags (org_id, session_id, user_id, target_type, target_id, note) values ($1,$2,$3,$4,$5,$6) returning id`, [row.org_id, sessionId, row.user_id, targetType, targetId, note])).rows[0]!.id;
    messageCase = await buildFlagCase(await insert("message", m.id, "Daniel says it's in the term sheet but it isn't"));
    threadCase = await buildFlagCase(await insert("thread", m.threadId, "This keeps going in circles"));
  }, 120_000);
  afterAll(async () => {
    await shutdown();
  });

  it("captures the session up to the flagged email, with the job that wrote it", async () => {
    expect(FlagCaseSchema.parse(JSON.parse(JSON.stringify(messageCase)))).toBeTruthy();
    expect(messageCase.flagged.body).toBe(flagged.body);
    expect(messageCase.flagged.from).toBe(flagged.from);
    expect(messageCase.job.kind).toBe("character_reply");
    // The rebuilt session stops just before the flagged email, and ids are not the source session's.
    const st = caseState(messageCase);
    expect(Object.values(st.messages).some((x) => x.body === flagged.body)).toBe(false);
    expect(JSON.stringify(messageCase.events)).not.toContain(flagged.id);
    expect(messageCase.expectation).toBe(messageCase.flag.note);
  });

  it("replays a thread flag against the last character email on that thread before it", () => {
    expect(threadCase.flagged.threadId).not.toBe(flagged.threadId); // remapped
    expect(threadCase.flag.targetType).toBe("thread");
    expect(threadCase.events.length).toBeGreaterThanOrEqual(messageCase.events.length);
  });

  it("refuses document flags", async () => {
    const row = (await getPool().query<{ org_id: string; user_id: string }>(`select org_id, user_id from sessions where id = $1`, [sessionId])).rows[0]!;
    const id = (await getPool().query<{ id: string }>(`insert into flags (org_id, session_id, user_id, target_type, target_id, note) values ($1,$2,$3,'document','term-sheet','typo') returning id`, [row.org_id, sessionId, row.user_id])).rows[0]!.id;
    await expect(buildFlagCase(id)).rejects.toBeInstanceOf(CaseError);
  });

  it("writes the email again without a database and judges it", async () => {
    const r = await replayCase(messageCase, new MockProvider());
    expect(r.error).toBeUndefined();
    expect(r.samples).toHaveLength(1);
    expect(r.samples[0]!.body.length).toBeGreaterThan(0);
    expect(r.pass).toBe(true);
    const failing = new MockProvider();
    failing.overrides.set("flag_judge", () => ({ repeats_problem: true, notes: "still claims it is in the term sheet" }));
    const bad = await replayCase(messageCase, failing, { samples: 2 });
    expect(bad.pass).toBe(false);
    expect(bad.repeats).toBe(2);
  });

  it("loads case files from a folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cases-"));
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify(messageCase));
    expect(loadCases(dir).map((c) => c.id)).toEqual([messageCase.id]);
  });
});
