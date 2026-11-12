import { loadScenario } from "../load.js";
import { buildAllDocuments, writeBuiltDocuments } from "../documents.js";
import { listScenarioIds, scenarioDir } from "../paths.js";

// With no arguments, builds every bundled scenario's documents.
const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : listScenarioIds().map(scenarioDir);
for (const dir of dirs) {
  const { pkg, dir: abs } = loadScenario(dir);
  const built = buildAllDocuments(abs, pkg.documents);
  const out = writeBuiltDocuments(abs, built);
  for (const b of built)
    console.log(`${b.id}: ${b.anchors.length} anchors, ${b.html.length} bytes html`);
  console.log(`wrote ${built.length} documents to ${out}`);
}
