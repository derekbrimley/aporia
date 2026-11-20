import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { z } from "zod";

export const PathSchema = z.object({
  name: z.string(),
  description: z.string(),
  persona: z.string(),
  /** How much of the why the bot puts in its deliverables. */
  reasoning_style: z.enum(["none", "thin", "full"]),
  raise_rate: z.object({ expected: z.number().min(0).max(1), strong: z.number().min(0).max(1), expert: z.number().min(0).max(1) }),
  positions: z.record(z.string(), z.string()).default({}),
  /** Force specific issues regardless of rate. */
  force_raise: z.array(z.string()).default([]),
  force_miss: z.array(z.string()).default([]),
  behaviors: z.object({
    asks_for_answer: z.boolean().default(false),
    doctrine_questions: z.number().int().min(0).default(0),
    off_script: z.boolean().default(false),
    gap_days: z.number().int().min(0).default(0),
    /** After answering a reflection, keep writing on that private thread this many more times (session 6772ce0f). */
    reflection_followups: z.number().int().min(0).default(0),
    /** Ask the senior this many times where to look before sending each deliverable, as a stuck associate does. */
    stuck_questions: z.number().int().min(0).default(0),
    /** Send a second short email right behind a question, before anyone has answered (the double-reply case). */
    quick_followup: z.boolean().default(false),
    /** When work is due outside the firm, first send the draft to the senior on an older thread (session 259601d4). */
    draft_to_senior_first: z.boolean().default(false),
  }),
});
export type PathFile = z.infer<typeof PathSchema>;

const here = path.dirname(fileURLToPath(import.meta.url));
export const PATHS_DIR = path.join(here, "paths");

export function loadPath(nameOrFile: string): PathFile {
  const file = fs.existsSync(nameOrFile) ? nameOrFile : path.join(PATHS_DIR, `${nameOrFile}.yaml`);
  return PathSchema.parse(YAML.parse(fs.readFileSync(file, "utf8")));
}

export function listPaths(): string[] {
  return fs.readdirSync(PATHS_DIR).filter((f) => f.endsWith(".yaml")).map((f) => f.replace(/\.yaml$/, ""));
}
