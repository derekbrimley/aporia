import { FactCheckOutputSchema, factCheckerPrompt } from "@aporia/prompts";
import type { Character, Facts } from "@aporia/scenario";
import type { LlmProvider } from "../llm/provider.js";
import { ruleCheck, type Violation } from "./rules.js";

export interface CheckResult {
  pass: boolean;
  violations: Violation[];
  layers: { rules: Violation[]; model: Violation[] | null };
  generation?: { system: string; user: string; output: string; model: string; latencyMs: number; usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number }; promptVersion: string };
}

/**
 * Two layers: deterministic rules first (any mismatch fails and the model
 * layer is skipped), then a model check for slice contradictions, answer-key
 * leaks and fiction breaks.
 */
export async function checkDraft(args: {
  draft: string;
  character: Character;
  slice: Facts;
  allFacts: Facts;
  answerKeyHints: string[];
  isSocratic: boolean;
  provider: LlmProvider;
  sessionId?: string;
  jobKey?: string;
}): Promise<CheckResult> {
  const rules = ruleCheck(args.draft, args.slice, args.allFacts);
  if (rules.length) return { pass: false, violations: rules, layers: { rules, model: null } };
  const p = factCheckerPrompt({ character: args.character, slice: args.slice, draft: args.draft, answerKeyHints: args.answerKeyHints, isSocratic: args.isSocratic });
  const res = await args.provider.generateJson({ role: "fact_checker", system: p.system, user: p.user, promptVersion: p.version, sessionId: args.sessionId, jobKey: args.jobKey }, FactCheckOutputSchema);
  const model: Violation[] = res.parsed.violations.map((v) => ({ kind: v.kind, detail: v.detail }));
  return {
    pass: res.parsed.pass && model.length === 0,
    violations: model,
    layers: { rules, model },
    generation: { system: p.system, user: p.user, output: res.text, model: res.model, latencyMs: res.latencyMs, usage: res.usage, promptVersion: p.version },
  };
}

export { ruleCheck, type Violation } from "./rules.js";
