/**
 * Engine types. The engine is a pure function:
 *   step(state, event, scenario, options) -> { state, effects }
 * Session state is a projection of the append-only event log and can be
 * rebuilt at any time by replaying the events.
 */

export const ENGINE_VERSION = "0.1.0";

export type Intent = "deliverable" | "question" | "logistics" | "acknowledgment";
export type IssueStatus = "raised" | "partial" | "missed";
export type ConsequenceState = "seeded" | "fired" | "resolved";
export type Participant = "associate" | string; // character id

export type MessageKind =
  | "associate"
  | "beat"
  | "reply"
  | "reflection"
  | "interruption"
  | "recap"
  | "debrief"
  | "doctrine";

// ---------------------------------------------------------------- events
interface Base<T extends string, P> {
  type: T;
  /** ISO timestamp the event occurred. The engine's only clock. */
  at: string;
  payload: P;
}

export type SessionStartedEvent = Base<"session_started", {
  scenarioId: string;
  scenarioVersion: string;
  engineVersion: string;
  associateFirstName: string;
}>;
export type SessionResumedEvent = Base<"session_resumed", { gapDays: number }>;
export type EmailSentEvent = Base<"email_sent", {
  messageId: string;
  threadId: string;
  /** Present when replying on a thread the engine already knows; ignored otherwise. */
  subject?: string | null;
  to: Participant[];
  cc: Participant[];
  body: string;
  attachments: string[];
  /** Section references quoted via "quote in reply". */
  quotedRefs?: { documentId: string; ref: string; text: string }[];
  /** Private rationale captured on the at-send sheet. Never part of the email. */
  rationale?: string | null;
  /** Decision point the at-send sheet was shown for, if any. */
  decisionPointId?: string | null;
  /** Intent when classified before send; otherwise a classify job is enqueued. */
  intent?: Intent | null;
  /** The associate chose "not my answer yet": the email is treated as a question. */
  notMyAnswerYet?: boolean;
}>;
export type IntentClassifiedEvent = Base<"intent_classified", { messageId: string; intent: Intent; confidence?: number }>;
export type AssessmentRecordedEvent = Base<"assessment_recorded", {
  messageId: string;
  assignmentId: string;
  issues: Record<string, IssueStatus>;
  decisions: Record<string, string>;
  summary?: string;
  /** Shadow mode: the assessment is logged but does not drive consequences. */
  shadow?: boolean;
}>;
export type MessageDeliveredEvent = Base<"message_delivered", {
  messageId: string;
  threadId: string;
  threadKey?: string | null;
  beatId?: string | null;
  kind: Exclude<MessageKind, "associate">;
  from: string; // character id
  to: Participant[];
  cc: Participant[];
  subject: string;
  body: string;
  attachments: string[];
  inReplyTo?: string | null;
  generationId?: string | null;
  reflectionQuestions?: string[];
  jobKey?: string | null;
}>;
export type MessageHeldEvent = Base<"message_held", { jobKey: string; reason: string; kind: MessageKind }>;
export type MessageReleasedEvent = Base<"message_released", { jobKey: string }>;
export type DocumentOpenedEvent = Base<"document_opened", { documentId: string }>;
export type DocumentsComparedEvent = Base<"documents_compared", { documentIds: [string, string] }>;
export type JobCompletedEvent = Base<"job_completed", { jobKey: string; kind: JobKind }>;
export type JobFailedEvent = Base<"job_failed", { jobKey: string; kind: JobKind; error: string; attempts: number }>;
export type FlagRaisedEvent = Base<"flag_raised", { targetType: "message" | "document"; targetId: string; note: string }>;

export type EngineEvent =
  | SessionStartedEvent
  | SessionResumedEvent
  | EmailSentEvent
  | IntentClassifiedEvent
  | AssessmentRecordedEvent
  | MessageDeliveredEvent
  | MessageHeldEvent
  | MessageReleasedEvent
  | DocumentOpenedEvent
  | DocumentsComparedEvent
  | JobCompletedEvent
  | JobFailedEvent
  | FlagRaisedEvent;

