/**
 * Tracing and alerting. Every generation and exception goes to structured logs;
 * Langfuse (per-generation traces) and Sentry (errors) are added on top when
 * their keys are set. Call initTelemetry() once at process start and
 * shutdownTelemetry() before exit so buffered traces are flushed.
 */
import * as Sentry from "@sentry/node";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  propagateAttributes,
  setLangfuseTracerProvider,
  startObservation,
} from "@langfuse/tracing";

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
  /** Prompt and completion; sent to Langfuse only, never to logs. */
  io?: { system: string; user: string; output: string };
}

let langfuse: NodeTracerProvider | null = null;
let sentry = false;

export function initTelemetry(): void {
  const environment = process.env.APORIA_ENV ?? "development";
  if (process.env.SENTRY_DSN && !sentry) {
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment, tracesSampleRate: 0 });
    sentry = true;
  }
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY && !langfuse) {
    // Isolated provider: Langfuse spans never mix with any global OpenTelemetry setup.
    langfuse = new NodeTracerProvider({
      spanProcessors: [new LangfuseSpanProcessor({ environment })],
    });
    setLangfuseTracerProvider(langfuse);
  }
}

export async function shutdownTelemetry(): Promise<void> {
  await Promise.allSettled([langfuse?.shutdown(), sentry ? Sentry.close(2000) : undefined]);
}

export function traceGeneration(t: GenerationTrace) {
  const { io, ...meta } = t;
  if (process.env.APORIA_QUIET !== "1")
    console.log(JSON.stringify({ level: "info", event: "generation", ...meta }));
  if (!langfuse) return;
  const end = new Date();
  propagateAttributes({ sessionId: t.sessionId, traceName: t.role }, () => {
    startObservation(
      t.role,
      {
        model: t.model,
        version: t.promptVersion,
        input: io
          ? [
              { role: "system", content: io.system },
              { role: "user", content: io.user },
            ]
          : undefined,
        output: io?.output,
        usageDetails: {
          input: t.usage.inputTokens,
          output: t.usage.outputTokens,
          cache_read_input_tokens: t.usage.cacheReadTokens,
        },
        metadata: {
          jobKey: t.jobKey,
          provider: t.provider,
          attempt: t.attempt,
          checkerPass: t.checkerPass,
        },
        level: t.checkerPass === false ? "WARNING" : "DEFAULT",
      },
      { asType: "generation", startTime: new Date(end.getTime() - t.latencyMs) },
    ).end(end);
  });
}

export function alert(
  kind: "email_held" | "job_failed" | "latency_p95" | "cost_budget" | "refusal",
  detail: Record<string, unknown>,
) {
  console.error(JSON.stringify({ level: "error", event: "alert", kind, ...detail }));
  if (sentry)
    Sentry.captureMessage(`alert: ${kind}`, {
      level: "error",
      tags: { alert: kind },
      extra: detail,
    });
}

export function captureException(e: unknown, context: Record<string, unknown> = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      event: "exception",
      message: (e as Error)?.message ?? String(e),
      stack: (e as Error)?.stack,
      ...context,
    }),
  );
  if (sentry) Sentry.captureException(e, { extra: context });
}
