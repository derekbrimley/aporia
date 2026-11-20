import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { getPool } from "@rematter/db";
import { forkEvents, initialState, step, type EngineEvent, type Job, type SessionState } from "@rematter/engine";
import { FlagJudgeOutputSchema, characterCard, flagJudgePrompt, renderThread } from "@rematter/prompts";
import { ScenarioIndex, getScenario } from "@rematter/scenario";
import { Names, handleJob, makeContext, threadForPrompt, type JobContext, type LlmProvider } from "@rematter/worker";
import { documentsBefore } from "./judge.js";

/**
 * Eval cases made from tester flags. A case is the event log of the flagged session up to the moment
 * the flagged email was written, plus the job that wrote it and what the tester said. Replaying it
 * rebuilds that moment with no database, writes the email again with the current prompts and code,
 * and asks a judge whether the tester's problem comes back.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const CASES_DIR = path.resolve(here, "..", "cases");

export const FlagCaseSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  createdAt: z.string(),
  flag: z.object({ id: z.string(), targetType: z.enum(["message", "thread"]), note: z.string(), raisedAt: z.string() }),
  scenarioId: z.string(),
  scenarioVersion: z.string(),
  testMode: z.boolean(),
  timeZone: z.string().nullable(),
  /** What should happen instead. Starts as the tester's note; edit it to make the judge's job precise. */
  expectation: z.string(),
  /** How many times to write the email again, and how many of those may still have the problem. */
  samples: z.number().int().min(1).default(5),
  maxRepeats: z.number().int().min(0).default(0),
  flagged: z.object({ from: z.string(), kind: z.string(), threadId: z.string(), subject: z.string(), body: z.string(), at: z.string() }),
  job: z.custom<Job>((v) => Boolean(v && typeof v === "object" && "key" in v && "payload" in v)),
  events: z.array(z.custom<EngineEvent>((v) => Boolean(v && typeof v === "object" && "type" in v && "at" in v))),
});
export type FlagCase = z.infer<typeof FlagCaseSchema>;

/** The name the associate goes by in every case, so a tester's name never lands in a case file. */
const CASE_FIRST_NAME = "Sam";

/**
 * Builds an eval case from a flag. A message flag replays that email. A thread flag ("I'm stuck") replays
 * the last character email on that thread before the flag, since that is the email that should have
 * moved things along. Document flags are about scenario content and have nothing to replay.
 */
