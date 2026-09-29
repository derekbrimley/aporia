import { describe, it, expect } from "vitest";
import { loadScenario, scenarioDir, DEFAULT_SCENARIO_ID, ScenarioIndex } from "@aporia/scenario";
import { initialState, replay, step, likelyDeliverable, type EngineEvent, type Effect, type Job, type SessionState } from "../index.js";

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

  private deliver(job: Job, from: string, threadId: string, threadKey: string | null, kind: "beat" | "reply" | "reflection" | "recap" | "debrief" | "doctrine" | "interruption", extra: Partial<{ to: string[]; cc: string[]; subject: string; body: string; attachments: string[]; beatId: string; reflectionQuestions: string[]; assignmentId: string }>) {
    this.apply({
      type: "message_delivered",
      payload: {
        messageId: this.id("msg"), threadId, threadKey, beatId: extra.beatId ?? null, kind, from,
        to: extra.to ?? ["associate"], cc: extra.cc ?? [], subject: extra.subject ?? this.state.threads[threadId]?.subject ?? "Re:",
        body: extra.body ?? `[${kind} from ${from}]`, attachments: extra.attachments ?? [], reflectionQuestions: extra.reflectionQuestions ?? [], jobKey: job.key, assignmentId: extra.assignmentId ?? null,
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
        this.apply({ type: "assessment_recorded", payload: { messageId: p.messageId, assignmentId: p.assignmentId, issues, decisions, probe: p.probe } });
        break;
      }
      case "character_reply":
        this.deliver(job, p.characterId, p.threadId, this.state.threads[p.threadId]?.key ?? null, "reply", {});
        break;
      case "reflection": {
        const side = p.sideThreadKey ?? null;
        const threadId = side ? this.state.threadIdByKey[side] ?? this.id("thread") : p.threadId;
        this.deliver(job, p.characterId, threadId, side ?? this.state.threads[p.threadId]?.key ?? null, "reflection", { reflectionQuestions: [`Q about ${p.assignmentId} #${this.n}`], assignmentId: p.assignmentId, subject: side ? "Internal" : undefined });
        break;
      }
      case "doctrine_answer":
        this.deliver(job, idx.doctrineAssistant.id, p.threadId, null, "doctrine", {});
        break;
      case "recap":
        this.deliver(job, "senior_associate", this.state.threadIdByKey["orientation"] ?? this.id("thread"), "recap", "recap", { subject: "Where things stand" });
        break;
      case "debrief":
        this.deliver(job, "partner", this.id("thread"), "debrief", "debrief", { subject: "Debrief" });
        break;
      case "nudge":
        this.deliver(job, "senior_associate", this.state.threadIdByKey[idx.assignment(p.assignmentId).thread_key] ?? this.id("thread"), null, "reply", {});
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
  // M2: deliverable to the client; Marcus asks about it on a side thread and the associate answers.
  const ts = h.send("term-sheet", ["client_contact", "senior_associate"], "My comments on the term sheet.", { intent: "deliverable" });
  h.drain();
  h.send(`reflection:${ts.messageId}`, ["senior_associate"], "because", { intent: "question" });
  h.drain();
  // M3: open the LSA (interruption), answer the board question, then deliver.
  h.apply({ type: "document_opened", payload: { documentId: "loan-and-security-agreement" } });
  h.drain();
  h.send("board-question", ["client_contact"], "No, Tranche 1 needs the Series C first.", { intent: "question" });
  h.drain();
  h.send("big-picture", ["senior_associate"], "Structure report.", { intent: "deliverable" });
  h.drain();
  for (const [key, to] of [["comparison", ["senior_associate", "client_contact"]], ["verification", ["senior_associate"]], ["schedules", ["senior_associate", "client_contact"]], ["negotiation", ["lenders_counsel", "senior_associate"]], ["closing", ["lenders_counsel", "senior_associate"]]] as const) {
    h.send(key, [...to], `Deliverable on ${key}`, { intent: "deliverable" });
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

  it("picks out a long question-shaped email as a possible deliverable", () => {
    const h = toTermSheet();
    const tid = h.state.threadIdByKey["term-sheet"]!;
    const long = "Tranche 1 is only available for 30 days. Does that work for the business? ".repeat(6);
    expect(likelyDeliverable(h.state, pkg, tid, ["client_contact"], long, "question")?.id).toBe("A2");
    expect(likelyDeliverable(h.state, pkg, null, ["client_contact"], long, "logistics")?.id).toBe("A2");
    expect(likelyDeliverable(h.state, pkg, tid, ["client_contact"], "Does the 30-day window work for you?", "question")).toBeUndefined();
    expect(likelyDeliverable(h.state, pkg, tid, ["client_contact"], long, "deliverable")).toBeUndefined();
    expect(likelyDeliverable(h.state, pkg, tid, ["client_contact"], long, "acknowledgment")).toBeUndefined();
    expect(likelyDeliverable(h.state, pkg, null, ["lenders_counsel"], long, "question")).toBeUndefined();
  });

  it("nudges when an acknowledgment leaves an open deliverable with nothing pending, at most twice", () => {
    const h = toTermSheet();
    const tid = h.state.threadIdByKey["term-sheet"]!;
    const ack = (n: number, at: string) => step(h.state, { type: "email_sent", at, payload: { messageId: `ack-${n}`, threadId: tid, to: ["client_contact"], cc: [], body: "Thanks, will revert.", attachments: [], intent: "acknowledgment" } }, pkg, {});
    const r1 = ack(1, "2026-10-01T12:00:00Z");
    const jobs1 = r1.effects.flatMap((e) => (e.type === "enqueue_job" ? [e.job] : []));
    expect(jobs1).toEqual([{ key: "nudge:A2:ack-1", kind: "nudge", delaySeconds: 1200, payload: { kind: "nudge", messageId: "ack-1", assignmentId: "A2" } }]);
    // An earlier nudge still waiting does not stop the next one; the cap does.
    h.state = r1.state;
    h.state = ack(2, "2026-10-01T12:30:00Z").state;
    expect(h.state.jobs["nudge:A2:ack-2"]).toBe("enqueued");
    expect(ack(3, "2026-10-01T13:00:00Z").effects.some((e) => e.type === "enqueue_job")).toBe(false);
  });

  it("does not nudge in test mode, when someone will reply, or when a job is pending", () => {
    const h = toTermSheet();
    const tid = h.state.threadIdByKey["term-sheet"]!;
    const send = (state: SessionState, intent: "acknowledgment" | "question", o = {}) =>
      step(state, { type: "email_sent", at: "2026-10-01T12:00:00Z", payload: { messageId: "m", threadId: tid, to: ["client_contact"], cc: [], body: "Thanks.", attachments: [], intent } }, pkg, o).effects.flatMap((e) => (e.type === "enqueue_job" ? [e.job.kind] : []));
    expect(send(h.state, "acknowledgment", { zeroDelays: true })).toEqual([]);
    expect(send(h.state, "question")).toEqual(["character_reply"]);
    const busy = { ...h.state, jobs: { ...h.state.jobs, "reply:x:client_contact": "enqueued" as const } };
    expect(send(busy, "acknowledgment")).toEqual([]);
  });
});

describe("engine: reflections and reasoning", () => {
  it("asks about client-facing work on a private side thread, and internal work on its own thread", () => {
    const h = toTermSheet();
    h.positions = { "A2.D1": "P2", "A3.D1": "P1" };
    const ts = h.send("term-sheet", ["client_contact", "senior_associate"], "My comments.", { intent: "deliverable" });
    h.drain();
    const side = h.state.threadIdByKey[`reflection:${ts.messageId}`]!;
    const reflection = h.state.threads[side]!.messageIds.map((id) => h.state.messages[id]!).find((m) => m.kind === "reflection");
    expect(side).not.toBe(ts.threadId);
    expect(reflection).toMatchObject({ from: "senior_associate", to: ["associate"], cc: [], assignmentId: "A2" });
    expect(h.state.threads[ts.threadId]!.messageIds.some((id) => h.state.messages[id]!.kind === "reflection")).toBe(false);

    // Through the board question to A3, whose report goes to Marcus alone.
    h.apply({ type: "document_opened", payload: { documentId: "loan-and-security-agreement" } });
    h.drain();
    h.send("board-question", ["client_contact"], "No.", { intent: "question" });
    h.drain();
    const bp = h.send("big-picture", ["senior_associate"], "Structure report.", { intent: "deliverable" });
    h.drain();
    expect(h.state.threadIdByKey[`reflection:${bp.messageId}`]).toBeUndefined();
    expect(h.state.threads[bp.threadId]!.messageIds.some((id) => h.state.messages[id]!.kind === "reflection")).toBe(true);
  });

  it("records the first answer to a reflection as the reasoning, and never assesses it", () => {
    const h = toTermSheet();
    h.positions = { "A2.D1": "P2" };
    const ts = h.send("term-sheet", ["client_contact", "senior_associate"], "My comments.", { intent: "deliverable" });
    h.drain();
    expect(h.state.decisions["A2.D1"]).toMatchObject({ position: "P2", rationale: null });
    const key = `reflection:${ts.messageId}`;
    const long = "The revenue definition drives Tranche 2, so I wanted it fixed before anyone signs. ".repeat(6);
    const r = h.send(key, ["senior_associate"], long, { intent: "deliverable" });
    const jobs = h.jobs.map((j) => j.kind);
    expect(jobs).not.toContain("assess");
    expect(jobs).toContain("character_reply");
    expect(h.state.assignments.A2?.reasoning).toBe(long);
    expect(h.state.decisions["A2.D1"]?.rationale).toBe(long);
    h.drain();
    // Replying again after Marcus answers does not overwrite it.
    h.send(key, ["senior_associate"], "One more thought.", { intent: "question" });
    expect(h.state.assignments.A2?.reasoning).toBe(long);
    expect(r.threadId).toBe(h.state.threadIdByKey[key]);
  });

  it("promotes a question-shaped email to the deliverable when the probe finds work product", () => {
    const h = toTermSheet();
    const a2 = idx.assignment("A2");
    h.raise = new Set(a2.issues.slice(0, Math.ceil(a2.issues.length / 2)).map((i) => i.id));
    const tid = h.state.threadIdByKey["term-sheet"]!;
    const long = "How is revenue defined for Tranche 2? Does the IP exclusion cover proceeds? ".repeat(6);
    const { messageId } = h.send("term-sheet", ["client_contact"], long, { intent: "question" });
    expect(h.jobs).toEqual([{ key: `assess:${messageId}`, kind: "assess", delaySeconds: 0, payload: { kind: "assess", messageId, assignmentId: "A2", probe: true } }]);
    h.drain();
    expect(h.state.messages[messageId]).toMatchObject({ intent: "deliverable", assignmentId: "A2" });
    expect(h.state.assignments.A2).toMatchObject({ status: "complete", deliverableMessageId: messageId });
    expect(Object.values(h.state.messages).some((m) => m.kind === "reflection" && m.assignmentId === "A2")).toBe(true);
    expect(h.state.threads[tid]!.messageIds.some((id) => h.state.messages[id]!.kind === "reply")).toBe(false);
  });

  it("answers a question-shaped email as a question when the probe finds little", () => {
    const h = toTermSheet();
    h.raise = new Set(["A2.I1"]);
    const long = "Before I draft comments, can you tell me which points matter most to the company? ".repeat(6);
    const { messageId, threadId } = h.send("term-sheet", ["client_contact"], long, { intent: "question" });
    h.drain();
    expect(h.state.messages[messageId]).toMatchObject({ intent: "question", assignmentId: null });
    expect(h.state.assignments.A2?.status).toBe("open");
    expect(h.state.issues).toEqual({});
    const reply = h.state.threads[threadId]!.messageIds.map((id) => h.state.messages[id]!).at(-1);
    expect(reply).toMatchObject({ kind: "reply", from: "client_contact" });
  });
});

/** Plays through orientation so the term sheet (A2) is open and nothing is pending. */
function toTermSheet(): Harness {
  const h = new Harness();
  h.apply({ type: "session_started", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: "0.1.0", associateFirstName: "Sam" } });
  h.drain();
  h.send("orientation", ["senior_associate"], "Ready.", { intent: "acknowledgment" });
  h.drain();
  h.send("orientation", ["senior_associate"], "Answers.", { intent: "acknowledgment" });
  h.drain();
  expect(h.state.assignments.A2?.status).toBe("open");
  return h;
}
