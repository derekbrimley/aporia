import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, databaseUrl, getDb, getPool, migrate, seedDevData } from "@aporia/db";
import { getScenario, DEFAULT_SCENARIO_ID } from "@aporia/scenario";
import { getProvider, type LlmProvider } from "@aporia/worker";
import { BotAssociate } from "./bot.js";
import { runChecks, type CheckResult } from "./checks.js";
import { judgeSession } from "./judge.js";
import { loadPath } from "./path.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const RUNS_DIR = path.resolve(here, "..", "runs");

export interface RunReport {
  path: string;
  seed: number;
  sessionId: string;
  provider: string;
  startedAt: string;
  durationMs: number;
  status: string;
  milestonesCompleted: string[];
  consequences: Record<string, string>;
  issues: Record<string, string>;
  decisions: Record<string, string>;
  sent: number;
  received: number;
  generations: number;
  costEstimateUsd: number;
  checks: CheckResult[];
  pass: boolean;
  stuck: boolean;
  steps: { at: string; action: string; detail: string }[];
}

/** Rough cost from token counts at list prices; the cost-per-completed-session metric starts here. */
const PRICE: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
  mock: { in: 0, out: 0 },
};

export async function runPlaythrough(opts: { pathName: string; seed?: number; scenarioId?: string; judge?: boolean; provider?: LlmProvider; quiet?: boolean }): Promise<RunReport> {
  const started = Date.now();
  const url = databaseUrl();
  await migrate(url);
  const { pkg } = getScenario(opts.scenarioId ?? DEFAULT_SCENARIO_ID);
  const provider = await getProvider(opts.provider);
  const seed = opts.seed ?? 1;
  const pathFile = loadPath(opts.pathName);
  const seeded = await seedDevData(getDb(), pkg, { slug: `eval-${pathFile.name}-${Date.now()}-${seed}`, testMode: true });
  const bot = new BotAssociate(seeded.sessionId, pkg, pathFile, provider, url, seed);
  if (!opts.quiet) console.log(`[${pathFile.name}#${seed}] session ${seeded.sessionId} provider=${provider.name}`);
  const state = await bot.run();
  let judgeFindings: { leaks: number; breaks: number } | undefined;
  if (opts.judge) {
    const judged = await judgeSession(seeded.sessionId, seeded.orgId, state, pkg, provider);
    judgeFindings = { leaks: judged.filter((j) => j.rating.answer_key_leak).length, breaks: judged.filter((j) => j.rating.fiction_break).length };
  }
  const checks = await runChecks(seeded.sessionId, state, pkg, judgeFindings);
  const gens = await getPool().query<{ model: string; input_tokens: number; output_tokens: number; n: number }>(`select model, sum(input_tokens)::int as input_tokens, sum(output_tokens)::int as output_tokens, count(*)::int as n from generations where session_id = $1 group by model`, [seeded.sessionId]);
  let cost = 0, count = 0;
  for (const g of gens.rows) { const p = PRICE[g.model] ?? { in: 5, out: 25 }; cost += (g.input_tokens * p.in + g.output_tokens * p.out) / 1_000_000; count += g.n; }
  const report: RunReport = {
    path: pathFile.name, seed, sessionId: seeded.sessionId, provider: provider.name, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
    status: state.status, milestonesCompleted: Object.entries(state.milestones).filter(([, m]) => m.completedAt).map(([id]) => id),
    consequences: state.consequences, issues: state.issues, decisions: Object.fromEntries(Object.entries(state.decisions).map(([k, v]) => [k, v.position])),
    sent: bot.log.sent, received: bot.log.received, generations: count, costEstimateUsd: Number(cost.toFixed(4)), checks, pass: checks.every((c) => c.pass), stuck: bot.log.stuck, steps: bot.log.steps,
  };
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const file = path.join(RUNS_DIR, `${report.startedAt.replace(/[:.]/g, "-")}-${pathFile.name}-${seed}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  if (!opts.quiet) {
    for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`);
    console.log(`  ${report.pass ? "RUN PASSED" : "RUN FAILED"} in ${report.durationMs}ms, ${count} generations, est. $${report.costEstimateUsd}; report ${path.relative(process.cwd(), file)}`);
  }
  return report;
}

export async function shutdown() {
  await closeDb();
}
