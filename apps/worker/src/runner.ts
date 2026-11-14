import type { Job } from "@rematter/engine";
import { appendEvent, getPool } from "@rematter/db";
import { getScenario } from "@rematter/scenario";
import { Logger, run, runOnce, type Runner, type TaskList, type JobHelpers } from "graphile-worker";

const quietLogger = new Logger(() => () => {});
import { getProvider, type LlmProvider } from "./llm/index.js";
import { handleJob } from "./jobs/handlers.js";
import { makeContext, type GenerationRecord, type JobOutcome } from "./jobs/types.js";
import { alert, captureException, traceGeneration } from "./telemetry.js";
import { loadSnapshot } from "@rematter/db";

export const SESSION_TASK = "session_job";

interface SessionJobPayload {
  sessionId: string;
  job: Job;
}

/** Runs one planned job for a session and appends the resulting events. */
export async function runSessionJob(payload: SessionJobPayload, opts: { provider?: LlmProvider; attempt?: number; maxAttempts?: number } = {}): Promise<JobOutcome> {
  const pool = getPool();
  const provider = await getProvider(opts.provider);
  const row = (await pool.query<{ id: string; org_id: string; test_mode: boolean; scenario_id: string; scenario_version: string; assessor_shadow_mode: boolean; status: string; archived_at: Date | null; time_zone: string | null }>(
    `select s.id, s.org_id, s.test_mode, s.scenario_id, s.scenario_version, s.status, s.archived_at, s.time_zone, c.assessor_shadow_mode from sessions s join cohorts c on c.id = s.cohort_id where s.id = $1`,
    [payload.sessionId],
  )).rows[0];
  if (!row) throw new Error(`session ${payload.sessionId} not found`);
  // A test checkpoint load replaced this session; its leftover jobs do nothing.
  if (row.archived_at) return { events: [], generations: [] };
  const { pkg, documents } = getScenario(row.scenario_id, row.scenario_version);
  const client = await pool.connect();
  let state;
  try {
    state = (await loadSnapshot(client, row.id, pkg, { zeroDelays: row.test_mode })).state;
  } finally {
    client.release();
  }
  const ctx = makeContext({
    session: { id: row.id, orgId: row.org_id, testMode: row.test_mode, assessorShadowMode: row.assessor_shadow_mode, timeZone: row.time_zone ?? null },
    job: payload.job, state, pkg, documents, provider, pool, now: new Date().toISOString(), attempt: opts.attempt ?? 1,
  });
  const outcome = await handleJob(ctx);
  for (const g of outcome.generations) await recordGeneration(row.id, row.org_id, payload.job.key, g);
  if (outcome.held) {
    await pool.query(
      `insert into held_emails (org_id, session_id, job_key, job_payload, proposed_delivery, violations) values ($1, $2, $3, $4, $5, $6) on conflict (job_key) do nothing`,
      [row.org_id, row.id, outcome.held.jobKey, JSON.stringify(outcome.held.jobPayload), JSON.stringify(outcome.held.proposedDelivery), JSON.stringify(outcome.held.violations)],
    );
  }
  for (const e of outcome.events) await appendEvent(row.id, e.event, "worker", pkg, { idempotencyKey: e.idempotencyKey });
  if (!outcome.held) await appendEvent(row.id, { type: "job_completed", payload: { jobKey: payload.job.key, kind: payload.job.kind } }, "worker", pkg, { idempotencyKey: `${row.id}:done:${payload.job.key}` });
  return outcome;
}

