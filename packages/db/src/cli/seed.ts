import { loadScenario, scenarioDir, DEFAULT_SCENARIO_ID } from "@aporia/scenario";
import { getDb, closeDb } from "../client.js";
import { seedDevData } from "../seed.js";

const { pkg } = loadScenario(scenarioDir(DEFAULT_SCENARIO_ID));
const r = await seedDevData(getDb(), pkg, { slug: process.env.SEED_SLUG ?? "dev-firm", testMode: process.env.APORIA_TEST_MODE === "1" });
console.log(JSON.stringify(r, null, 2));
console.log("\nSign in locally as associate@dev-firm.example, pd@dev-firm.example or admin@dev-firm.example (magic links print to the web server log).");
await closeDb();
