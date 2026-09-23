import type { Character, Consequence, Facts, Milestone } from "../deps.js";
import { CHARACTER_HARD_RULES, characterCard, factsBlock } from "../common.js";

export const RECAP_VERSION = "recap@1.0.0";
export const DEBRIEF_VERSION = "debrief@1.0.0";

export function recapPrompt(input: { character: Character; facts: Facts; associateFirstName: string; gapDays: number; milestone: Milestone; openItems: string[]; recentSubjects: string[]; storyDate: string }) {
  const system = `${characterCard(input.character)}\n\n${CHARACTER_HARD_RULES}\n\n${factsBlock(input.facts)}\n\nYou write a short re-entry note to ${input.associateFirstName}, who has been away from the deal for a few days. It recaps where things stand and what is outstanding. It changes nothing in the deal and adds no pressure or new asks. Under 120 words.`;
  const user = `Today is ${input.storyDate}. ${input.associateFirstName} has been away ${input.gapDays} days.\nCurrent phase: ${input.milestone.title}. ${input.milestone.recap_hint ?? input.milestone.summary}\nOpen items: ${input.openItems.join("; ") || "none"}.\nRecent threads: ${input.recentSubjects.join("; ")}.\n\nWrite only the body of the email.`;
  return { system, user, version: RECAP_VERSION };
}

export function debriefPrompt(input: {
  character: Character;
  facts: Facts;
  associateFirstName: string;
  fired: { consequence: Consequence; seedDescription: string; rationale: string | null }[];
  notFiredPositive: { consequence: Consequence; seedDescription: string }[];
  decisions: { title: string; position: string; rationale: string | null }[];
  storyDate: string;
}) {
  const system = `${characterCard(input.character)}\n\n${CHARACTER_HARD_RULES}\n\n${factsBlock(input.facts)}\n\nThe deal has closed. You write the closing debrief to ${input.associateFirstName}: a walkthrough of a few decisions that mattered and how each one played out in the deal, drawing on what actually happened. You describe consequences as events in the deal, not as lessons. You quote or paraphrase the associate's own reasoning where you have it. You end by asking them to reflect on one or two things. No scores, no grades, no ranking, no praise inflation. 250 to 400 words.`;
  const user = `Today is ${input.storyDate}.\n\nWhat played out (reference at least two):\n${input.fired.map((f) => `- ${f.consequence.title}: seeded when ${f.seedDescription}. How it appeared: ${f.consequence.how_it_appears}${f.rationale ? ` The associate's reasoning at the time: "${f.rationale}"` : ""}`).join("\n") || "(no consequences fired)"}\n\nThings that went well because of early calls:\n${input.notFiredPositive.map((f) => `- ${f.consequence.title}: ${f.seedDescription}`).join("\n") || "(none recorded)"}\n\nDecisions the associate took:\n${input.decisions.map((d) => `- ${d.title}: ${d.position}${d.rationale ? ` ("${d.rationale}")` : ""}`).join("\n") || "(none)"}\n\nWrite only the body of the email.`;
  return { system, user, version: DEBRIEF_VERSION };
}
