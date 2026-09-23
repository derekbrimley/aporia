import type { z } from "zod";
import type { LlmRole } from "@aporia/prompts";

export type ProviderName = "anthropic" | "bedrock" | "mock";

export interface LlmRequest {
  role: LlmRole;
  system: string;
  user: string;
  promptVersion: string;
  /** Structured context the mock provider uses to produce deterministic, meaningful output. Real providers ignore it. */
  mockContext?: Record<string, unknown>;
  /** Trace correlation. */
  sessionId?: string;
  jobKey?: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface LlmTextResult {
  text: string;
  usage: LlmUsage;
  latencyMs: number;
  model: string;
  provider: ProviderName;
  stopReason: string;
}

export interface LlmJsonResult<T> extends LlmTextResult {
  parsed: T;
}

export interface LlmProvider {
  readonly name: ProviderName;
  generateText(req: LlmRequest): Promise<LlmTextResult>;
  generateJson<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<LlmJsonResult<T>>;
}

export class LlmRefusalError extends Error {
  constructor(public readonly role: LlmRole, public readonly category: string | null) {
    super(`LLM refused ${role} request${category ? ` (${category})` : ""}`);
  }
}
