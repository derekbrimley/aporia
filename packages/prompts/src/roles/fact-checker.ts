import { z } from "zod";
import type { Character, Facts } from "../deps.js";
import { factsBlock } from "../common.js";

export const FACT_CHECKER_VERSION = "fact_checker@1.0.0";

export const FactCheckOutputSchema = z.object({
  pass: z.boolean(),
  violations: z.array(z.object({
    kind: z.enum(["slice_contradiction", "answer_key_leak", "fiction_break", "grading", "invented_fact"]),
    detail: z.string(),
  })),
});
export type FactCheckOutput = z.infer<typeof FactCheckOutputSchema>;

/** Layer 2 of the fact checker: model check for slice contradictions, answer-key leaks and fiction breaks. */
export function factCheckerPrompt(input: { character: Character; slice: Facts; draft: string; answerKeyHints: string[]; isSocratic: boolean }) {
  const system = `You review a draft email written in the voice of a character in a legal deal. Flag only real problems:
- slice_contradiction: the draft states a deal fact (amount, date, party, term) that contradicts or is absent from the character's known facts. Reasonable inference from the known facts is fine; new specifics are not.
- answer_key_leak: the draft tells the associate the answer to an issue they are meant to find themselves, or lists what they missed. ${input.isSocratic ? "Questions that point toward an area are fine; statements of the answer are not." : ""}
- fiction_break: the draft refers to a simulation, exercise, AI, model, prompt, training, or otherwise breaks character.
- grading: the draft scores, grades, ranks or explicitly labels the associate's work as right or wrong.
- invented_fact: the draft invents a named person, document, section number or figure not in the known facts.
Be strict about amounts, dates and party names; be lenient about tone. Output JSON only.`;
  const user = `Character: ${input.character.name} (${input.character.role_label}).\n\n${factsBlock(input.slice)}\n\nAnswer-key items this character must never state outright:\n${input.answerKeyHints.map((h) => `- ${h}`).join("\n") || "(none)"}\n\nDraft email:\n"""\n${input.draft}\n"""`;
  return { system, user, version: FACT_CHECKER_VERSION };
}
