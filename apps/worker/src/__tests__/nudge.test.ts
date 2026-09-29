import { describe, it, expect } from "vitest";
import type pg from "pg";
import { initialState, type Job, type SessionState } from "@aporia/engine";
import { loadScenario, scenarioDir, DEFAULT_SCENARIO_ID } from "@aporia/scenario";
import { handleJob } from "../jobs/handlers.js";
import { makeContext } from "../jobs/types.js";
import { MockProvider } from "../llm/mock.js";

const { pkg } = loadScenario(scenarioDir(DEFAULT_SCENARIO_ID));
const job: Job = { key: "nudge:A2:ack", kind: "nudge", delaySeconds: 1200, payload: { kind: "nudge", messageId: "ack", assignmentId: "A2" } };
const at = "2026-10-01T12:00:00.000Z";

/** A2 open on the term sheet thread; the associate's acknowledgment to Priya is the last thing that happened. */
function quietState(): SessionState {
  const s = initialState(pkg);
  s.status = "in_progress";
  s.currentMilestone = "M2";
  s.associateFirstName = "Austin";
  s.assignments.A2 = { status: "open", openedAt: at, completedAt: null, emailsSent: 1, deliverableMessageId: null };
  s.threads.t = { id: "t", key: "term-sheet", subject: "Halden Bank term sheet — thoughts?", participants: ["associate", "client_contact"], messageIds: ["ack"], assignmentIds: ["A2"], associateMessageCount: 1, lastIntent: "acknowledgment", lastMessageAt: at, hidden: false };
  s.threadIdByKey["term-sheet"] = "t";
  s.messages.ack = { id: "ack", threadId: "t", from: "associate", to: ["client_contact"], cc: [], subject: "Halden Bank term sheet — thoughts?", body: "Thanks, Priya! Will discuss internally and revert.", attachments: [], at, kind: "associate", intent: "acknowledgment", rationale: null, decisionPointId: null, beatId: null, assignmentId: null, reflectionQuestions: [], quotedRefs: [] };
  s.messageOrder = ["ack"];
  s.lastActivityAt = at;
  return s;
}

function run(state: SessionState) {
  const ctx = makeContext({ session: { id: "s", orgId: "o", testMode: false, assessorShadowMode: false }, job, state, pkg, documents: new Map(), provider: new MockProvider(), pool: undefined as unknown as pg.Pool, now: at, attempt: 1 });
  return handleJob(ctx);
}

describe("nudge job", () => {
  it("has the feedback character check in on the assignment thread", async () => {
    const out = await run(quietState());
    const delivered = out.events.map((e) => e.event).find((e) => e.type === "message_delivered");
    expect(delivered?.payload).toMatchObject({ kind: "nudge", from: "senior_associate", to: ["associate"], threadId: "t" });
    expect((delivered?.payload as { body: string }).body).toContain("term sheet comments");
  });

  it("does nothing once the associate has moved on", async () => {
    const opened = { ...quietState(), lastActivityAt: "2026-10-01T12:10:00.000Z" };
    const later = quietState();
    later.messageOrder.push("reply");
    const done = quietState();
    done.assignments.A2!.status = "complete";
    for (const s of [opened, later, done]) expect(await run(s)).toEqual({ events: [], generations: [] });
  });
});
