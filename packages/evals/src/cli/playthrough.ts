import { runPlaythrough, shutdown } from "../run.js";

const args = process.argv.slice(2);
const get = (flag: string, def: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1]! : def; };
const scenarioId = args.includes("--scenario") ? get("--scenario", "") : undefined;
const report = await runPlaythrough({ pathName: get("--path", "mixed"), seed: Number(get("--seed", "1")), scenarioId, judge: args.includes("--judge") });
await shutdown();
process.exit(report.pass && !report.stuck ? 0 : 1);
