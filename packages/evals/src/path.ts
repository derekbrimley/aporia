import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { z } from "zod";

export const PathSchema = z.object({
  name: z.string(),
  description: z.string(),
  persona: z.string(),
  rationale_style: z.enum(["none", "thin", "full"]),
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