export async function recordGeneration(sessionId: string, orgId: string, jobKey: string | null, g: GenerationRecord): Promise<void> {
  await getPool().query(
    `insert into generations (org_id, session_id, job_key, role, model, provider, prompt_version, input_refs, system_prompt, user_prompt, output, parsed_output, input_tokens, output_tokens, cache_read_tokens, latency_ms, attempt, checker_result)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [orgId, sessionId, jobKey, g.role, g.model, g.provider, g.promptVersion, JSON.stringify(g.inputRefs), g.systemPrompt, g.userPrompt, g.output, g.parsedOutput == null ? null : JSON.stringify(g.parsedOutput), g.usage.inputTokens, g.usage.outputTokens, g.usage.cacheReadTokens, g.latencyMs, g.attempt, g.checkerResult == null ? null : JSON.stringify(g.checkerResult)],
  );
  traceGeneration({ sessionId, jobKey, role: g.role, model: g.model, provider: g.provider, promptVersion: g.promptVersion, latencyMs: g.latencyMs, usage: g.usage, attempt: g.attempt, checkerPass: (g.checkerResult as { pass?: boolean } | undefined)?.pass ?? null, io: { system: g.systemPrompt, user: g.userPrompt, output: g.output } });
}

export function createTaskList(provider?: LlmProvider): TaskList {
  return {
    [SESSION_TASK]: async (raw: unknown, helpers: JobHelpers) => {
      const payload = raw as SessionJobPayload;
      const attempt = helpers.job.attempts;
      const maxAttempts = helpers.job.max_attempts;
      try {
        await runSessionJob(payload, { provider, attempt, maxAttempts });
      } catch (e) {
        captureException(e, { sessionId: payload.sessionId, jobKey: payload.job.key, attempt });
        if (attempt >= maxAttempts) {
          alert("job_failed", { sessionId: payload.sessionId, jobKey: payload.job.key, kind: payload.job.kind, error: (e as Error).message, attempts: attempt });
          try {
            const row = (await getPool().query<{ scenario_id: string; scenario_version: string }>(`select scenario_id, scenario_version from sessions where id = $1`, [payload.sessionId])).rows[0];
            if (row) await appendEvent(payload.sessionId, { type: "job_failed", payload: { jobKey: payload.job.key, kind: payload.job.kind, error: (e as Error).message, attempts: attempt, job: payload.job } }, "worker", getScenario(row.scenario_id, row.scenario_version).pkg, { idempotencyKey: `${payload.sessionId}:failed:${payload.job.key}` });
          } catch (inner) {
            captureException(inner, { sessionId: payload.sessionId, jobKey: payload.job.key, phase: "record_failure" });
          }
        }
        throw e; // graphile-worker retries with exponential backoff until max_attempts
      }
    },
  };
}

/**
 * A job stays locked by whichever worker took it until that worker finishes it. When a worker dies
 * mid-job (a Railway redeploy kills the old container while it waits on a model call),
 * graphile-worker only reclaims the lock after four hours, and because each session's jobs run in
 * one serial queue, that session stalls until then. No job runs anywhere near this long (a model
 * call plus up to two regenerations is well under two minutes), so a lock older than this is
 * from a worker that is gone.
 */
export const STALE_LOCK_MINUTES = 10;

/** Releases jobs (and their session queues) held by workers that died mid-job. Returns how many workers it unlocked. */
export async function unlockStaleJobs(minutes = STALE_LOCK_MINUTES): Promise<number> {
  const pool = getPool();
  const stale = (await pool.query<{ locked_by: string }>(
    `select distinct locked_by from graphile_worker.jobs where locked_by is not null and locked_at < now() - make_interval(mins => $1)`,
    [minutes],
  )).rows.map((r) => r.locked_by);
  if (!stale.length) return 0;
  await pool.query(`select graphile_worker.force_unlock_workers($1::text[])`, [stale]);
  console.log(JSON.stringify({ level: "warn", event: "stale_job_locks_released", workers: stale, olderThanMinutes: minutes }));
  return stale.length;
}

export async function startWorker(opts: { connectionString: string; concurrency?: number; provider?: LlmProvider } ): Promise<Runner> {
  await unlockStaleJobs();
  const sweep = setInterval(() => void unlockStaleJobs().catch((e) => captureException(e, { phase: "unlock_stale_jobs" })), 60_000);
  sweep.unref();
  return run({ connectionString: opts.connectionString, concurrency: opts.concurrency ?? 4, noHandleSignals: false, pollInterval: 500, taskList: createTaskList(opts.provider) });
}

/** Processes every runnable job then returns. Used by the headless harness and tests (delays are zero in test mode). */
export async function drainJobs(opts: { connectionString: string; provider?: LlmProvider }): Promise<void> {
  await runOnce({ connectionString: opts.connectionString, concurrency: 1, taskList: createTaskList(opts.provider), logger: process.env.REMATTER_QUIET === "1" ? quietLogger : undefined });
}

/** Count of jobs still queued for a session (any run_at). */
export async function pendingJobCount(sessionId: string): Promise<number> {
  const r = await getPool().query<{ n: number }>(`select count(*)::int as n from graphile_worker.jobs where queue_name = $1 and attempts < max_attempts`, [`session:${sessionId}`]);
  return r.rows[0]!.n;
}
