import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import type { LlmProvider, ProviderName } from "./provider.js";

export * from "./provider.js";
export { MockProvider } from "./mock.js";
export { AnthropicProvider } from "./anthropic.js";

let cached: LlmProvider | undefined;

/** Provider from LLM_PROVIDER (mock | anthropic | bedrock). Defaults to mock when no key is present. */
export async function getProvider(override?: LlmProvider): Promise<LlmProvider> {
  if (override) return override;
  if (cached) return cached;
  const name = (process.env.LLM_PROVIDER as ProviderName | undefined) ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock");
  cached = name === "mock" ? new MockProvider() : await AnthropicProvider.create(name);
  return cached;
}

export function setProvider(p: LlmProvider | undefined) {
  cached = p;
}
