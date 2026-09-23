import { describe, it, expect } from "vitest";
import { loadScenario, scenarioDir, DEFAULT_SCENARIO_ID, ScenarioIndex } from "@aporia/scenario";
import { initialState, replay, step, openDecisionPoints, type EngineEvent, type Effect, type Job, type SessionState } from "../index.js";

const { pkg } = loadScenario(scenarioDir(DEFAULT_SCENARIO_ID));
const idx = new ScenarioIndex(pkg);
const opts = { zeroDelays: true };

/**
 * A tiny in-memory "worker" that turns enqueued jobs into the events the real
 * worker would append, with canned content. Lets us drive the engine through
 * the whole arc without an LLM.
 */
class Harness {
  state: SessionState = initialState(pkg);
  events: EngineEvent[] = [];
  jobs: Job[] = [];
  effects: Effect[] = [];
  t = Date.parse("2026-10-01T09:00:00Z");
  n = 0;
  raise: Set<string> = new Set();
  positions: Record<string, string> = {};

  now() { this.t += 60_000; return new Date(this.t).toISOString(); }
  id(prefix: string) { return `${prefix}-${++this.n}`; }

  apply(e: Omit<EngineEvent, "at"> & { at?: string }) {
    const event = { ...e, at: e.at ?? this.now() } as EngineEvent;
    const r = step(this.state, event, pkg, opts);
    this.state = r.state;
    this.events.push(event);
    this.effects.push(...r.effects);
    for (const ef of r.effects) if (ef.type === "enqueue_job") this.jobs.push(ef.job);
    return r;
  }

  /** Runs jobs in order (one lane) until the queue is empty. */
  drain() {
    let guard = 0;
    while (this.jobs.length && guard++ < 200) {
      const job = this.jobs.shift()!;
      this.run(job);
    }
    if (guard >= 200) throw new Error("job loop did not settle");
  }

  private deliver(job: Job, from: string, threadId: string, threadKey: string | null, kind: "beat" | "reply" | "reflection" | "recap" | "debrief" | "doctrine" | "interruption", extra: Partial<{ to: string[]; cc: string[]; subject: string; body: string; attachments: string[]; beatId: string; reflectionQuestions: string[] }>) {
    this.apply({
      type: "message_delivered",
      payload: {
        messageId: this.id("msg"), threadId, threadKey, beatId: extra.beatId ?? null, kind, from,
        to: extra.to ?? ["associate"], cc: extra.cc ?? [], subject: extra.subject ?? this.state.threads[threadId]?.subject ?? "Re:",
        body: extra.body ?? `[${kind} from ${from}]`, attachments: extra.attachments ?? [], reflectionQuestions: extra.reflectionQuestions ?? [], jobKey: job.key,
      },
    });
  }

  run(job: Job) {
    const p = job.payload;
    switch (p.kind) {
      case "beat": {
        const b = pkg.beats.find((x) => x.id === p.beatId)!;
        const threadId = this.state.threadIdByKey[b.thread_key] ?? this.id("thread");
        this.deliver(job, b.sender, threadId, b.thread_key, b.is_interruption ? "interruption" : "beat", { to: b.to, cc: b.cc, subject: b.subject ?? "Re:", body: b.body ?? `[generated: ${b.brief?.slice(0, 40)}]`, attachments: b.attachments, beatId: b.id });
        break;
      }
      case "classify_intent":
        this.apply({ type: "intent_classified", payload: { messageId: p.messageId, intent: "question" } });
        break;
      case "assess": {
        const a = idx.assignment(p.assignmentId);
        const issues: Record<string, "raised" | "partial" | "missed"> = {};
        for (const i of a.issues) issues[i.id] = this.raise.has(i.id) ? "raised" : "missed";
        const decisions: Record<string, string> = {};
        for (const d of a.decision_points) if (this.positions[d.id]) decisions[d.id] = this.positions[d.id]!;
        this.apply({ type: "assessment_recorded", payload: { messageId: p.messageId, assignmentId: p.assignmentId, issues, decisions } });
        break;
      }
      case "character_reply":
        this.deliver(job, p.characterId, p.threadId, this.state.threads[p.threadId]?.key ?? null, "reply", {});
        break;
      case "reflection":
        this.deliver(job, p.characterId, p.threadId, this.state.threads[p.threadId]?.key ?? null, "reflection", { reflectionQuestions: [`Q about ${p.assignmentId} #${this.n}`] });
        break;
      case "doctrine_answer":
        this.deliver(job, idx.doctrineAssistant.id, p.threadId, null, "doctrine", {});
        break;
      case "recap":
        this.deliver(job, "senior_associate", this.state.threadIdByKey["orientation"] ?? this.id("thread"), "recap", "recap", { subject: "Where things stand" });
        break;
      case "debrief":
        this.deliver(job, "partner", this.id("thread"), "debrief", "debrief", { subject: "Debrief" });
        break;
    }
  }

