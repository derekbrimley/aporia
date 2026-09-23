import { databaseUrl, loadEnv, migrate } from "@aporia/db";

loadEnv();
import { startWorker } from "./runner.js";

const url = databaseUrl();
if (process.env.RUN_MIGRATIONS_ON_START === "1") await migrate(url);
const runner = await startWorker({ connectionString: url, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) });
console.log(JSON.stringify({ level: "info", event: "worker_started", provider: process.env.LLM_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock") }));
await runner.promise;
