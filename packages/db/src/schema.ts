import { pgTable, uuid, text, integer, bigint, boolean, timestamp, jsonb, primaryKey, uniqueIndex, index, date } from "drizzle-orm/pg-core";

/**
 * Data model. `events` is the source of truth; every table under `sessions`
 * that describes a session is a projection rebuilt by replay. Every table
 * below `organizations` carries org_id and every query filters on it.
 */

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  dataRetentionDays: integer("data_retention_days").notNull().default(365),
  /** "anthropic" or "bedrock"; lets a firm require its data to stay in AWS. */
  llmProvider: text("llm_provider").notNull().default("anthropic"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    firstName: text("first_name").notNull(),
    role: text("role", { enum: ["associate", "pd_admin", "internal_admin", "internal_rater"] }).notNull(),
    /** External auth subject (WorkOS user id) once linked. */
    authSubject: text("auth_subject"),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_org_email_idx").on(t.orgId, t.email)],
);

export const cohorts = pgTable("cohorts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scenarioId: text("scenario_id").notNull(),
  scenarioVersion: text("scenario_version").notNull(),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  /** Pilot flag: shows the tester-flag control on every email and document. */
  testerFlagsEnabled: boolean("tester_flags_enabled").notNull().default(true),
  /** Assessor shadow mode: consequences wait for human confirmation. */
  assessorShadowMode: boolean("assessor_shadow_mode").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cohortMembers = pgTable(
  "cohort_members",
  {
    cohortId: uuid("cohort_id").notNull().references(() => cohorts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.cohortId, t.userId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id").notNull().references(() => cohorts.id, { onDelete: "cascade" }),
    scenarioId: text("scenario_id").notNull(),
    scenarioVersion: text("scenario_version").notNull(),
    engineVersion: text("engine_version").notNull(),
    status: text("status", { enum: ["not_started", "in_progress", "completed"] }).notNull().default("not_started"),
    currentMilestone: text("current_milestone"),
    /** Test mode zeroes delivery delays. Set for bot playthroughs and local dev. */
    testMode: boolean("test_mode").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Seconds of activity, accumulated from activity events (gaps over 15 minutes are not counted). */
    activeSeconds: integer("active_seconds").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_user_cohort_idx").on(t.userId, t.cohortId)],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    actor: text("actor").notNull(), // associate | worker | api | admin:<user id> | system
    idempotencyKey: text("idempotency_key"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("events_session_seq_idx").on(t.sessionId, t.seq),
    uniqueIndex("events_idempotency_idx").on(t.idempotencyKey),
    index("events_session_type_idx").on(t.sessionId, t.type),
  ],
);

/** Latest engine state per session, cached so the API does not replay on every request. Rebuilt on demand. */
export const sessionSnapshots = pgTable("session_snapshots", {
  sessionId: uuid("session_id").primaryKey().references(() => sessions.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  eventSeq: integer("event_seq").notNull(),
  engineVersion: text("engine_version").notNull(),
  state: jsonb("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- projections for the inbox
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    threadKey: text("thread_key"),
    subject: text("subject").notNull(),
    participants: jsonb("participants").$type<string[]>().notNull(),
    hidden: boolean("hidden").notNull().default(false),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    messageCount: integer("message_count").notNull().default(0),
  },
  (t) => [index("threads_session_idx").on(t.sessionId, t.lastMessageAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    fromParticipant: text("from_participant").notNull(), // "associate" or character id
    toParticipants: jsonb("to_participants").$type<string[]>().notNull(),
    ccParticipants: jsonb("cc_participants").$type<string[]>().notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    attachments: jsonb("attachments").$type<string[]>().notNull(),
    kind: text("kind").notNull(),
    intent: text("intent"),
    beatId: text("beat_id"),
    assignmentId: text("assignment_id"),
    generationId: uuid("generation_id"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("messages_session_idx").on(t.sessionId, t.deliveredAt), index("messages_thread_idx").on(t.threadId, t.seq)],
);

export const decisions = pgTable(
  "decisions",
  {
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    decisionPointId: text("decision_point_id").notNull(),
    position: text("position").notNull(),
    rationale: text("rationale"),
    messageId: uuid("message_id"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.decisionPointId] })],
);

export const issueStatus = pgTable(
  "issue_status",
  {
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    issueId: text("issue_id").notNull(),
    status: text("status", { enum: ["raised", "partial", "missed"] }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.issueId] })],
);

export const consequences = pgTable(
  "consequences",
  {
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    consequenceId: text("consequence_id").notNull(),
    state: text("state", { enum: ["seeded", "fired", "resolved"] }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.consequenceId] })],
);

// ---------------------------------------------------------------- AI layer records
export const generations = pgTable(
  "generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    jobKey: text("job_key"),
    role: text("role").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    promptVersion: text("prompt_version").notNull(),
    /** References to the inputs (message ids, beat id, fact keys) rather than copies of PII. */
    inputRefs: jsonb("input_refs").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    userPrompt: text("user_prompt").notNull(),
    output: text("output").notNull(),
    parsedOutput: jsonb("parsed_output"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    attempt: integer("attempt").notNull().default(1),
    checkerResult: jsonb("checker_result"),
    traceId: text("trace_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("generations_session_idx").on(t.sessionId, t.createdAt)],
);

/** Emails the fact checker could not pass after regeneration, awaiting human release. */
export const heldEmails = pgTable("held_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  jobKey: text("job_key").notNull().unique(),
  jobPayload: jsonb("job_payload").notNull(),
  /** The delivery payload as it would have been appended; an admin can edit body before release. */
  proposedDelivery: jsonb("proposed_delivery").notNull(),
  violations: jsonb("violations").notNull(),
  status: text("status", { enum: ["held", "released", "discarded"] }).notNull().default("held"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const flags = pgTable("flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetType: text("target_type", { enum: ["message", "document"] }).notNull(),
  targetId: text("target_id").notNull(),
  note: text("note").notNull(),
  status: text("status", { enum: ["open", "triaged", "dismissed"] }).notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Attorney / judge ratings of sampled outputs (evals). */
export const ratings = pgTable("ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull(),
  raterType: text("rater_type", { enum: ["human", "judge"] }).notNull(),
  raterId: text("rater_id").notNull(),
  realism: integer("realism").notNull(),
  legalAccuracy: integer("legal_accuracy").notNull(),
  socraticQuality: integer("socratic_quality").notNull(),
  voiceConsistency: integer("voice_consistency").notNull(),
  acceptable: boolean("acceptable").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id"),
    to: jsonb("to").$type<string[]>().notNull(),
    cc: jsonb("cc").$type<string[]>().notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    attachments: jsonb("attachments").$type<string[]>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("drafts_session_idx").on(t.sessionId)],
);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id"),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const magicLinks = pgTable("magic_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
