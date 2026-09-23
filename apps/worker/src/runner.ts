import type { Job } from "@aporia/engine";
import { appendEvent, getPool } from "@aporia/db";
import { getScenario } from "@aporia/scenario";
import { Logger, run, runOnce, type Runner, type TaskList, type JobHelpers } from "graphile-worker";

const quietLogger = new Logger(() => () => {});
import { getProvider, type LlmProvider } from "./llm/index.js";
import { handleJob } from "./jobs/handlers.js";
import { makeContext, type GenerationRecord, type JobOutcome } from "./jobs/types.js";
import { alert, captureException, traceGeneration } from "./telemetry.js";
import { loadSnapshot } from "@aporia/db";

export const SESSION_TASK = "session_job";

interface SessionJobPayload {
  sessionId: string;
  job: Job;
}

/** Runs one planned job for a session and appends the resulting events. */
export async function runSessionJob(payload: SessionJobPayload, opts: { provider?: LlmProvider; attempt?: number; maxAttempts?: number } = {}): Promise<JobOutcome> {
  const pool = getPool();
  const provider = await getProvider(opts.provider);
  const row = (await pool.query<{ id: string; org_id: string; test_mode: boolean; scenario_id: string; scenario_version: string; assessor_shadow_mode: boolean; status: string }>(
    `select s.id, s.org_id, s.test_mode, s.scenario_id, s.scenario_version, s.status, c.assessor_shadow_mode from sessions s join cohorts c on c.id = s.cohort_id where s.id = $1`,
    [payload.sessionId],
  )).rows[0];
  if (!row) throw new Error(`session ${payload.sessionId} not found`);
  const { pkg, documents } = getScenario(row.scenario_id, row.scenario_version);
  const client = await pool.connect();
  let state;
  try {
    state = (await loadSnapshot(client, row.id, pkg, { zeroDelays: row.test_mode })).state;
  } finally {
    client.release();
  }
  const ctx = makeContext({
    session: { id: row.id, orgId: row.org_id, testMode: row.test_mode, assessorShadowMode: row.assessor_shadow_mode },
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
  traceGeneration({ sessionId, jobKey, role: g.role, model: g.model, provider: g.provider, promptVersion: g.promptVersion, latencyMs: g.latencyMs, usage: g.usage, attempt: g.attempt, checkerPass: (g.checkerResult as { pass?: boolean } | undefined)?.pass ?? null });
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
            if (row) await appendEvent(payload.sessionId, { type: "job_failed", payload: { jobKey: payload.job.key, kind: payload.job.kind, error: (e as Error).message, attempts: attempt } }, "worker", getScenario(row.scenario_id, row.scenario_version).pkg, { idempotencyKey: `${payload.sessionId}:failed:${payload.job.key}` });
          } catch (inner) {
            captureException(inner, { sessionId: payload.sessionId, jobKey: payload.job.key, phase: "record_failure" });
          }
        }
        throw e; // graphile-worker retries with exponential backoff until max_attempts
      }
    },
  };
}

export async function startWorker(opts: { connectionString: string; concurrency?: number; provider?: LlmProvider } ): Promise<Runner> {
  return run({ connectionString: opts.connectionString, concurrency: opts.concurrency ?? 4, noHandleSignals: false, pollInterval: 500, taskList: createTaskList(opts.provider) });
}

/** Processes every runnable job then returns. Used by the headless harness and tests (delays are zero in test mode). */
export async function drainJobs(opts: { connectionString: string; provider?: LlmProvider }): Promise<void> {
  await runOnce({ connectionString: opts.connectionString, concurrency: 1, taskList: createTaskList(opts.provider), logger: process.env.APORIA_QUIET === "1" ? quietLogger : undefined });
}

/** Count of jobs still queued for a session (any run_at). */
export async function pendingJobCount(sessionId: string): Promise<number> {
  const r = await getPool().query<{ n: number }>(`select count(*)::int as n from graphile_worker.jobs where queue_name = $1`, [`session:${sessionId}`]);
  return r.rows[0]!.n;
}
