import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  ScenarioPackageSchema,
  ScenarioMetaSchema,
  FactsSchema,
  CharacterSchema,
  MilestoneSchema,
  AssignmentSchema,
  DeltaSchema,
  ConsequenceSchema,
  VerificationPacketSchema,
  NegotiationPointSchema,
  BeatSchema,
  DocumentRegisterSchema,
  type ScenarioPackage,
} from "./schema.js";
import { z } from "zod";
import { crossValidate, type ValidationIssue } from "./validate.js";

function readYaml(file: string): unknown {
  return YAML.parse(fs.readFileSync(file, "utf8"));
}

function parseFile<T>(schema: z.ZodType<T>, file: string, label: string): T {
  const raw = readYaml(file);
  const result = schema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid ${label} (${path.relative(process.cwd(), file)}):\n${lines.join("\n")}`);
  }
  return result.data;
}

export interface LoadOptions {
  /** Throw on cross-reference problems (default true). */
  strict?: boolean;
}

export interface LoadedScenario {
  pkg: ScenarioPackage;
  dir: string;
  issues: ValidationIssue[];
}

/** Loads and validates a scenario package directory. */
export function loadScenario(dir: string, opts: LoadOptions = {}): LoadedScenario {
  const abs = path.resolve(dir);
  const f = (name: string) => path.join(abs, name);
  const meta = parseFile(ScenarioMetaSchema, f("scenario.yaml"), "scenario.yaml");
  const facts = parseFile(FactsSchema, f("facts.yaml"), "facts.yaml");
  const charDir = f("characters");
  const characters = fs
    .readdirSync(charDir)
    .filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"))
    .sort()
    .map((n) => parseFile(CharacterSchema, path.join(charDir, n), `characters/${n}`));
  const milestones = parseFile(z.array(MilestoneSchema), f("milestones.yaml"), "milestones.yaml");
  const assignments = parseFile(z.array(AssignmentSchema), f("assignments.yaml"), "assignments.yaml");
  const deltas = parseFile(z.array(DeltaSchema), f("deltas.yaml"), "deltas.yaml");
  const consequences = parseFile(z.array(ConsequenceSchema), f("consequences.yaml"), "consequences.yaml");
  const verification = parseFile(z.array(VerificationPacketSchema), f("verification.yaml"), "verification.yaml");
  const negotiation = parseFile(z.array(NegotiationPointSchema), f("negotiation.yaml"), "negotiation.yaml");
  const beats = parseFile(z.array(BeatSchema), f("beats.yaml"), "beats.yaml");
  const documents = parseFile(DocumentRegisterSchema, f("documents/register.yaml"), "documents/register.yaml");

  const pkg = ScenarioPackageSchema.parse({
    meta, facts, characters, milestones, assignments, deltas, consequences, verification, negotiation, beats, documents,
  });
  const issues = crossValidate(pkg, abs);
  const errors = issues.filter((i) => i.level === "error");
  if ((opts.strict ?? true) && errors.length > 0) {
    throw new Error(
      `Scenario ${meta.id}@${meta.version} failed validation:\n` + errors.map((e) => `  - ${e.message}`).join("\n"),
    );
  }
  return { pkg, dir: abs, issues };
}
