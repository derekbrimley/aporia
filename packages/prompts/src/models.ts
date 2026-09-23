/**
 * Model configuration. Model IDs are pinned here and only here; prompts never
 * hard-code them. Tiers follow the build spec: Haiku 4.5 for fast checks,
 * Sonnet 5 for characters and reflection, Opus 5.5 for assessment, recap,
 * debrief and the offline judge.
 */
export type LlmRole =
  | "intent_classifier"
  | "assessor"
  | "character_writer"
  | "reflection_engine"
  | "doctrine_assistant"
  | "fact_checker"
  | "recap_debrief"
  | "eval_judge"
  | "bot_associate";

export interface ModelSpec {
  /** Anthropic model ID. */
  anthropic: string;
  /** Bedrock (Mantle) model ID, kept behind the same interface. */
  bedrock: string;
  maxTokens: number;
  /** Effort for adaptive thinking; omitted for Haiku 4.5, which takes a budget instead. */
  effort?: "low" | "medium" | "high";
  /** Extended thinking budget for Haiku 4.5 (must be < maxTokens); undefined = no thinking. */
  haikuThinkingBudget?: number;
}

const HAIKU = "claude-haiku-4-5";
const SONNET = "claude-sonnet-5";
const OPUS = "claude-opus-5-5";

export const MODELS: Record<LlmRole, ModelSpec> = {
  intent_classifier: { anthropic: HAIKU, bedrock: `anthropic.${HAIKU}`, maxTokens: 256 },
  assessor: { anthropic: OPUS, bedrock: `anthropic.${OPUS}`, maxTokens: 4000, effort: "high" },
  character_writer: { anthropic: SONNET, bedrock: `anthropic.${SONNET}`, maxTokens: 1500, effort: "medium" },
  reflection_engine: { anthropic: SONNET, bedrock: `anthropic.${SONNET}`, maxTokens: 1500, effort: "medium" },
  doctrine_assistant: { anthropic: SONNET, bedrock: `anthropic.${SONNET}`, maxTokens: 2000, effort: "medium" },
  fact_checker: { anthropic: HAIKU, bedrock: `anthropic.${HAIKU}`, maxTokens: 1000 },
  recap_debrief: { anthropic: OPUS, bedrock: `anthropic.${OPUS}`, maxTokens: 3000, effort: "high" },
  eval_judge: { anthropic: OPUS, bedrock: `anthropic.${OPUS}`, maxTokens: 2000, effort: "high" },
  bot_associate: { anthropic: SONNET, bedrock: `anthropic.${SONNET}`, maxTokens: 2000, effort: "medium" },
};

export function modelFor(role: LlmRole, provider: "anthropic" | "bedrock" | "mock"): string {
  const spec = MODELS[role];
  return provider === "bedrock" ? spec.bedrock : spec.anthropic;
}
