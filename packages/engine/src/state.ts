import type { ScenarioPackage } from "@aporia/scenario";
import { ENGINE_VERSION, type SessionState } from "./types.js";

export function initialState(pkg: ScenarioPackage): SessionState {
  const milestones: SessionState["milestones"] = {};
  for (const m of pkg.milestones) milestones[m.id] = { enteredAt: null, completedAt: null };
  const assignments: SessionState["assignments"] = {};
  for (const a of pkg.assignments) assignments[a.id] = { status: "pending", openedAt: null, completedAt: null, emailsSent: 0, deliverableMessageId: null };
  return {
    scenarioId: pkg.meta.id,
    scenarioVersion: pkg.meta.version,
    engineVersion: ENGINE_VERSION,
    associateFirstName: "",
    status: "not_started",
    startedAt: null,
    lastActivityAt: null,
    completedAt: null,
    currentMilestone: null,
    milestones,
    assignments,
    issues: {},
    decisions: {},
    consequences: {},
    beats: {},
    jobs: {},
    threads: {},
    threadIdByKey: {},
    messages: {},
    messageOrder: [],
    reflectionQuestionsAsked: [],
    documentsOpened: [],
    documentsReleased: [],
    eventCount: 0,
    lastRecapAt: null,
  };
}

/** Structured clone that works for plain JSON state. */
export function cloneState(s: SessionState): SessionState {
  return structuredClone(s);
}
