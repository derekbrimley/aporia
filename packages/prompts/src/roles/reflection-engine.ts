import { z } from "zod";
import type { Assignment, Character, Facts } from "../deps.js";
import { CHARACTER_HARD_RULES, characterCard, factsBlock, renderThread, type ThreadMessageForPrompt } from "../common.js";
import type { AssessmentOutput } from "./assessor.js";

export const REFLECTION_ENGINE_VERSION = "reflection_engine@1.0.0";

export const ReflectionOutputSchema = z.object({
  questions: z.array(z.string()).min(1).max(3),
  email_body: z.string(),
});
export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

/**
 * Socratic follow-up. Sees the assessment and the assignment's Socratic angles
 * (answer key), the associate's rationale, and every reflection question already
 * asked in the session (repetition guard). Produces 1–3 questions woven into an
 * email in the feedback character's voice.
 */
export function reflectionPrompt(input: {
  character: Character;
  facts: Facts;
  associateFirstName: string;
  assignment: Assignment;
  assessment: AssessmentOutput;
  rationale: string | null;
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
  const system = `${characterCard(input.character)}\n\n${CHARACTER_HARD_RULES}\n\n${factsBlock(input.facts)}\n\nYou are replying to ${input.associateFirstName}'s work product with Socratic questions. The questions do the teaching. You never announce an error, never list what was missed, never hint at the answer. You ask about the reasoning so the associate discovers the gap themselves. A thin or absent rationale earns sharper, more specific questions; a strong one earns a question that pushes one level deeper. Vary the form of your questions (a hypothetical, a "where would you look", a "what would the client lose", a comparison) and never reuse a question already asked in this deal.\n\nOutput JSON: {"questions": [1 to 3 questions, each a single sentence], "email_body": the full email in your voice that weaves those questions in naturally, with a brief opening line and your sign-off}.`;
  const user = `Today is ${input.storyDate}.\n\nAssignment ${a.id}: ${a.title}. Answer key (never state it):\n${key || "(none)"}\n\nAssessment of the deliverable (private): raised ${raised.join(", ") || "none"}; partial ${partial.join(", ") || "none"}; missed ${missed.join(", ") || "none"}. Rationale quality: ${input.assessment.rationale_quality}. ${input.assessment.summary}\n\nSocratic angles the assignment author suggested:\n${a.socratic_angles.map((s) => `- ${s}`).join("\n") || "(none)"}\nCommon misses:\n${a.common_misses.map((s) => `- ${s}`).join("\n") || "(none)"}\n\nThe associate's private rationale at send: ${input.rationale ? `"${input.rationale}"` : "(none written)"}\n\nQuestions already asked in this deal (do not repeat in form or angle):\n${input.priorQuestions.map((q) => `- ${q}`).join("\n") || "(none yet)"}\n\nThe thread:\n${renderThread(input.thread)}${input.feedback?.length ? `\n\nA previous draft was rejected for these reasons; fix every one:\n${input.feedback.map((f) => `- ${f}`).join("\n")}` : ""}`;
  return { system, user, version: REFLECTION_ENGINE_VERSION };
}
