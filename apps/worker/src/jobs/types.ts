import type pg from "pg";
import type { EngineEvent, Job, SessionState } from "@aporia/engine";
import type { BuiltDocument, Facts, ScenarioPackage } from "@aporia/scenario";
import { ScenarioIndex } from "@aporia/scenario";
import type { LlmProvider } from "../llm/provider.js";
import { Names } from "../context.js";

export interface SessionInfo {
  id: string;
  orgId: string;
  testMode: boolean;
  assessorShadowMode: boolean;
}

export interface JobContext {
  session: SessionInfo;
  job: Job;
  state: SessionState;
  pkg: ScenarioPackage;
  idx: ScenarioIndex;
  documents: Map<string, BuiltDocument>;
  provider: LlmProvider;
  names: Names;
  pool: pg.Pool;
  /** Wall clock at job start (ISO). */
  now: string;
  attempt: number;
}

export interface GenerationRecord {
  role: string;
  model: string;
  provider: string;
  promptVersion: string;
  inputRefs: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  output: string;
  parsedOutput?: unknown;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  latencyMs: number;
  attempt: number;
  checkerResult?: unknown;
}

export interface PendingEvent {
  event: Omit<EngineEvent, "at">;
  idempotencyKey: string;
}

export interface HeldRecord {
  jobKey: string;
  jobPayload: unknown;
  proposedDelivery: unknown;
  violations: unknown;
}

export interface JobOutcome {
  events: PendingEvent[];
  generations: GenerationRecord[];
  held?: HeldRecord;
}

export function makeContext(base: Omit<JobContext, "idx" | "names">): JobContext {
  return { ...base, idx: new ScenarioIndex(base.pkg), names: new Names(base.pkg, base.state.associateFirstName) };
}

export type { Facts };
