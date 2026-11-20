import fs from "node:fs";
import path from "node:path";
import { getProvider } from "@rematter/worker";
import { CASES_DIR, CaseError, buildFlagCase, loadCases, replayCase, type CaseResult } from "../cases.js";
import { RUNS_DIR, shutdown } from "../run.js";

/**
 * pnpm evals:cases                 replay every case in packages/evals/cases (or --dir) and judge it
 * pnpm evals:cases --samples 1     fewer samples per case (cheaper)
 * pnpm evals:cases --make <flagId> build a case from a flag in DATABASE_URL and save it to the cases folder
 */
const args = process.argv.slice(2);
const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const dir = path.resolve(get("--dir") ?? CASES_DIR);

if (get("--make")) {
  try {
    const c = await buildFlagCase(get("--make")!);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${c.id}.json`);
    fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
    console.log(`Saved ${path.relative(process.cwd(), file)}. Edit "expectation" to say what should happen instead.`);
  } catch (e) {
    console.error(e instanceof CaseError ? e.message : e);
    process.exitCode = 1;
  }
  await shutdown();
  process.exit();
}

const cases = loadCases(dir);
if (!cases.length) {
  console.log(`No eval cases in ${path.relative(process.cwd(), dir) || dir}.`);
  process.exit(0);
}
const provider = await getProvider();
const samples = get("--samples") ? Number(get("--samples")) : undefined;
const results: CaseResult[] = [];
for (const c of cases) {
  let r: CaseResult;
  try {
    r = await replayCase(c, provider, { samples });
  } catch (e) {
    r = { id: c.id, note: c.flag.note, pass: false, repeats: 0, samples: [], error: (e as Error).message };
  }
  results.push(r);
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id}: "${r.note}"`);
  if (r.warning) console.log(`  note: ${r.warning}`);
  if (r.error) console.log(`  error: ${r.error}`);
  else console.log(`  problem came back in ${r.repeats} of ${r.samples.length} samples (allowed ${c.maxRepeats})`);
  for (const s of r.samples.filter((x) => x.repeats)) console.log(`    - ${s.notes}`);
}
fs.mkdirSync(RUNS_DIR, { recursive: true });
fs.writeFileSync(path.join(RUNS_DIR, `cases-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ provider: provider.name, results }, null, 2));
const passed = results.filter((r) => r.pass).length;
console.log(`\nCases: ${passed}/${results.length} passed.`);
process.exit(passed === results.length ? 0 : 1);
