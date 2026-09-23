import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Absolute path to the bundled scenarios directory. */
export const SCENARIOS_DIR = path.resolve(here, "..", "scenarios");
export function scenarioDir(id: string): string {
  return path.join(SCENARIOS_DIR, id);
}
export const DEFAULT_SCENARIO_ID = "venture-debt-01";
