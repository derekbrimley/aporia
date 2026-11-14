import type { Beat, Character, Facts, NegotiationPoint } from "../deps.js";
import { CHARACTER_HARD_RULES, characterCard, factsBlock, renderThread, type ThreadMessageForPrompt } from "../common.js";

export const CHARACTER_WRITER_VERSION = "character_writer@1.5.0";

export interface CharacterWriterInput {
  character: Character;
  facts: Facts;
  associateFirstName: string;
  /** Threads this character is on, most relevant last. */
  thread: ThreadMessageForPrompt[];
  otherThreads?: { subject: string; messages: ThreadMessageForPrompt[] }[];
  mode:
    | { kind: "reply"; toMessageBody: string; draftFor?: { deliverable: string; deliverToName: string } }
    | { kind: "beat"; beat: Beat; mustIncludeFacts: Facts }
    | { kind: "interruption"; beat: Beat; mustIncludeFacts: Facts };
  negotiation?: NegotiationPoint[];
  /** The deal around the associate: their firm, which side it represents, and the other side's name. */
  deal: { firm: string; side: string; counterpartyName: string };
  /** Violations from the fact checker on a previous attempt, for regeneration. */
  feedback?: string[];
  /** Today's date inside the fiction. */
  storyDate: string;
  /** Titles of the documents the associate has received so far, in order. */
  associateDocuments?: string[];
}

/** Whether the most recent email on the thread forwards another one. */
function forwardsSomething(thread: ThreadMessageForPrompt[]): boolean {
  return Boolean(thread.at(-1)?.forwarded);
}

/**
 * Stable content (character card, facts, rules) comes first so the prompt
 * prefix caches across calls; the thread and the brief come last.
 */
export function characterWriterPrompt(input: CharacterWriterInput) {
  const c = input.character;
  const negotiation = input.negotiation?.length
    ? `\n\nNegotiation positions you may take on behalf of ${input.deal.counterpartyName} (quote or paraphrase; never go beyond them):\n${input.negotiation.map((n) => `- ${n.title}: opening: ${n.opening} | fallback (only after the ${input.deal.side} gives a reason): ${n.fallback} | walk-away: ${n.walk_away}`).join("\n")}`
    : "";
  const system = `${characterCard(c)}\n\n${CHARACTER_HARD_RULES}\n\n${factsBlock(input.facts)}${negotiation}\n\nThe associate you write to is ${input.associateFirstName}, a junior associate at ${c.side === "own_firm" ? "your firm" : `${input.deal.firm}, ${input.deal.side}'s counsel`}.`;

  const noAttachments = " You cannot attach anything to this email, so never say you are attaching, sending or forwarding a document, or that one is on its way.";
  let task: string;
  if (input.mode.kind === "reply") {
    task = `Write your reply to the most recent email on this thread. If the associate sent several emails since you last wrote, answer them together in this one reply. Respond as you would in a real deal, in your voice, within what you know.${noAttachments} If the email asks you to decide something legal or to give the answer to the associate's assignment, do what this person would really do: ask what they think, redirect, or defer.${forwardsSomething(input.thread) ? ` The associate forwarded you the email quoted under "Forwarded message"; you have now read it and may refer to what it says.` : ""}${input.mode.draftFor ? ` The associate sent this to you only; it has not gone to ${input.mode.draftFor.deliverToName} yet. It reads as their draft of this assignment: ${input.mode.draftFor.deliverable} React the way a senior associate reviewing a draft would: keep it short, don't grade it or rewrite it, ask at most one question, and tell them to send it to ${input.mode.draftFor.deliverToName} when they're ready. Do not talk as if ${input.mode.draftFor.deliverToName} has seen it.` : ""}`;
  } else {
    const b = input.mode.beat;
    const must = Object.keys(input.mode.mustIncludeFacts).length ? `\nThese facts must appear accurately in the email:\n${factsBlock(input.mode.mustIncludeFacts).split("\n").slice(1).join("\n")}` : "";
    task = `Write a new email${input.thread.length ? " on this thread" : ""} following this brief:\n${b.brief?.trim()}${must}${b.attachments.length ? `\nYou are attaching: ${b.attachments.join(", ")}. Refer to the attachments naturally.` : noAttachments}`;
  }
  const others = input.otherThreads?.length
    ? `\n\nOther threads you are on (for context only):\n${input.otherThreads.map((t) => `Subject: ${t.subject}\n${renderThread(t.messages.slice(-3))}`).join("\n\n")}`
    : "";
  const feedback = input.feedback?.length ? `\n\nA previous draft was rejected for these reasons; fix every one:\n${input.feedback.map((f) => `- ${f}`).join("\n")}` : "";
  const docs = input.associateDocuments
    ? `\n\nDocuments ${input.associateFirstName} has received so far: ${input.associateDocuments.length ? input.associateDocuments.join("; ") : "none"}. They have nothing else yet. Don't suggest they already have, or can look at, any other document.`
    : "";
  const user = `Today is ${input.storyDate}.${docs}${others}\n\nThe thread:\n${renderThread(input.thread) || "(new thread)"}\n\n${task}${feedback}\n\nWrite only the body of the email.`;
  return { system, user, version: CHARACTER_WRITER_VERSION };
}
