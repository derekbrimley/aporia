import { z } from "zod";

/**
 * Scenario package schema. Everything the engine, worker, assessor and UI read
 * about a deal is validated against these schemas at build time. Nothing here
 * changes at runtime; every session is pinned to one scenario version.
 */

export const COMPETENCIES = [
  "ucc_article_9",
  "loan_structure_payments",
  "conditions_precedent_closing",
  "reps_warranties",
  "covenants",
  "events_of_default_remedies",
  "venture_lending_concepts",
  "regulatory_compliance",
] as const;
export const CompetencySchema = z.enum(COMPETENCIES);
export type Competency = z.infer<typeof CompetencySchema>;

export const COMPETENCY_LABELS: Record<Competency, string> = {
  ucc_article_9: "UCC Article 9 and security interests",
  loan_structure_payments: "Loan structure and payment mechanics",
  conditions_precedent_closing: "Conditions precedent and closing mechanics",
  reps_warranties: "Reps and warranties",
  covenants: "Affirmative and negative covenants",
  events_of_default_remedies: "Events of default and remedies",
  venture_lending_concepts: "Venture lending and growth-stage borrower concepts",
  regulatory_compliance: "Regulatory and compliance",
};

const idPattern = (re: RegExp, what: string) =>
  z.string().regex(re, { message: `${what} id does not match the required pattern ${re}` });

export const MilestoneIdSchema = idPattern(/^M[1-8]$/, "Milestone");
export const AssignmentIdSchema = idPattern(/^A\d{1,2}$/, "Assignment");
export const IssueIdSchema = idPattern(/^A\d{1,2}\.I\d{1,2}$/, "Issue");
export const DecisionPointIdSchema = idPattern(/^A\d{1,2}\.D\d{1,2}$/, "Decision point");
export const PositionIdSchema = idPattern(/^P\d{1,2}$/, "Position");
export const ConsequenceIdSchema = idPattern(/^C\d{2}$/, "Consequence");
export const DeltaIdSchema = idPattern(/^D\d{2}$/, "Delta");
export const BeatIdSchema = idPattern(/^B-[A-Za-z0-9-]+$/, "Beat");
export const CharacterIdSchema = idPattern(/^[a-z][a-z0-9_]*$/, "Character");
export const DocumentIdSchema = idPattern(/^[a-z][a-z0-9-]*$/, "Document");
export const FactKeySchema = idPattern(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, "Fact key");

// ---------------------------------------------------------------- scenario.yaml
export const ScenarioMetaSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string().min(1),
  practice_area: z.string().default("lending"),
  side: z.enum(["borrower", "lender"]).default("borrower"),
  /** Content status. Nothing marked `draft` should be shown to a paying cohort. */
  status: z.enum(["draft", "attorney_reviewed", "signed_off"]).default("draft"),
  attorney_signoff_date: z.string().date().nullable().default(null),
  /** Associate's own address inside the fiction. */
  associate: z.object({
    email_domain: z.string().min(1),
    role_label: z.string().default("Associate"),
    firm: z.string().min(1),
  }),
  /** Address of the doctrine assistant. Mail to it never reaches other characters. */
  notes: z.string().optional(),
});
export type ScenarioMeta = z.infer<typeof ScenarioMetaSchema>;

// ---------------------------------------------------------------- facts.yaml
export const FactValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("money"), value: z.number(), currency: z.string().default("USD"), display: z.string().optional(), note: z.string().optional() }),
  z.object({ type: z.literal("percent"), value: z.number(), display: z.string().optional(), note: z.string().optional() }),
  z.object({ type: z.literal("number"), value: z.number(), unit: z.string().optional(), display: z.string().optional(), note: z.string().optional() }),
  z.object({ type: z.literal("date"), value: z.string().date(), display: z.string().optional(), note: z.string().optional() }),
  z.object({ type: z.literal("text"), value: z.string(), note: z.string().optional() }),
  z.object({ type: z.literal("party"), value: z.string(), aliases: z.array(z.string()).default([]), note: z.string().optional() }),
  z.object({ type: z.literal("defined_term"), value: z.string(), definition: z.string(), note: z.string().optional() }),
  z.object({ type: z.literal("placeholder"), value: z.string(), note: z.string().optional() }),
]);
export type FactValue = z.infer<typeof FactValueSchema>;
export const FactsSchema = z.record(FactKeySchema, FactValueSchema);
export type Facts = z.infer<typeof FactsSchema>;

