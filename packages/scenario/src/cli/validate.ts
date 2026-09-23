import { loadScenario } from "../load.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: validate <scenario-dir>");
  process.exit(2);
}
try {
  const { pkg, issues } = loadScenario(dir, { strict: false });
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  for (const w of warnings) console.warn(`warning: ${w.message}`);
  for (const e of errors) console.error(`error: ${e.message}`);
  const counts = {
    characters: pkg.characters.length,
    milestones: pkg.milestones.length,
    assignments: pkg.assignments.length,
    issues: pkg.assignments.reduce((n, a) => n + a.issues.length, 0),
    decision_points: pkg.assignments.reduce((n, a) => n + a.decision_points.length, 0),
    deltas: pkg.deltas.length,
    consequences: pkg.consequences.length,
    beats: pkg.beats.length,
    documents: pkg.documents.length,
    facts: Object.keys(pkg.facts).length,
  };
  console.log(`${pkg.meta.id}@${pkg.meta.version} [${pkg.meta.status}]`, JSON.stringify(counts));
  if (errors.length) process.exit(1);
  console.log(`OK: ${errors.length} errors, ${warnings.length} warnings`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