export async function buildFlagCase(flagId: string): Promise<FlagCase> {
  const pool = getPool();
  const flag = (await pool.query<{ id: string; session_id: string; target_type: string; target_id: string; note: string; created_at: Date }>(
    `select id, session_id, target_type, target_id, note, created_at from flags where id = $1`, [flagId])).rows[0];
  if (!flag) throw new CaseError(`Flag ${flagId} not found`);
  if (flag.target_type !== "message" && flag.target_type !== "thread") throw new CaseError("Only flags on an email or a conversation can become eval cases; document flags are about scenario content.");
  const sess = (await pool.query<{ scenario_id: string; scenario_version: string; test_mode: boolean; time_zone: string | null }>(
    `select scenario_id, scenario_version, test_mode, time_zone from sessions where id = $1`, [flag.session_id])).rows[0];
  if (!sess) throw new CaseError(`Session ${flag.session_id} not found`);
  const rows = (await pool.query<{ type: string; payload: unknown; occurred_at: Date }>(
    `select type, payload, occurred_at from events where session_id = $1 order by seq asc`, [flag.session_id])).rows;
  const events = rows.map((r) => ({ type: r.type, payload: r.payload, at: r.occurred_at.toISOString() }) as EngineEvent);

  // The delivery to replay.
  let deliveryIndex = -1;
  if (flag.target_type === "message") {
    deliveryIndex = events.findIndex((e) => e.type === "message_delivered" && e.payload.messageId === flag.target_id);
  } else {
    const flaggedAt = flag.created_at.toISOString();
    events.forEach((e, i) => {
      if (e.type === "message_delivered" && e.payload.threadId === flag.target_id && e.payload.from !== "associate" && e.at <= flaggedAt) deliveryIndex = i;
    });
  }
  if (deliveryIndex < 0) throw new CaseError(flag.target_type === "message" ? "That email was not written by a character (or was never delivered), so there is nothing to replay." : "No character email on that conversation before the flag.");
  const delivered = events[deliveryIndex] as Extract<EngineEvent, { type: "message_delivered" }>;
  if (!delivered.payload.jobKey) throw new CaseError("That email has no job key (fixed text), so there is nothing to regenerate.");

  const { pkg } = getScenario(sess.scenario_id);
  const opts = { zeroDelays: sess.test_mode };

  // Fresh ids and the stock associate name; times stay where they were so story dates don't move.
  const forked = forkEvents(events, deliveryIndex + 1, { now: delivered.at, newId: () => crypto.randomUUID(), firstName: CASE_FIRST_NAME });
  const prefix = forked.slice(0, deliveryIndex);
  const forkedDelivery = forked[deliveryIndex] as Extract<EngineEvent, { type: "message_delivered" }>;
  // The job is remapped the same way as the events: replay it through the forked prefix to get its new ids.
  let forkedState = initialState(pkg);
  let forkedJob: Job | undefined;
  for (const e of prefix) {
    const res = step(forkedState, e, pkg, opts);
    forkedState = res.state;
    for (const fx of res.effects) if (fx.type === "enqueue_job" && fx.job.key === forkedDelivery.payload.jobKey) forkedJob = fx.job;
  }
  if (!forkedJob) throw new CaseError(`Could not find the job ${delivered.payload.jobKey} that wrote this email.`);
  const fromName = (events.find((e) => e.type === "session_started")?.payload as { associateFirstName?: string } | undefined)?.associateFirstName;
  const rename = (s: string) => (fromName && fromName !== CASE_FIRST_NAME ? s.replace(new RegExp(`\\b${fromName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), CASE_FIRST_NAME) : s);

  const note = rename(flag.note);
  return {
    version: 1,
    id: `${sess.scenario_id}-${flag.created_at.toISOString().slice(0, 10)}-${flag.id.slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    flag: { id: flag.id, targetType: flag.target_type, note, raisedAt: flag.created_at.toISOString() },
    scenarioId: sess.scenario_id,
    scenarioVersion: sess.scenario_version,
    testMode: sess.test_mode,
    timeZone: sess.time_zone,
    expectation: note,
    samples: 5,
    maxRepeats: 0,
    flagged: { from: forkedDelivery.payload.from, kind: forkedDelivery.payload.kind, threadId: forkedDelivery.payload.threadId, subject: forkedDelivery.payload.subject, body: forkedDelivery.payload.body, at: forkedDelivery.at },
    job: forkedJob,
    events: prefix,
  };
}

export class CaseError extends Error {}

/** The session as it stood just before the flagged email, rebuilt from the case's events. */
export function caseState(c: FlagCase): SessionState {
  const { pkg } = getScenario(c.scenarioId);
  let state = initialState(pkg);
  for (const e of c.events) state = step(state, e, pkg, { zeroDelays: c.testMode }).state;
  return state;
}

/** Replay never touches a database: anything that reaches for one is a bug in the replay. */
const NO_DB = new Proxy({}, { get: () => { throw new Error("A case replay has no database"); } }) as JobContext["pool"];

export interface CaseSample { body: string; held: boolean; repeats: boolean; notes: string }
export interface CaseResult { id: string; note: string; pass: boolean; repeats: number; samples: CaseSample[]; warning?: string; error?: string }

/** Writes the flagged email again `samples` times with the current code and prompts, and judges each. */
export async function replayCase(c: FlagCase, provider: LlmProvider, opts: { samples?: number } = {}): Promise<CaseResult> {
  const loaded = getScenario(c.scenarioId);
  const warning = loaded.pkg.meta.version !== c.scenarioVersion ? `case was made on ${c.scenarioId}@${c.scenarioVersion}; replaying on ${loaded.pkg.meta.version}` : undefined;
  const state = caseState(c);
  const n = opts.samples ?? (provider.name === "mock" ? 1 : c.samples);
  const samples: CaseSample[] = [];
  for (let i = 0; i < n; i++) {
    const ctx = makeContext({
      session: { id: crypto.randomUUID(), orgId: crypto.randomUUID(), testMode: c.testMode, assessorShadowMode: false, timeZone: c.timeZone },
      job: c.job, state, pkg: loaded.pkg, documents: loaded.documents, provider, pool: NO_DB, now: c.flagged.at, attempt: 1,
    });
    const out = await handleJob(ctx);
    const delivered = out.events.find((e) => e.event.type === "message_delivered")?.event as Extract<EngineEvent, { type: "message_delivered" }> | undefined;
    const held = out.held ? ((out.held.proposedDelivery as { payload?: { body?: string } }).payload?.body ?? "") : undefined;
    const body = delivered?.payload.body ?? held ?? "";
    const judged = await judgeSample(c, ctx.pkg, state, body, provider);
    samples.push({ body, held: held !== undefined, ...judged });
  }
  const repeats = samples.filter((s) => s.repeats).length;
  return { id: c.id, note: c.flag.note, pass: repeats <= c.maxRepeats, repeats, samples, warning };
}

async function judgeSample(c: FlagCase, pkg: ReturnType<typeof getScenario>["pkg"], state: SessionState, body: string, provider: LlmProvider): Promise<{ repeats: boolean; notes: string }> {
  const idx = new ScenarioIndex(pkg);
  const names = new Names(pkg, state.associateFirstName, c.timeZone);
  const character = idx.characters.get(c.flagged.from);
  const p = flagJudgePrompt({
    dealType: pkg.meta.deal_type,
    characterCard: character ? characterCard(character) : c.flagged.from,
    thread: renderThread(threadForPrompt(state, c.flagged.threadId, names)),
    testerNote: c.flag.note,
    expectation: c.expectation,
    originalEmail: c.flagged.body,
    newEmail: body || "(No email was sent this time: the character stayed silent.)",
    associateDocuments: documentsBefore(state, pkg, "", c.timeZone),
  });
  const res = await provider.generateJson({ role: "flag_judge", system: p.system, user: p.user, promptVersion: p.version }, FlagJudgeOutputSchema);
  return { repeats: res.parsed.repeats_problem, notes: res.parsed.notes };
}

/** Every case file in a directory (default `packages/evals/cases`). */
export function loadCases(dir = CASES_DIR): FlagCase[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => FlagCaseSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))));
}