export type EventType = EngineEvent["type"];

// ---------------------------------------------------------------- jobs (planned by the engine, run by the worker)
export type JobKind =
  | "classify_intent"
  | "assess"
  | "character_reply"
  | "reflection"
  | "beat"
  | "doctrine_answer"
  | "recap"
  | "debrief";

export type JobPayload =
  | { kind: "classify_intent"; messageId: string }
  | { kind: "assess"; messageId: string; assignmentId: string }
  | { kind: "character_reply"; messageId: string; characterId: string; threadId: string }
  | { kind: "reflection"; messageId: string; assignmentId: string; characterId: string; threadId: string }
  | { kind: "beat"; beatId: string }
  | { kind: "doctrine_answer"; messageId: string; threadId: string }
  | { kind: "recap"; resumedAt: string; gapDays: number }
  | { kind: "debrief" };

export interface Job {
  /** Idempotency key derived from the triggering event. Retries never duplicate. */
  key: string;
  kind: JobKind;
  delaySeconds: number;
  payload: JobPayload;
}

// ---------------------------------------------------------------- effects
export type Effect =
  | { type: "milestone_entered"; milestoneId: string }
  | { type: "milestone_reached"; milestoneId: string }
  | { type: "assignment_opened"; assignmentId: string }
  | { type: "assignment_completed"; assignmentId: string }
  | { type: "consequence_seeded"; consequenceId: string }
  | { type: "consequence_fired"; consequenceId: string }
  | { type: "session_completed" }
  | { type: "enqueue_job"; job: Job }
  | { type: "warning"; message: string };

// ---------------------------------------------------------------- state
export interface ThreadState {
  id: string;
  key: string | null;
  subject: string;
  participants: Participant[];
  messageIds: string[];
  assignmentIds: string[];
  associateMessageCount: number;
  lastIntent: Intent | null;
  lastMessageAt: string;
  /** Doctrine threads are invisible to every other character. */
  hidden: boolean;
}

export interface MessageState {
  id: string;
  threadId: string;
  from: Participant;
  to: Participant[];
  cc: Participant[];
  subject: string;
  body: string;
  attachments: string[];
  at: string;
  kind: MessageKind;
  intent: Intent | null;
  rationale: string | null;
  decisionPointId: string | null;
  beatId: string | null;
  assignmentId: string | null;
  reflectionQuestions: string[];
  quotedRefs: { documentId: string; ref: string; text: string }[];
}

export interface AssignmentState {
  status: "pending" | "open" | "complete";
  openedAt: string | null;
  completedAt: string | null;
  emailsSent: number;
  deliverableMessageId: string | null;
}

export interface SessionState {
  scenarioId: string;
  scenarioVersion: string;
  engineVersion: string;
  associateFirstName: string;
  status: "not_started" | "in_progress" | "completed";
  startedAt: string | null;
  lastActivityAt: string | null;
  completedAt: string | null;
  currentMilestone: string | null;
  milestones: Record<string, { enteredAt: string | null; completedAt: string | null }>;
  assignments: Record<string, AssignmentState>;
  issues: Record<string, IssueStatus>;
  decisions: Record<string, { position: string; rationale: string | null; messageId: string }>;
  consequences: Record<string, ConsequenceState>;
  beats: Record<string, "enqueued" | "delivered">;
  jobs: Record<string, "enqueued" | "completed" | "failed" | "held">;
  threads: Record<string, ThreadState>;
  threadIdByKey: Record<string, string>;
  messages: Record<string, MessageState>;
  messageOrder: string[];
  reflectionQuestionsAsked: string[];
  documentsOpened: string[];
  documentsReleased: string[];
  eventCount: number;
  lastRecapAt: string | null;
}

export interface StepOptions {
  /** Zero all delivery delays (test mode and bot playthroughs). */
  zeroDelays?: boolean;
  /** Shadow mode: assessments are recorded but do not seed consequences or complete assignments. */
  assessorShadowMode?: boolean;
}

export interface StepResult {
  state: SessionState;
  effects: Effect[];
}
