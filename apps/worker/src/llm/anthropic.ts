import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { MODELS } from "@aporia/prompts";
import { LlmRefusalError, type LlmJsonResult, type LlmProvider, type LlmRequest, type LlmTextResult, type ProviderName } from "./provider.js";

type Client = Pick<Anthropic, "messages">;

/**
 * Anthropic API provider, also used for Bedrock through the Mantle client
 * (same Messages surface). Model IDs come from @aporia/prompts; scenario
 * content sits at the front of the system prompt and is cached.
 */
export class AnthropicProvider implements LlmProvider {
  constructor(readonly name: ProviderName, private readonly client: Client) {}

  static async create(name: "anthropic" | "bedrock"): Promise<AnthropicProvider> {
    if (name === "anthropic") return new AnthropicProvider("anthropic", new Anthropic());
    const { AnthropicBedrockMantle } = await import("@anthropic-ai/bedrock-sdk");
    const region = process.env.AWS_REGION ?? "us-east-1";
    return new AnthropicProvider("bedrock", new AnthropicBedrockMantle({ awsRegion: region }) as unknown as Client);
  }

  private params(req: LlmRequest) {
    const spec = MODELS[req.role];
    const model = this.name === "bedrock" ? spec.bedrock : spec.anthropic;
    const isHaiku = spec.anthropic.includes("haiku");
    const thinking = isHaiku
      ? spec.haikuThinkingBudget
        ? ({ type: "enabled", budget_tokens: spec.haikuThinkingBudget } as const)
        : undefined
      : ({ type: "adaptive" } as const);
    return {
      model,
      max_tokens: spec.maxTokens,
      system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: req.user }],
      ...(thinking ? { thinking } : {}),
      ...(spec.effort && !isHaiku ? { output_config: { effort: spec.effort } } : {}),
    };
  }

  async generateText(req: LlmRequest): Promise<LlmTextResult> {
    const started = Date.now();
    const p = this.params(req);
    const res = await this.client.messages.create(p as Parameters<Anthropic["messages"]["create"]>[0]) as Anthropic.Message;
    if (res.stop_reason === "refusal") throw new LlmRefusalError(req.role, (res as { stop_details?: { category?: string } }).stop_details?.category ?? null);
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    return { text, usage: usage(res), latencyMs: Date.now() - started, model: res.model, provider: this.name, stopReason: res.stop_reason ?? "end_turn" };
  }

  async generateJson<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<LlmJsonResult<T>> {
    const started = Date.now();
    const p = this.params(req);
    const existing = (p as { output_config?: Record<string, unknown> }).output_config ?? {};
    const res = await this.client.messages.parse({
      ...(p as Parameters<Anthropic["messages"]["parse"]>[0]),
      output_config: { ...existing, format: zodOutputFormat(schema as z.ZodType<T>) },
    } as Parameters<Anthropic["messages"]["parse"]>[0]);
    if (res.stop_reason === "refusal") throw new LlmRefusalError(req.role, (res as { stop_details?: { category?: string } }).stop_details?.category ?? null);
    const parsed = (res as { parsed_output?: T | null }).parsed_output;
    if (parsed == null) throw new Error(`Structured output for ${req.role} did not parse`);
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    return { text, parsed, usage: usage(res), latencyMs: Date.now() - started, model: res.model, provider: this.name, stopReason: res.stop_reason ?? "end_turn" };
  }
}

function usage(res: Anthropic.Message) {
  return {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
  };
}