  send(threadKey: string | null, to: string[], body: string, extra: Partial<EngineEvent & { type: "email_sent" }>["payload"] = {}) {
    const threadId = (threadKey && this.state.threadIdByKey[threadKey]) || this.id("thread");
    const messageId = this.id("out");
    this.apply({ type: "email_sent", payload: { messageId, threadId, to, cc: [], body, attachments: [], ...extra } });
    return { threadId, messageId };
  }
}

function playToClosing(h: Harness) {
  h.apply({ type: "session_started", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: "0.1.0", associateFirstName: "Sam" } });
  h.drain();
  // M1: two replies on orientation.
  h.send("orientation", ["senior_associate"], "Ready.", { intent: "acknowledgment" });
  h.drain();
  h.send("orientation", ["senior_associate"], "My answers...", { intent: "question" });
  h.drain();
  // M2: deliverable to the client with a rationale.
  h.send("term-sheet", ["client_contact", "senior_associate"], "My comments on the term sheet.", { intent: "deliverable", rationale: "because", decisionPointId: "A2.D1" });
  h.drain();
  // M3: open the LSA (interruption), answer the board question, then deliver.
  h.apply({ type: "document_opened", payload: { documentId: "loan-and-security-agreement" } });
  h.drain();
  h.send("board-question", ["client_contact"], "No, Tranche 1 needs the Series C first.", { intent: "question" });
  h.drain();
  h.send("big-picture", ["senior_associate"], "Structure report.", { intent: "deliverable", rationale: "x", decisionPointId: "A3.D1" });
  h.drain();
  for (const [key, to] of [["comparison", ["senior_associate", "client_contact"]], ["verification", ["senior_associate"]], ["schedules", ["senior_associate", "client_contact"]], ["negotiation", ["lenders_counsel", "senior_associate"]], ["closing", ["lenders_counsel", "senior_associate"]]] as const) {
    h.send(key, [...to], `Deliverable on ${key}`, { intent: "deliverable", rationale: "r" });
    h.drain();
  }
}

describe("engine: full arc", () => {
  it("passes every milestone in order and completes with a debrief", () => {
    const h = new Harness();
    h.raise = new Set(["A2.I1", "A2.I2", "A2.I3", "A3.I1", "A3.I2"]);
    h.positions = { "A2.D1": "P2", "A3.D1": "P1" };
    playToClosing(h);
    const reached = h.effects.filter((e) => e.type === "milestone_reached").map((e) => (e as { milestoneId: string }).milestoneId);
    expect(reached).toEqual(["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"]);
    expect(h.state.status).toBe("completed");
    const debrief = Object.values(h.state.messages).find((m) => m.kind === "debrief");
    expect(debrief?.from).toBe("partner");
    // Positive chains seeded and fired.
    expect(h.state.consequences["C03"]).toBe("fired");
    expect(h.state.consequences["C05"]).toBe("fired");
    // Landlord chain seeded from A2.I4 missed, fired at M6, its beat delivered.
    expect(h.state.consequences["C01"]).toBe("fired");
    expect(h.state.beats["B-M6-landlord-surprise"]).toBe("delivered");
    // The signed-term-sheet chain did not seed because P2 was taken.
    expect(h.state.consequences["C04"]).toBeUndefined();
    expect(h.effects.filter((e) => e.type === "warning")).toEqual([]);
  });

  it("seeds the signed-term-sheet consequence from decision P1 and fires it at M7", () => {
    const h = new Harness();
    h.positions = { "A2.D1": "P1" };
    playToClosing(h);
    expect(h.state.consequences["C04"]).toBe("fired");
    expect(h.state.beats["B-M7-term-sheet-baseline"]).toBe("delivered");
    expect(h.state.decisions["A2.D1"]?.rationale).toBe("because");
  });

  it("every seeded consequence fires by its payoff milestone", () => {
    const h = new Harness();
    playToClosing(h);
    for (const [cid, st] of Object.entries(h.state.consequences)) {
      expect(st, cid).toBe("fired");
    }
  });
});

