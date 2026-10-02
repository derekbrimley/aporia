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
  /** The email this one forwards, quoted beneath the body. */
  forwarded?: ForwardedForPrompt | null;
}

export interface ForwardedForPrompt {
  from: string;
  fromRole: string;
  to: string[];
  cc: string[];
  at: string;
  subject: string;
  body: string;
  attachments: string[];
}

export function renderForwarded(f: ForwardedForPrompt): string {
  const head = [`From: ${f.from} (${f.fromRole})`, `Sent: ${f.at}`, `Subject: ${f.subject}`, `To: ${f.to.join(", ")}`];
  if (f.cc.length) head.push(`Cc: ${f.cc.join(", ")}`);
  if (f.attachments.length) head.push(`Attachments: ${f.attachments.join(", ")}`);
  return `---------- Forwarded message ----------\n${head.join("\n")}\n\n${f.body.trim()}`;
}

export function renderThread(msgs: ThreadMessageForPrompt[]): string {
  return msgs
    .map((m) => {
      const head = `From: ${m.from} (${m.fromRole})  To: ${m.to.join(", ")}${m.cc.length ? `  Cc: ${m.cc.join(", ")}` : ""}  Sent: ${m.at}`;
      const body = [m.body.trim(), m.forwarded ? renderForwarded(m.forwarded) : ""].filter(Boolean).join("\n\n");
      return `${head}\n${body}`;
    })
    .join("\n\n---\n\n");
}

