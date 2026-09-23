import type { Assignment } from "../deps.js";
import { renderThread, type ThreadMessageForPrompt } from "../common.js";

export const BOT_ASSOCIATE_VERSION = "bot_associate@1.0.0";

/** Plays the associate in headless eval runs, following a path file. */
export function botAssociatePrompt(input: {
  persona: string;
  thread: ThreadMessageForPrompt[];
  assignment: Assignment | null;
  raise: string[];
  miss: string[];
  position: string | null;
  rationaleStyle: "none" | "thin" | "full";
  instruction: string;
}) {
  const system = `You play a junior transactional associate working a venture debt deal from an email inbox. Persona: ${input.persona}\nYou write realistic emails in the first person. You never mention being a bot, a test or a simulation. Follow the path instructions exactly: raise the listed issues in substance (in your own words, do not name issue ids) and say nothing about the ones to miss, even if they seem obvious.\nOutput JSON: {"body": the email body, "rationale": the private reasoning you would write on the at-send sheet or null}.`;
  const key = input.assignment
    ? `Assignment: ${input.assignment.title}. Deliverable: ${input.assignment.deliverable}\nIssues to raise (in substance):\n${input.assignment.issues.filter((i) => input.raise.includes(i.id)).map((i) => `- ${i.title}: ${i.raised_looks_like}`).join("\n") || "(none)"}\nIssues to leave out entirely:\n${input.assignment.issues.filter((i) => input.miss.includes(i.id)).map((i) => `- ${i.title}`).join("\n") || "(none)"}\n${input.position ? `Position to take: ${input.assignment.decision_points.flatMap((d) => d.positions).find((p) => p.id === input.position)?.description ?? input.position}` : ""}`
    : "";
  const user = `${input.instruction}\n\n${key}\nRationale style: ${input.rationaleStyle}.\n\nThread:\n${renderThread(input.thread)}`;
  return { system, user, version: BOT_ASSOCIATE_VERSION };
}
