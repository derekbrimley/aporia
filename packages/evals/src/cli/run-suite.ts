import fs from "node:fs";
import path from "node:path";
import { RUNS_DIR, runPlaythrough, shutdown, type RunReport } from "../run.js";

const args = process.argv.slice(2);
const get = (flag: string, def: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1]! : def; };
const paths = get("--paths", "mixed").split(",");
const runs = Number(get("--runs", "1"));
const judge = args.includes("--judge");
const reports: RunReport[] = [];
for (const p of paths) for (let seed = 1; seed <= runs; seed++) reports.push(await runPlaythrough({ pathName: p, seed, judge }));
const passed = reports.filter((r) => r.pass && !r.stuck).length;
const summary = {
  at: new Date().toISOString(), total: reports.length, passed, failed: reports.length - passed,
  costPerCompletedSessionUsd: Number((reports.filter((r) => r.status === "completed").reduce((s, r) => s + r.costEstimateUsd, 0) / Math.max(1, reports.filter((r) => r.status === "completed").length)).toFixed(4)),
  byPath: Object.fromEntries(paths.map((p) => [p, reports.filter((r) => r.path === p).map((r) => ({ seed: r.seed, pass: r.pass && !r.stuck, status: r.status, failedChecks: r.checks.filter((c) => !c.pass).map((c) => c.name) }))])),
};
fs.writeFileSync(path.join(RUNS_DIR, "latest-summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nSuite: ${passed}/${reports.length} runs passed. Cost per completed session (est.): $${summary.costPerCompletedSessionUsd}`);
for (const [p, rs] of Object.entries(summary.byPath)) for (const r of rs) if (!r.pass) console.log(`  FAIL ${p}#${r.seed} status=${r.status} checks=${r.failedChecks.join(",")}`);
await shutdown();
process.exit(passed === reports.length ? 0 : 1);
