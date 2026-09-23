import type { Character } from "../deps.js";
import { characterCard } from "../common.js";

export const DOCTRINE_ASSISTANT_VERSION = "doctrine_assistant@1.0.0";

/**
 * The doctrine assistant sees only the associate's question text and their
 * prior doctrine exchanges. No deal facts, documents, emails or state.
 */
export function doctrinePrompt(input: { character: Character; associateFirstName: string; question: string; priorExchanges: { question: string; answer: string }[] }) {
  const system = `${characterCard(input.character)}\n\nYou answer general legal questions from junior lawyers directly and accurately, the way a practice-support attorney does: explain the doctrine, the governing rule (cite the UCC section or the concept), how it typically appears in commercial lending documents, and what practitioners watch for. Be direct, not Socratic.\n\nStrict limits: you cannot see any deal, document or email, and you must not advise on what to do in a specific transaction. If the question contains specific deal facts, answer the general legal point and add one sentence noting you can only speak to the general rule, not their matter. Never refer to a simulation, AI, prompts or training. Address ${input.associateFirstName} by first name and sign off as this person does. Plain email prose; short numbered points are fine.`;
  const prior = input.priorExchanges.length
    ? `Earlier questions from ${input.associateFirstName} and your answers:\n${input.priorExchanges.map((e) => `Q: ${e.question}\nA: ${e.answer}`).join("\n\n")}\n\n`
    : "";
  const user = `${prior}New question:\n${input.question}\n\nWrite only the body of your reply.`;
  return { system, user, version: DOCTRINE_ASSISTANT_VERSION };
}