// ---------------------------------------------------------------- characters/*.yaml
export const CharacterSchema = z.object({
  id: CharacterIdSchema,
  name: z.string().min(1),
  first_name: z.string().min(1),
  role_label: z.string().min(1),
  title: z.string().min(1),
  organization: z.string().min(1),
  email: z.string().email(),
  /** Which side of the table this character sits on; drives cc etiquette. */
  side: z.enum(["borrower_counsel", "client", "lender", "practice_support"]),
  voice: z.string().min(1),
  teaching_or_negotiating_style: z.string().optional(),
  wants: z.string().optional(),
  knows: z.object({
    /** Fact keys or glob prefixes (e.g. `facility.*`). */
    facts: z.array(z.string()).default([]),
    documents: z.array(DocumentIdSchema).default([]),
    /** Free-text world knowledge the character can use. */
    background: z.array(z.string()).default([]),
  }),
  does_not_know: z.array(z.string()).default([]),
  never_does: z.array(z.string()).default([]),
  writes_when: z.array(z.string()).default([]),
  sample_messages: z.array(z.string()).default([]),
  /** Reply delay window in seconds; zero in test mode. */
  reply_delay_seconds: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
  /** If true, this character is the doctrine assistant: sees only the question text. */
  is_doctrine_assistant: z.boolean().default(false),
  /** If true, this character can deliver Socratic follow-ups on deliverables. */
  gives_socratic_feedback: z.boolean().default(false),
});
export type Character = z.infer<typeof CharacterSchema>;

// ---------------------------------------------------------------- conditions (shared DSL)
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { session_started: true }
  | { milestone_complete: string }
  | { milestone_entered: string }
  | { assignment_complete: string }
  | { assignment_open: string }
  | { beat_delivered: string }
  | { consequence_active: string }
  | { consequence_fired: string }
  | { issue_status: { issue: string; status: "raised" | "partial" | "missed" } }
  | { decision_taken: { decision_point: string; position?: string } }
  | { replies_on_thread: { thread_key: string; count: number } }
  | { emails_sent_in_assignment: { assignment: string; count: number } }
  | { intent_on_thread: { thread_key: string; intent: "deliverable" | "question" | "logistics" | "acknowledgment" } };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionSchema) }).strict(),
    z.object({ any: z.array(ConditionSchema) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
    z.object({ session_started: z.literal(true) }).strict(),
    z.object({ milestone_complete: MilestoneIdSchema }).strict(),
    z.object({ milestone_entered: MilestoneIdSchema }).strict(),
    z.object({ assignment_complete: AssignmentIdSchema }).strict(),
    z.object({ assignment_open: AssignmentIdSchema }).strict(),
    z.object({ beat_delivered: BeatIdSchema }).strict(),
    z.object({ consequence_active: ConsequenceIdSchema }).strict(),
    z.object({ consequence_fired: ConsequenceIdSchema }).strict(),
    z.object({ issue_status: z.object({ issue: IssueIdSchema, status: z.enum(["raised", "partial", "missed"]) }) }).strict(),
    z.object({ decision_taken: z.object({ decision_point: DecisionPointIdSchema, position: PositionIdSchema.optional() }) }).strict(),
    z.object({ replies_on_thread: z.object({ thread_key: z.string(), count: z.number().int().min(1) }) }).strict(),
    z.object({ emails_sent_in_assignment: z.object({ assignment: AssignmentIdSchema, count: z.number().int().min(1) }) }).strict(),
    z.object({ intent_on_thread: z.object({ thread_key: z.string(), intent: z.enum(["deliverable", "question", "logistics", "acknowledgment"]) }) }).strict(),
  ]),
);

