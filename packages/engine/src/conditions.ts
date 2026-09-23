import type { Condition } from "@aporia/scenario";
import type { SessionState } from "./types.js";

/** Evaluates a scenario condition against session state. Pure. */
export function evaluate(c: Condition, s: SessionState): boolean {
  if ("all" in c) return c.all.every((x) => evaluate(x, s));
  if ("any" in c) return c.any.some((x) => evaluate(x, s));
  if ("not" in c) return !evaluate(c.not, s);
  if ("session_started" in c) return s.status !== "not_started";
  if ("milestone_complete" in c) return s.milestones[c.milestone_complete]?.completedAt != null;
  if ("milestone_entered" in c) return s.milestones[c.milestone_entered]?.enteredAt != null;
  if ("assignment_complete" in c) return s.assignments[c.assignment_complete]?.status === "complete";
  if ("assignment_open" in c) return s.assignments[c.assignment_open]?.status === "open";
  if ("beat_delivered" in c) return s.beats[c.beat_delivered] === "delivered";
  if ("consequence_active" in c) {
    const st = s.consequences[c.consequence_active];
    return st === "seeded" || st === "fired";
  }
  if ("consequence_fired" in c) return s.consequences[c.consequence_fired] === "fired";
  if ("issue_status" in c) return s.issues[c.issue_status.issue] === c.issue_status.status;
  if ("decision_taken" in c) {
    const d = s.decisions[c.decision_taken.decision_point];
    if (!d) return false;
    return c.decision_taken.position ? d.position === c.decision_taken.position : true;
  }
  if ("replies_on_thread" in c) {
    const tid = s.threadIdByKey[c.replies_on_thread.thread_key];
    const t = tid ? s.threads[tid] : undefined;
    return (t?.associateMessageCount ?? 0) >= c.replies_on_thread.count;
  }
  if ("emails_sent_in_assignment" in c) {
    return (s.assignments[c.emails_sent_in_assignment.assignment]?.emailsSent ?? 0) >= c.emails_sent_in_assignment.count;
  }
  if ("intent_on_thread" in c) {
    const tid = s.threadIdByKey[c.intent_on_thread.thread_key];
    const t = tid ? s.threads[tid] : undefined;
    return t?.lastIntent === c.intent_on_thread.intent;
  }
  if ("document_opened" in c) return s.documentsOpened.includes(c.document_opened);
  return false;
}
