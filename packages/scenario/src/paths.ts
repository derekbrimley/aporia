import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Absolute path to the bundled scenarios directory. */
export const SCENARIOS_DIR = path.resolve(here, "..", "scenarios");
export function scenarioDir(id: string): string {
  return path.join(SCENARIOS_DIR, id);
}
export const DEFAULT_SCENARIO_ID = "venture-debt-01";

import { loadScenario, type LoadedScenario } from "./load.js";
import { loadBuiltDocuments } from "./documents.js";
import type { BuiltDocument } from "./schema.js";

const cache = new Map<string, LoadedScenario & { documents: Map<string, BuiltDocument> }>();

/** Loads (once per process) the scenario a session is pinned to, refusing a version mismatch. */
export function getScenario(id: string, version?: string): LoadedScenario & { documents: Map<string, BuiltDocument> } {
  let loaded = cache.get(id);
  if (!loaded) {
    const base = loadScenario(scenarioDir(id));
    loaded = { ...base, documents: loadBuiltDocuments(base.dir, base.pkg.documents) };
    cache.set(id, loaded);
  }
  if (version && loaded.pkg.meta.version !== version) {
    throw new Error(`Scenario ${id} is at ${loaded.pkg.meta.version} but the session is pinned to ${version}. Deploy the pinned version or migrate the session.`);
  }
  return loaded;
}