// ---------------------------------------------------------------- milestones.yaml
export const MilestoneSchema = z.object({
  id: MilestoneIdSchema,
  order: z.number().int().min(1).max(8),
  title: z.string().min(1),
  summary: z.string().min(1),
  entry: ConditionSchema,
  exit: ConditionSchema,
  assignments: z.array(AssignmentIdSchema).min(1),
  threads_open: z.array(z.string()).default([]),
  possible_interruptions: z.array(BeatIdSchema).default([]),
  /** One-line the recap engine can use to describe where the associate is. */
  recap_hint: z.string().optional(),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

// ---------------------------------------------------------------- assignments.yaml
export const IssueTierSchema = z.enum(["expected", "strong", "expert"]);
export const IssueSchema = z.object({
  id: IssueIdSchema,
  tier: IssueTierSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  raised_looks_like: z.string().min(1),
  partial_looks_like: z.string().optional(),
  delta: DeltaIdSchema.optional(),
  competencies: z.array(CompetencySchema).default([]),
  /** Keywords the mock assessor and the bot associate use; the real assessor ignores them. */
  keywords: z.array(z.coerce.string()).default([]),
});
export type Issue = z.infer<typeof IssueSchema>;

export const PositionSchema = z.object({
  id: PositionIdSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  tradeoffs: z.string().optional(),
});
export const DecisionPointSchema = z.object({
  id: DecisionPointIdSchema,
  title: z.string().min(1),
  trigger: z.string().min(1),
  question: z.string().min(1),
  positions: z.array(PositionSchema).min(2),
  /** Short prompt shown on the at-send sheet. */
  rationale_prompt: z.string().min(1),
});
export type DecisionPoint = z.infer<typeof DecisionPointSchema>;

export const AssignmentSchema = z.object({
  id: AssignmentIdSchema,
  milestone: MilestoneIdSchema,
  title: z.string().min(1),
  deliverable: z.string().min(1),
  /** Character who assigns it and who receives the Socratic follow-up duty. */
  assigned_by: CharacterIdSchema,
  /** Character who replies with Socratic questions after the deliverable. */
  feedback_from: CharacterIdSchema,
  /** Thread key the deliverable is expected on. */
  thread_key: z.string().min(1),
  /** Who the deliverable is expected to go to. Used by the mock bot and by routing hints. */
  expected_recipients: z.array(CharacterIdSchema).min(1),
  competencies: z.array(CompetencySchema).min(1),
  issues: z.array(IssueSchema).default([]),
  decision_points: z.array(DecisionPointSchema).default([]),
  socratic_angles: z.array(z.string()).default([]),
  common_misses: z.array(z.string()).default([]),
  /** How the assignment completes. */
  completion: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("deliverable") }),
    z.object({ kind: z.literal("any_reply"), thread_key: z.string().optional() }),
  ]),
  approx_minutes: z.number().int().optional(),
});
export type Assignment = z.infer<typeof AssignmentSchema>;

// ---------------------------------------------------------------- deltas.yaml
export const DeltaSchema = z.object({
  id: DeltaIdSchema,
  provision: z.string().min(1),
  document: DocumentIdSchema,
  section_ref: z.string().optional(),
  term_sheet_says: z.string().min(1),
  document_says: z.string().min(1),
  delta_type: z.enum(["standard", "aggressive", "new_provision", "omission", "clarification"]),
  lender_flexibility: z.enum(["low", "medium", "high"]),
  competencies: z.array(CompetencySchema).default([]),
  surfaces_in: MilestoneIdSchema,
  strong_associate_does: z.string().min(1),
  status: z.enum(["not_drafted", "drafted", "reviewed"]).default("not_drafted"),
});
export type Delta = z.infer<typeof DeltaSchema>;

// ---------------------------------------------------------------- consequences.yaml
export const ConsequenceSeedSchema = z.union([
  z.object({ issue: IssueIdSchema, outcome: z.enum(["raised", "partial", "missed"]) }).strict(),
  z.object({ decision_point: DecisionPointIdSchema, outcome: PositionIdSchema }).strict(),
]);
export const ConsequenceSchema = z.object({
  id: ConsequenceIdSchema,
  title: z.string().min(1),
  seed: ConsequenceSeedSchema,
  payoff_milestone: MilestoneIdSchema,
  raised_by: CharacterIdSchema,
  beat: BeatIdSchema,
  how_it_appears: z.string().min(1),
  severity: z.enum(["minor", "moderate", "major"]),
  recoverable: z.boolean(),
  positive: z.boolean(),
  debrief_candidate: z.boolean(),
});
export type Consequence = z.infer<typeof ConsequenceSchema>;

// ---------------------------------------------------------------- verification.yaml
export const VerificationPacketSchema = z.object({
  id: z.string().regex(/^V\d{2}$/),
  assignment: AssignmentIdSchema,
  title: z.string().min(1),
  /** The flawed AI-produced draft, as a document in the package. */
  draft_document: DocumentIdSchema,
  source_documents: z.array(DocumentIdSchema).min(1),
  known_flaws: z.array(
    z.object({
      id: z.string().regex(/^V\d{2}\.F\d{1,2}$/),
      location: z.string().min(1),
      description: z.string().min(1),
      issue: IssueIdSchema,
    }),
  ).min(1),
});
export type VerificationPacket = z.infer<typeof VerificationPacketSchema>;

