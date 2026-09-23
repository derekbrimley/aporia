import type { Beat, Character, Facts, NegotiationPoint } from "../deps.js";
import { CHARACTER_HARD_RULES, characterCard, factsBlock, renderThread, type ThreadMessageForPrompt } from "../common.js";

export const CHARACTER_WRITER_VERSION = "character_writer@1.0.0";

export interface CharacterWriterInput {
  character: Character;
  facts: Facts;
  associateFirstName: string;
  /** Threads this character is on, most relevant last. */
  thread: ThreadMessageForPrompt[];
  otherThreads?: { subject: string; messages: ThreadMessageForPrompt[] }[];
  mode:
    | { kind: "reply"; toMessageBody: string }
    | { kind: "beat"; beat: Beat; mustIncludeFacts: Facts }
    | { kind: "interruption"; beat: Beat; mustIncludeFacts: Facts };
  negotiation?: NegotiationPoint[];
  /** Violations from the fact checker on a previous attempt, for regeneration. */
  feedback?: string[];
  /** Today's date inside the fiction. */
  storyDate: string;
}

/**
 * Stable content (character card, facts, rules) comes first so the prompt
 * prefix caches across calls; the thread and the brief come last.
 */
export function characterWriterPrompt(input: CharacterWriterInput) {
  const c = input.character;
  const negotiation = input.negotiation?.length
    ? `\n\nNegotiation positions you may take on behalf of the Bank (quote or paraphrase; never go beyond them):\n${input.negotiation.map((n) => `- ${n.title}: opening: ${n.lender_opening} | fallback (only after the borrower gives a reason): ${n.lender_fallback} | walk-away: ${n.lender_walk_away}`).join("\n")}`
    : "";
  const system = `${characterCard(c)}\n\n${CHARACTER_HARD_RULES}\n\n${factsBlock(input.facts)}${negotiation}\n\nThe associate you write to is ${input.associateFirstName}, a junior associate at ${c.side === "borrower_counsel" ? "your firm" : "Whitfield Marsh LLP, borrower's counsel"}.`;

  let task: string;
  if (input.mode.kind === "reply") {
    task = `Write your reply to the most recent email on this thread. Respond as you would in a real deal, in your voice, within what you know. If the email asks you to decide something legal or to give the answer to the associate's assignment, do what this person would really do: ask what they think, redirect, or defer.`;
  } else {
    const b = input.mode.beat;
    const must = Object.keys(input.mode.mustIncludeFacts).length ? `\nThese facts must appear accurately in the email:\n${factsBlock(input.mode.mustIncludeFacts).split("\n").slice(1).join("\n")}` : "";
    task = `Write a new email${input.thread.length ? " on this thread" : ""} following this brief:\n${b.brief?.trim()}${must}${b.attachments.length ? `\nYou are attaching: ${b.attachments.join(", ")}. Refer to the attachments naturally.` : ""}`;
  }
  const others = input.otherThreads?.length
    ? `\n\nOther threads you are on (for context only):\n${input.otherThreads.map((t) => `Subject: ${t.subject}\n${renderThread(t.messages.slice(-3))}`).join("\n\n")}`
    : "";
  const feedback = input.feedback?.length ? `\n\nA previous draft was rejected for these reasons; fix every one:\n${input.feedback.map((f) => `- ${f}`).join("\n")}` : "";
  const user = `Today is ${input.storyDate}.${others}\n\nThe thread:\n${renderThread(input.thread) || "(new thread)"}\n\n${task}${feedback}\n\nWrite only the body of the email.`;
  return { system, user, version: CHARACTER_WRITER_VERSION };
}
