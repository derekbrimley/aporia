/**
 * Tracing and alerting seams. The pilot stack calls for Langfuse (per-generation
 * traces) and Sentry (errors); both plug in here. Until keys exist, traces go
 * to structured logs so nothing is lost.
 */
export interface GenerationTrace {
  sessionId: string;
  jobKey: string | null;
  role: string;
  model: string;
  provider: string;
  promptVersion: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  attempt: number;
  checkerPass: boolean | null;
}

export function traceGeneration(t: GenerationTrace) {
  if (process.env.APORIA_QUIET === "1") return;
  console.log(JSON.stringify({ level: "info", event: "generation", ...t }));
}

export function alert(kind: "email_held" | "job_failed" | "latency_p95" | "cost_budget" | "refusal", detail: Record<string, unknown>) {
  console.error(JSON.stringify({ level: "error", event: "alert", kind, ...detail }));
}

export function captureException(e: unknown, context: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ level: "error", event: "exception", message: (e as Error)?.message ?? String(e), stack: (e as Error)?.stack, ...context }));
}
