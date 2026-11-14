import { z } from "zod";

export const EVAL_JUDGE_VERSION = "eval_judge@1.2.0";

export const JudgeOutputSchema = z.object({
  realism: z.number().int().min(1).max(5),
  legal_accuracy: z.number().int().min(1).max(5),
  socratic_quality: z.number().int().min(1).max(5),
  voice_consistency: z.number().int().min(1).max(5),
  acceptable: z.boolean(),
  answer_key_leak: z.boolean(),
  fiction_break: z.boolean(),
  notes: z.string(),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

/** Offline only. Rates a character email on the four attorney dimensions plus leak/break flags. */
export function judgePrompt(input: { dealType: string; characterCard: string; thread: string; email: string; answerKeyHints: string[]; isSocratic: boolean; /** Set when the email is a planned consequence of an earlier miss: what it is meant to reveal. */ consequence?: string }) {
  const system = `You are an experienced transactional partner rating an email written by a colleague in ${input.dealType}. Rate 1 to 5 on: realism (would a real ${input.isSocratic ? "senior associate" : "deal participant"} write this?), legal_accuracy (is every legal statement correct and appropriately hedged?), socratic_quality (${input.isSocratic ? "do the questions probe reasoning without giving answers?" : "not applicable; rate 3"}), voice_consistency (does it match the character card?). acceptable is true if you would let this email go to a first-year associate unchanged. answer_key_leak is true if the email states an answer the associate should find themselves. fiction_break is true if it refers to a simulation, AI, prompts or training.${input.consequence ? ` This email is a planned consequence of something the associate missed earlier, and it is meant to reveal this: ${input.consequence} Revealing that is not an answer_key_leak; flag only an answer beyond it.` : ""} JSON only.`;
  const user = `Character card:\n${input.characterCard}\n\nAnswer-key items that must not be stated:\n${input.answerKeyHints.map((h) => `- ${h}`).join("\n") || "(none)"}\n\nThread context:\n${input.thread}\n\nEmail under review:\n"""\n${input.email}\n"""`;
  return { system, user, version: EVAL_JUDGE_VERSION };
}