describe("engine: mechanics", () => {
  it("replaying the event log rebuilds identical state", () => {
    const h = new Harness();
    h.raise = new Set(["A2.I4"]);
    playToClosing(h);
    const rebuilt = replay(h.events, pkg, initialState(pkg), opts);
    expect(rebuilt).toEqual(h.state);
  });

  it("never enqueues the same job key twice", () => {
    const h = new Harness();
    playToClosing(h);
    const keys = h.effects.filter((e) => e.type === "enqueue_job").map((e) => (e as { job: Job }).job.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not react to a deliverable on a thread that scripted beats already answer, and skips replies to acknowledgments", () => {
    const h = new Harness();
    h.apply({ type: "session_started", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: "0.1.0", associateFirstName: "Sam" } });
    h.drain();
    const before = h.effects.length;
    h.send("orientation", ["senior_associate"], "thanks", { intent: "acknowledgment" });
    const jobs = h.effects.slice(before).filter((e) => e.type === "enqueue_job").map((e) => (e as { job: Job }).job.kind);
    expect(jobs).toEqual(["beat"]); // only the self-check beat, no generic reply
  });

  it("routes practice-support mail to the doctrine assistant only and hides the thread", () => {
    const h = new Harness();
    h.apply({ type: "session_started", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: "0.1.0", associateFirstName: "Sam" } });
    h.drain();
    const { threadId } = h.send(null, ["practice_support"], "What is a negative pledge?");
    const job = h.jobs.find((j) => j.kind === "doctrine_answer");
    expect(job).toBeDefined();
    expect(h.state.threads[threadId]?.hidden).toBe(true);
    expect(h.jobs.some((j) => j.kind === "classify_intent")).toBe(false);
  });

  it("classifies later when intent is not known at send", () => {
    const h = new Harness();
    h.apply({ type: "session_started", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: "0.1.0", associateFirstName: "Sam" } });
    h.drain();
    h.send("orientation", ["senior_associate"], "Ready.", { intent: "acknowledgment" });
    h.drain();
    h.send("orientation", ["senior_associate"], "Answers.", { intent: "acknowledgment" });
    h.drain();
    const { messageId } = h.send("term-sheet", ["client_contact"], "Here are my comments");
    expect(h.jobs.map((j) => j.kind)).toContain("classify_intent");
    h.jobs = [];
    h.apply({ type: "intent_classified", payload: { messageId, intent: "deliverable" } });
    expect(h.jobs.map((j) => j.kind)).toEqual(["assess"]);
  });

  it("recaps after a gap of three or more days, and not before", () => {
    const h = new Harness();
    h.apply({ type: "session_started", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: "0.1.0", associateFirstName: "Sam" } });
    h.drain();
    h.apply({ type: "session_resumed", payload: { gapDays: 1 } });
    expect(h.jobs.some((j) => j.kind === "recap")).toBe(false);
    h.apply({ type: "session_resumed", payload: { gapDays: 4 } });
    expect(h.jobs[0]?.kind).toBe("recap");
  });

  it("exposes open decision points for the at-send sheet", () => {
    const h = new Harness();
    h.apply({ type: "session_started", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: "0.1.0", associateFirstName: "Sam" } });
    h.drain();
    h.send("orientation", ["senior_associate"], "Ready.", { intent: "acknowledgment" });
    h.drain();
    h.send("orientation", ["senior_associate"], "Answers.", { intent: "acknowledgment" });
    h.drain();
    const tid = h.state.threadIdByKey["term-sheet"]!;
    expect(openDecisionPoints(h.state, pkg, tid).map((d) => d.id)).toEqual(["A2.D1"]);
    // A new thread to the client also surfaces it, by recipient.
    expect(openDecisionPoints(h.state, pkg, null, ["client_contact"]).map((d) => d.id)).toEqual(["A2.D1"]);
    expect(openDecisionPoints(h.state, pkg, null, ["lenders_counsel"])).toEqual([]);
  });

  it("uses deterministic, non-zero delays outside test mode", () => {
    let s = initialState(pkg);
    const r1 = step(s, { type: "session_started", at: "2026-10-01T09:00:00Z", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: "0.1.0", associateFirstName: "Sam" } }, pkg, {});
    const job = r1.effects.find((e) => e.type === "enqueue_job") as { job: Job };
    expect(job.job.delaySeconds).toBe(0); // welcome beat has delay_seconds: 0
    s = r1.state;
    const r2 = step(s, { type: "email_sent", at: "2026-10-01T09:05:00Z", payload: { messageId: "m1", threadId: "t1", to: ["senior_associate"], cc: [], body: "q", attachments: [], intent: "question" } }, pkg, {});
    const reply = r2.effects.find((e) => e.type === "enqueue_job") as { job: Job };
    expect(reply.job.delaySeconds).toBeGreaterThanOrEqual(30);
    expect(reply.job.delaySeconds).toBeLessThanOrEqual(120);
    const again = step(s, { type: "email_sent", at: "2026-10-01T09:05:00Z", payload: { messageId: "m1", threadId: "t1", to: ["senior_associate"], cc: [], body: "q", attachments: [], intent: "question" } }, pkg, {});
    expect(again.effects).toEqual(r2.effects);
  });
});
