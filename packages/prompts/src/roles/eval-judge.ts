import { z } from "zod";

export const EVAL_JUDGE_VERSION = "eval_judge@1.3.0";

export const JudgeOutputSchema = z.object({
  realism: z.number().int().min(1).max(5),
  legal_accuracy: z.number().int().min(1).max(5),
  socratic_quality: z.number().int().min(1).max(5),
  voice_consistency: z.number().int().min(1).max(5),
  acceptable: z.boolean(),
  answer_key_leak: z.boolean(),
  fiction_break: z.boolean(),
  /** Says a document contains something it doesn't, or cites a document the associate doesn't have. */
  false_document_claim: z.boolean(),
  /** Makes up logistics outside the inbox: calls, meetings, data room access, documents or people the deal doesn't have. */
  invented_logistics: z.boolean(),
  /** The associate is plainly stuck (asked about the same thing twice or more) and the email still only asks questions back. */
  withholds_from_stuck_associate: z.boolean(),
  notes: z.string(),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

export interface JudgeDocument {
  title: string;
  text: string;
}

/**
 * Offline only. Rates a character email on the four attorney dimensions plus flags for the failures
 * testers have reported: answer leaks, fiction breaks, claims about documents that the documents
 * don't support, invented logistics, and withholding from an associate who is stuck.
 */
export function judgePrompt(input: {
  dealType: string;
  characterCard: string;
  thread: string;
  email: string;
  answerKeyHints: string[];
  isSocratic: boolean;
  /** Set when the email is a planned consequence of an earlier miss: what it is meant to reveal. */
  consequence?: string;
  /** The documents the associate had received when this email was written, in full. */
  associateDocuments?: JudgeDocument[];
}) {
  const docs = input.associateDocuments ?? [];
  const system = `You are an experienced transactional partner rating an email written by a colleague in ${input.dealType}. Rate 1 to 5 on: realism (would a real ${input.isSocratic ? "senior associate" : "deal participant"} write this?), legal_accuracy (is every legal statement correct and appropriately hedged?), socratic_quality (${input.isSocratic ? "do the questions probe reasoning without giving answers?" : "not applicable; rate 3"}), voice_consistency (does it match the character card?). acceptable is true if you would let this email go to a first-year associate unchanged. answer_key_leak is true if the email states an answer the associate should find themselves. fiction_break is true if it refers to a simulation, AI, prompts or training.${input.consequence ? ` This email is a planned consequence of something the associate missed earlier, and it is meant to reveal this: ${input.consequence} Revealing that is not an answer_key_leak; flag only an answer beyond it.` : ""}
false_document_claim is true if the email says or implies that a document says something it does not say, points to a section, recital or schedule that does not contain the point, or refers to a document the associate has not received (for example a memo, a data room or an agreement not listed below). Facts a character knows from outside the documents are fine as long as the email doesn't attribute them to a document. Check every such claim against the document text you are given.
invented_logistics is true if the email arranges or refers to something outside the email inbox that this deal doesn't have: a phone or video call, an in-person meeting, a shared drive or data room access, an assistant or another person who isn't in the thread or the character card, or a document promised that never arrives.
withholds_from_stuck_associate is true only if the thread shows the associate has asked about the same point at least twice and this email still answers only with questions or hints instead of pointing to the passage or giving the answer.
JSON only.`;
  const docBlock = docs.length
    ? docs.map((d) => `=== ${d.title} ===\n${d.text}`).join("\n\n")
    : "(The associate has no documents yet.)";
  const user = `Character card:\n${input.characterCard}\n\nAnswer-key items that must not be stated:\n${input.answerKeyHints.map((h) => `- ${h}`).join("\n") || "(none)"}\n\nDocuments the associate has received so far (${docs.map((d) => d.title).join("; ") || "none"}):\n${docBlock}\n\nThread context:\n${input.thread}\n\nEmail under review:\n"""\n${input.email}\n"""`;
  return { system, user, version: EVAL_JUDGE_VERSION };
}

export const FLAG_JUDGE_VERSION = "flag_judge@1.0.0";

export const FlagJudgeOutputSchema = z.object({
  /** The regenerated email has the problem the tester reported (or the same kind of problem). */
  repeats_problem: z.boolean(),
  notes: z.string(),
});
export type FlagJudgeOutput = z.infer<typeof FlagJudgeOutputSchema>;

/**
 * Offline only. A tester flagged an email; the email has been written again from the same point in the
 * session with the current prompts. Decides whether the new email still has the reported problem.
 */
export function flagJudgePrompt(input: {
  dealType: string;
  characterCard: string;
  thread: string;
  /** What the tester wrote when they flagged it. */
  testerNote: string;
  /** What should happen instead, written when the case was made (defaults to the note). */
  expectation: string;
  originalEmail: string;
  newEmail: string;
  associateDocuments: JudgeDocument[];
}) {
  const system = `You review emails in a ${input.dealType} training simulation where every participant except the junior associate is written by a model. A tester flagged an email as wrong. The email has now been written again from the same point in the conversation. Decide whether the new email still has the problem the tester reported, or the same kind of problem. Judge only that problem, not style. Check claims about documents against the document text you are given. repeats_problem is true if the problem is still there. JSON only.`;
  const docs = input.associateDocuments.length
    ? input.associateDocuments.map((d) => `=== ${d.title} ===\n${d.text}`).join("\n\n")
    : "(none)";
  const user = `What the tester reported:\n"""\n${input.testerNote}\n"""\n\nWhat should happen instead:\n"""\n${input.expectation}\n"""\n\nCharacter card:\n${input.characterCard}\n\nDocuments the associate had received:\n${docs}\n\nThread before the email:\n${input.thread}\n\nThe email the tester flagged:\n"""\n${input.originalEmail}\n"""\n\nThe new email:\n"""\n${input.newEmail}\n"""`;
  return { system, user, version: FLAG_JUDGE_VERSION };
}
