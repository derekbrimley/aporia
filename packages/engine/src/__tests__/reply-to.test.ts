import { describe, it, expect } from "vitest";
import { loadScenario, scenarioDir, DEFAULT_SCENARIO_ID } from "@rematter/scenario";
import { initialState, step, type EngineEvent, type SessionState } from "../index.js";

const { pkg } = loadScenario(scenarioDir(DEFAULT_SCENARIO_ID));

function run(events: Omit<EngineEvent, "at">[]): SessionState {
  let s = initialState(pkg);
  let t = Date.parse("2026-10-01T09:00:00Z");
  for (const e of events) s = step(s, { ...e, at: new Date((t += 60_000)).toISOString() } as EngineEvent, pkg, { zeroDelays: true }).state;
  return s;
}

const start = { type: "session_started", payload: { scenarioId: pkg.meta.id, scenarioVersion: pkg.meta.version, engineVersion: "0.1.0", associateFirstName: "Sam" } } as const;
const sent = (messageId: string, threadId: string, inReplyTo?: string) =>
  ({ type: "email_sent", payload: { messageId, threadId, to: ["senior_associate"], cc: [], body: messageId, attachments: [], intent: "question", inReplyTo } }) as const;
const delivered = (messageId: string, threadId: string, inReplyTo?: string) =>
  ({ type: "message_delivered", payload: { messageId, threadId, kind: "reply", from: "senior_associate", to: ["associate"], cc: [], subject: "Re: q", body: messageId, attachments: [], inReplyTo } }) as const;

describe("replies on a specific message", () => {
  it("records the message an associate email answers, and still appends it to the end of the thread", () => {
    const s = run([start, sent("a1", "t1"), delivered("r1", "t1", "a1"), sent("a2", "t1"), sent("a3", "t1", "r1")]);
    expect(s.messages.a3!.inReplyTo).toBe("r1");
    expect(s.messages.r1!.inReplyTo).toBe("a1");
    expect(s.messages.a2!.inReplyTo).toBeNull();
    expect(s.threads.t1!.messageIds).toEqual(["a1", "r1", "a2", "a3"]);
  });

  it("drops a reply target that is unknown or on another thread", () => {
    const s = run([start, sent("a1", "t1"), sent("b1", "t2"), sent("a2", "t1", "b1"), sent("a3", "t1", "nope"), delivered("r1", "t2", "a1")]);
    expect(s.messages.a2!.inReplyTo).toBeNull();
    expect(s.messages.a3!.inReplyTo).toBeNull();
    expect(s.messages.r1!.inReplyTo).toBeNull();
  });
});
