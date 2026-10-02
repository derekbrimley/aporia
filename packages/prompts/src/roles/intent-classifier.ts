import { z } from "zod";
import type { ForwardedForPrompt, ThreadMessageForPrompt } from "../common.js";
import { renderForwarded, renderThread } from "../common.js";

export const INTENT_CLASSIFIER_VERSION = "intent_classifier@1.1.0";

export const IntentOutputSchema = z.object({
  intent: z.enum(["deliverable", "question", "logistics", "acknowledgment"]),
  confidence: z.number().min(0).max(1),
});
export type IntentOutput = z.infer<typeof IntentOutputSchema>;

export function intentClassifierPrompt(input: { thread: ThreadMessageForPrompt[]; outgoing: { to: string[]; cc: string[]; body: string; attachments: string[]; forwarded?: ForwardedForPrompt | null }; openAssignmentTitle?: string | null }) {
  const system = `You label the intent of an outgoing email written by a junior lawyer in a deal inbox. Choose exactly one label:
- deliverable: the email carries work product the sender was asked for (comments, a report, an issues list, a checklist status, a set of positions, answers to substantive questions). Long or short, it is the sender's answer.
- question: the sender asks for information, guidance or clarification and does not deliver work product.
- logistics: scheduling, forwarding, "attached is the doc", administrative coordination. Passing along someone else's email with at most a short cover note is logistics; forwarding the sender's own earlier work to the people it was meant for is a deliverable.
- acknowledgment: thanks, "will do", "noted", one-line confirmations with no substance.
Return JSON only.`;
  const user = `Thread so far:\n${renderThread(input.thread) || "(new thread)"}\n\n${input.openAssignmentTitle ? `The sender currently has an open assignment: "${input.openAssignmentTitle}".\n\n` : ""}Outgoing email (To: ${input.outgoing.to.join(", ")}${input.outgoing.cc.length ? `; Cc: ${input.outgoing.cc.join(", ")}` : ""}${input.outgoing.attachments.length ? `; attachments: ${input.outgoing.attachments.join(", ")}` : ""}):\n${input.outgoing.body.trim() || "(no note)"}${input.outgoing.forwarded ? `\n\n${renderForwarded(input.outgoing.forwarded)}` : ""}`;
  return { system, user, version: INTENT_CLASSIFIER_VERSION };
}
