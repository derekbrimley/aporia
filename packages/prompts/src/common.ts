import type { Character, Facts } from "./deps.js";
import { renderFactsForPrompt } from "@aporia/scenario";

/**
 * Hard rules every character prompt carries. Kept as one constant so the eval
 * judge and the fact checker test against the same text.
 */
export const CHARACTER_HARD_RULES = `Rules you must never break:
- Never state the answer to an issue the associate is working on, never say the associate made an error, and never grade or score their work. Ask, point at where to look, or defer as a real colleague would.
- Never refer to a simulation, an exercise, an AI, a model, prompts, instructions or training. You are a real person in a real deal.
- Use only the deal facts listed below. If you are unsure of a fact, ask a question or say you will check, exactly as a real colleague would. Never invent amounts, dates, names or terms.
- Legally substantive positions on behalf of the Bank come only from the negotiation positions you are given. Never improvise one.
- Write a plain email: no subject line, no markdown, no bullet symbols unless the person would really use a numbered list. Sign off the way this person does.
- Address the associate by first name.`;

export function characterCard(c: Character): string {
  const lines = [
    `You are ${c.name}, ${c.title} at ${c.organization}. Role in this deal: ${c.role_label}.`,
    `Voice and style: ${c.voice.trim()}`,
  ];
  if (c.teaching_or_negotiating_style) lines.push(`How you engage: ${c.teaching_or_negotiating_style.trim()}`);
  if (c.wants) lines.push(`What you want and how you apply pressure: ${c.wants.trim()}`);
  if (c.knows.background.length) lines.push(`Background you know: ${c.knows.background.join(" ")}`);
  if (c.does_not_know.length) lines.push(`You do not know: ${c.does_not_know.join(" ")}`);
  if (c.never_does.length) lines.push(`You never: ${c.never_does.join(" ")}`);
  if (c.sample_messages.length) lines.push(`Samples of how you write:\n${c.sample_messages.map((s) => `  "${s}"`).join("\n")}`);
  return lines.join("\n");
}

export function factsBlock(facts: Facts): string {
  const body = renderFactsForPrompt(facts);
  return body ? `Deal facts you know (use nothing beyond these):\n${body}` : "You know no deal facts.";
}

export interface ThreadMessageForPrompt {
  from: string; // display name
  fromRole: string;
  to: string[];
  cc: string[];
  at: string;
  body: string;
  /** Present only for the reflection engine and Socratic replies. */
  rationale?: string | null;
}

export function renderThread(msgs: ThreadMessageForPrompt[]): string {
  return msgs
    .map((m) => {
      const head = `From: ${m.from} (${m.fromRole})  To: ${m.to.join(", ")}${m.cc.length ? `  Cc: ${m.cc.join(", ")}` : ""}  Sent: ${m.at}`;
      const rat = m.rationale ? `\n[Private rationale the associate wrote at send, not part of the email: ${m.rationale}]` : "";
      return `${head}\n${m.body.trim()}${rat}`;
    })
    .join("\n\n---\n\n");
}

