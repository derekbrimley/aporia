import { loadScenario } from "../load.js";
import { buildAllDocuments, writeBuiltDocuments } from "../documents.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: build-docs <scenario-dir>");
  process.exit(2);
}
const { pkg, dir: abs } = loadScenario(dir);
const built = buildAllDocuments(abs, pkg.documents);
const out = writeBuiltDocuments(abs, built);
for (const b of built) console.log(`${b.id}: ${b.anchors.length} anchors, ${b.html.length} bytes html`);
console.log(`wrote ${built.length} documents to ${out}`);
