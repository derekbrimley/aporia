import { z } from "zod";
import type { Assignment, Character, DecisionPoint, Facts } from "../deps.js";
import { CHARACTER_HARD_RULES, characterCard, factsBlock, renderThread, type ThreadMessageForPrompt } from "../common.js";
import type { AssessmentOutput } from "./assessor.js";

export const REFLECTION_ENGINE_VERSION = "reflection_engine@1.2.0";

export const ReflectionOutputSchema = z.object({
  questions: z.array(z.string()).min(1).max(3),
  email_body: z.string(),
});
export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

/**
 * Socratic follow-up. Sees the assessment and the assignment's Socratic angles
 * (answer key), the calls the associate made, and every reflection question already
 * asked in the session (repetition guard). Produces 1–3 questions woven into an
 * email in the feedback character's voice. The associate's answer becomes their
 * recorded reasoning, so a call they made always gets a question about it.
 */
export function reflectionPrompt(input: {
  character: Character;
  facts: Facts;
  associateFirstName: string;
  assignment: Assignment;
  assessment: AssessmentOutput;
  /** Decision points the deliverable took a position on, with the position's label. */
  decisions: { point: DecisionPoint; positionLabel: string }[];
  /** True when the deliverable went outside the firm and this email is a private side note. */
  privateNote: boolean;
  thread: ThreadMessageForPrompt[];
  priorQuestions: string[];
  storyDate: string;
  feedback?: string[];
}) {
  const a = input.assignment;
  const raised = input.assessment.issues.filter((i) => i.status === "raised").map((i) => i.id);
  const partial = input.assessment.issues.filter((i) => i.status === "partial").map((i) => i.id);
  const missed = input.assessment.issues.filter((i) => i.status === "missed").map((i) => i.id);
  const key = a.issues.map((i) => `- ${i.id} [${i.tier}] ${i.title}: ${i.description}`).join("\n");
  const system = `${characterCard(input.character)}\n\n${CHARACTER_HARD_RULES}\n\n${factsBlock(input.facts)}\n\nYou are replying to ${input.associateFirstName}'s work product with Socratic questions. The questions do the teaching. You never announce an error, never list what was missed, never hint at the answer. You ask about the reasoning so the associate discovers the gap themselves. If ${input.associateFirstName} made a call, one question asks them to walk you through it, from the angle given; their email's reasoning decides how: thin or absent reasoning earns a plain "walk me through it", strong reasoning earns a question that pushes one level deeper. Vary the form of your questions (a hypothetical, a "where would you look", a "what would the client lose", a comparison) and never reuse a question already asked in this deal.\n\n${input.privateNote ? `The work went to people outside the firm. This is a private side email to ${input.associateFirstName} only, on a new thread: say briefly which email you are asking about.\n\n` : ""}Output JSON: {"questions": [1 to 3 questions, each a single sentence], "email_body": the full email in your voice that weaves those questions in naturally, with a brief opening line and your sign-off}.`;
  const user = `Today is ${input.storyDate}.\n\nAssignment ${a.id}: ${a.title}. Answer key (never state it):\n${key || "(none)"}\n\nAssessment of the deliverable (private): raised ${raised.join(", ") || "none"}; partial ${partial.join(", ") || "none"}; missed ${missed.join(", ") || "none"}. Reasoning in the email: ${input.assessment.reasoning_quality}. ${input.assessment.summary}\n\nSocratic angles the assignment author suggested:\n${a.socratic_angles.map((s) => `- ${s}`).join("\n") || "(none)"}\nCommon misses:\n${a.common_misses.map((s) => `- ${s}`).join("\n") || "(none)"}\n\nCalls the associate made:\n${input.decisions.map((d) => `- ${d.point.title}: "${d.positionLabel}". Ask about it from this angle: ${d.point.rationale_prompt}`).join("\n") || "(none)"}\n\nQuestions already asked in this deal (do not repeat in form or angle):\n${input.priorQuestions.map((q) => `- ${q}`).join("\n") || "(none yet)"}\n\nThe thread:\n${renderThread(input.thread)}${input.feedback?.length ? `\n\nA previous draft was rejected for these reasons; fix every one:\n${input.feedback.map((f) => `- ${f}`).join("\n")}` : ""}`;
  return { system, user, version: REFLECTION_ENGINE_VERSION };
}
