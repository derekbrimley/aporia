import type { Beat, Character, Facts } from "@aporia/scenario";
import { sliceFactsFor } from "@aporia/scenario";
import { checkDraft } from "../factcheck/index.js";
import { derivedUuid } from "../ids.js";
import type { LlmProvider, LlmTextResult } from "../llm/provider.js";
import { alert } from "../telemetry.js";
import type { GenerationRecord, JobContext, JobOutcome } from "./types.js";

export interface DeliverySpec {
  from: Character;
  to: string[];
  cc: string[];
  threadId: string;
  threadKey: string | null;
  subject: string;
  attachments: string[];
  kind: "beat" | "reply" | "reflection" | "interruption" | "recap" | "debrief" | "doctrine";
  beatId?: string | null;
  inReplyTo?: string | null;
  reflectionQuestions?: string[];
}

export interface GenerateArgs {
  role: "character_writer" | "reflection_engine" | "recap_debrief" | "doctrine_assistant";
  build: (feedback: string[]) => { system: string; user: string; version: string; mockContext?: Record<string, unknown> };
  /** Extract the email body (and optional questions) from the raw result. */
  parse: (res: LlmTextResult) => { body: string; reflectionQuestions?: string[]; parsed?: unknown };
  /** Skip the fact checker (fixed text, doctrine answers). */
  check: "full" | "rules_only" | "none";
  answerKeyHints: string[];
  isSocratic: boolean;
  /** Facts the checker treats as known in addition to the character's slice (must_include_facts). */
  extraFacts?: Facts;
  inputRefs: Record<string, unknown>;
}

const MAX_REGENERATIONS = 2;

/**
 * Generates a character email, runs the fact checker, regenerates with the
 * violations as feedback up to two times, then delivers or holds.
 */
export async function generateAndDeliver(ctx: JobContext, spec: DeliverySpec, gen: GenerateArgs): Promise<JobOutcome> {
  const generations: GenerationRecord[] = [];
  const slice = { ...sliceFactsFor(spec.from, ctx.pkg.facts), ...(gen.extraFacts ?? {}) };
  let feedback: string[] = [];
  let lastBody = "";
  let lastQuestions: string[] | undefined;
  let lastViolations: unknown = null;
  for (let attempt = 1; attempt <= MAX_REGENERATIONS + 1; attempt++) {
    const p = gen.build(feedback);
    const res = await ctx.provider.generateText({ role: gen.role, system: p.system, user: p.user, promptVersion: p.version, mockContext: p.mockContext, sessionId: ctx.session.id, jobKey: ctx.job.key });
    const parsed = gen.parse(res);
    lastBody = parsed.body.trim();
    lastQuestions = parsed.reflectionQuestions;
    let checker: unknown = null;
    let pass = true;
    if (gen.check !== "none" && lastBody) {
      const result = gen.check === "full"
        ? await checkDraft({ draft: lastBody, character: spec.from, slice, allFacts: ctx.pkg.facts, answerKeyHints: gen.answerKeyHints, isSocratic: gen.isSocratic, provider: ctx.provider, sessionId: ctx.session.id, jobKey: ctx.job.key })
        : rulesOnly(lastBody, spec.from, slice, ctx.pkg.facts);
      pass = result.pass;
      checker = { pass: result.pass, violations: result.violations, layers: result.layers };
      if (result.generation) {
        generations.push({ role: "fact_checker", model: result.generation.model, provider: ctx.provider.name, promptVersion: result.generation.promptVersion, inputRefs: { jobKey: ctx.job.key, attempt }, systemPrompt: result.generation.system, userPrompt: result.generation.user, output: result.generation.output, usage: result.generation.usage, latencyMs: result.generation.latencyMs, attempt, checkerResult: checker });
      }
      feedback = result.violations.map((v) => `${v.kind}: ${v.detail}`);
      lastViolations = result.violations;
    }
    generations.push({ role: gen.role, model: res.model, provider: res.provider, promptVersion: p.version, inputRefs: gen.inputRefs, systemPrompt: p.system, userPrompt: p.user, output: res.text, parsedOutput: parsed.parsed, usage: res.usage, latencyMs: res.latencyMs, attempt, checkerResult: checker });
    if (pass && lastBody) return { events: [deliveryEvent(ctx, spec, lastBody, lastQuestions)], generations };
    if (!lastBody) feedback = ["The draft was empty."];
  }
  // Still failing: hold for human review. The associate just sees a reply that hasn't arrived yet.
  const proposed = deliveryEvent(ctx, spec, lastBody, lastQuestions);
  alert("email_held", { sessionId: ctx.session.id, jobKey: ctx.job.key, violations: lastViolations });
  return {
    events: [{ event: { type: "message_held", payload: { jobKey: ctx.job.key, reason: JSON.stringify(lastViolations), kind: spec.kind } }, idempotencyKey: `${ctx.session.id}:held:${ctx.job.key}` }],
    generations,
    held: { jobKey: ctx.job.key, jobPayload: ctx.job, proposedDelivery: proposed.event, violations: lastViolations },
  };
}

/** Delivers fixed (attorney-reviewed) text with the rules layer only. */
export function deliverFixed(ctx: JobContext, spec: DeliverySpec, body: string): JobOutcome {
  return { events: [deliveryEvent(ctx, spec, body.trim())], generations: [] };
}

export function deliveryEvent(ctx: JobContext, spec: DeliverySpec, body: string, reflectionQuestions?: string[]) {
  const messageId = derivedUuid(ctx.session.id, "message", ctx.job.key);
  return {
    event: {
      type: "message_delivered" as const,
      payload: {
        messageId, threadId: spec.threadId, threadKey: spec.threadKey, beatId: spec.beatId ?? null, kind: spec.kind, from: spec.from.id,
        to: spec.to, cc: spec.cc, subject: spec.subject, body, attachments: spec.attachments, inReplyTo: spec.inReplyTo ?? null,
        reflectionQuestions: reflectionQuestions ?? spec.reflectionQuestions ?? [], jobKey: ctx.job.key,
      },
    },
    idempotencyKey: `${ctx.session.id}:deliver:${ctx.job.key}`,
  };
}

function rulesOnly(draft: string, character: Character, slice: Facts, all: Facts) {
  const { ruleCheck } = require("../factcheck/rules.js") as typeof import("../factcheck/rules.js");
  const v = ruleCheck(draft, slice, all);
  return { pass: v.length === 0, violations: v, layers: { rules: v, model: null }, generation: undefined };
}

export function threadIdForKey(ctx: JobContext, key: string): string {
  return ctx.state.threadIdByKey[key] ?? derivedUuid(ctx.session.id, "thread", key);
}

export function resolveRecipients(list: (string | "associate")[]): string[] {
  return list;
}

export function beatSubject(ctx: JobContext, beat: Beat, threadId: string): string {
  const existing = ctx.state.threads[threadId]?.subject;
  if (existing) return existing;
  return beat.subject ?? beat.title;
}

export { sliceFactsFor };
export type { LlmProvider };
