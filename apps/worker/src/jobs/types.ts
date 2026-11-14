import type pg from "pg";
import type { EngineEvent, Job, SessionState } from "@rematter/engine";
import type { BuiltDocument, Facts, ScenarioPackage } from "@rematter/scenario";
import { ScenarioIndex, dateAnchor, forSession, sliceFactsFor, type Character } from "@rematter/scenario";
import type { LlmProvider } from "../llm/provider.js";
import { Names } from "../context.js";

export interface SessionInfo {
  id: string;
  orgId: string;
  testMode: boolean;
  assessorShadowMode: boolean;
  /** The associate's IANA time zone, from their browser when the session started; null on older sessions (UTC). */
  timeZone: string | null;
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

/** Every job sees the scenario as its session does: dates follow the session's start (see scenario dates.ts). */
export function makeContext(base: Omit<JobContext, "idx" | "names">): JobContext {
  const { pkg, documents } = forSession(base.pkg, base.documents, dateAnchor(base.state), base.session.timeZone);
  return { ...base, pkg, documents, idx: new ScenarioIndex(pkg), names: new Names(pkg, base.state.associateFirstName, base.session.timeZone) };
}

/** A character's facts at this point in the session: facts with a later `available_from` milestone are withheld. */
export function factsFor(ctx: Pick<JobContext, "pkg" | "state">, character: Character): Facts {
  return sliceFactsFor(character, ctx.pkg.facts, (m) => Boolean(ctx.state.milestones[m]?.enteredAt));
}

export type { Facts };