// ---------------------------------------------------------------- negotiation.yaml
export const NegotiationPointSchema = z.object({
  id: z.string().regex(/^N\d{2}$/),
  title: z.string().min(1),
  delta: DeltaIdSchema.optional(),
  /** Attorney-written positions. The lender's counsel character quotes these; it never improvises them. */
  lender_opening: z.string().min(1),
  lender_fallback: z.string().min(1),
  lender_walk_away: z.string().min(1),
  flexibility: z.enum(["low", "medium", "high"]),
  /** Deterministic rule the engine uses to decide where the point lands. */
  resolution: z.enum(["opening", "fallback", "walk_away"]).default("fallback"),
});
export type NegotiationPoint = z.infer<typeof NegotiationPointSchema>;

// ---------------------------------------------------------------- beats.yaml
export const BeatSchema = z.object({
  id: BeatIdSchema,
  title: z.string().min(1),
  trigger: ConditionSchema,
  sender: CharacterIdSchema,
  to: z.array(z.union([CharacterIdSchema, z.literal("associate")])).min(1),
  cc: z.array(z.union([CharacterIdSchema, z.literal("associate")])).default([]),
  /** Thread key: new thread if none exists yet with that key, otherwise a reply on it. */
  thread_key: z.string().min(1),
  subject: z.string().optional(),
  mode: z.enum(["fixed", "generated"]),
  /** Fixed text, attorney-reviewed. Required when mode is fixed. */
  body: z.string().optional(),
  /** Brief for the character writer. Required when mode is generated. */
  brief: z.string().optional(),
  must_include_facts: z.array(FactKeySchema).default([]),
  attachments: z.array(DocumentIdSchema).default([]),
  /** Delay override in seconds; otherwise the sender's default window. */
  delay_seconds: z.number().int().min(0).optional(),
  /** Beats that must be delivered before this one may go out (ordering within one trigger). */
  after: z.array(BeatIdSchema).default([]),
  /** Marks the assignment this beat opens, if any. */
  opens_assignment: AssignmentIdSchema.optional(),
  /** Interruption beats reprioritise but never block. */
  is_interruption: z.boolean().default(false),
}).superRefine((b, ctx) => {
  if (b.mode === "fixed" && !b.body) ctx.addIssue({ code: "custom", message: `Beat ${b.id} is fixed but has no body` });
  if (b.mode === "generated" && !b.brief) ctx.addIssue({ code: "custom", message: `Beat ${b.id} is generated but has no brief` });
});
export type Beat = z.infer<typeof BeatSchema>;

// ---------------------------------------------------------------- documents/register.yaml
export const DocumentRegisterEntrySchema = z.object({
  id: DocumentIdSchema,
  title: z.string().min(1),
  short_title: z.string().min(1),
  kind: z.enum(["term_sheet", "loan_agreement", "schedule", "certificate", "checklist", "ai_draft", "other"]),
  /** Source file, relative to documents/. Markdown today; .docx via pandoc when attorney-approved files exist. */
  source: z.string().min(1),
  /** The character who sends it into the deal. */
  from: CharacterIdSchema,
  version: z.string().min(1),
  attorney_reviewed: z.boolean().default(false),
  realism_notes: z.string().optional(),
});
export type DocumentRegisterEntry = z.infer<typeof DocumentRegisterEntrySchema>;
export const DocumentRegisterSchema = z.array(DocumentRegisterEntrySchema);

// ---------------------------------------------------------------- whole package
export const ScenarioPackageSchema = z.object({
  meta: ScenarioMetaSchema,
  facts: FactsSchema,
  characters: z.array(CharacterSchema).min(1),
  milestones: z.array(MilestoneSchema).min(1),
  assignments: z.array(AssignmentSchema).min(1),
  deltas: z.array(DeltaSchema),
  consequences: z.array(ConsequenceSchema),
  verification: z.array(VerificationPacketSchema),
  negotiation: z.array(NegotiationPointSchema),
  beats: z.array(BeatSchema).min(1),
  documents: DocumentRegisterSchema,
});
export type ScenarioPackage = z.infer<typeof ScenarioPackageSchema>;

/** Built document as shipped with the package: HTML with section anchors plus an anchor map. */
export const DocumentAnchorSchema = z.object({
  id: z.string(),
  /** Human reference, e.g. "Section 6.2(b)" or "Exhibit A". */
  ref: z.string(),
  title: z.string(),
  level: z.number().int(),
});
export type DocumentAnchor = z.infer<typeof DocumentAnchorSchema>;
export const BuiltDocumentSchema = z.object({
  id: DocumentIdSchema,
  title: z.string(),
  html: z.string(),
  text: z.string(),
  anchors: z.array(DocumentAnchorSchema),
  source_hash: z.string(),
});
export type BuiltDocument = z.infer<typeof BuiltDocumentSchema>;
