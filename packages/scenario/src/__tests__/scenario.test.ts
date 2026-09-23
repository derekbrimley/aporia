import { describe, it, expect } from "vitest";
import { loadScenario, ScenarioIndex, sliceFactsFor, scenarioDir, DEFAULT_SCENARIO_ID, buildAllDocuments } from "../index.js";

describe("venture-debt-01 package", () => {
  const { pkg, dir, issues } = loadScenario(scenarioDir(DEFAULT_SCENARIO_ID));
  const idx = new ScenarioIndex(pkg);

  it("validates with no errors", () => {
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });
  it("has eight milestones in order and one doctrine assistant", () => {
    expect(idx.milestonesInOrder.map((m) => m.id)).toEqual(["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"]);
    expect(idx.doctrineAssistant.id).toBe("practice_support");
  });
  it("gives characters only their slice of the facts", () => {
    const lender = idx.character("lenders_counsel");
    const slice = sliceFactsFor(lender, pkg.facts);
    expect(Object.keys(slice)).not.toContain("client.financials.monthly_burn");
    const client = idx.character("client_contact");
    expect(Object.keys(sliceFactsFor(client, pkg.facts))).toContain("client.financials.monthly_burn");
    expect(Object.keys(sliceFactsFor(idx.doctrineAssistant, pkg.facts))).toEqual([]);
  });
  it("every assignment maps to at least one competency and every consequence seed resolves", () => {
    for (const a of pkg.assignments) expect(a.competencies.length).toBeGreaterThan(0);
    for (const c of pkg.consequences) {
      if ("issue" in c.seed) expect(idx.issues.has(c.seed.issue)).toBe(true);
      else expect(idx.decisionPoints.has(c.seed.decision_point)).toBe(true);
    }
  });
  it("builds every registered document with anchors", () => {
    const built = buildAllDocuments(dir, pkg.documents);
    expect(built.length).toBe(pkg.documents.length);
    for (const b of built) expect(b.anchors.length).toBeGreaterThan(1);
  });
});
