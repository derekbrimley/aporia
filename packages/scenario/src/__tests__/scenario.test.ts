import { describe, it, expect } from "vitest";
import { loadScenario, ScenarioIndex, sliceFactsFor, scenarioDir, DEFAULT_SCENARIO_ID, buildAllDocuments, listScenarioIds } from "../index.js";

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

describe("every bundled scenario", () => {
  const ids = listScenarioIds();
  it("includes venture debt and the Acme merger", () => {
    expect(ids).toEqual(expect.arrayContaining(["venture-debt-01", "acme-merger-01"]));
  });
  for (const id of ids) {
    it(`${id} validates, builds its documents and has the roles the engine relies on`, () => {
      const { pkg, dir, issues } = loadScenario(scenarioDir(id));
      expect(issues.filter((i) => i.level === "error")).toEqual([]);
      const idx = new ScenarioIndex(pkg);
      expect(idx.character("partner").side).toBe("own_firm");
      expect(idx.character("senior_associate").side).toBe("own_firm");
      expect(buildAllDocuments(dir, pkg.documents).length).toBe(pkg.documents.length);
      expect(Object.keys(pkg.meta.competencies).length).toBeGreaterThan(0);
    });
  }
});

describe("acme-merger-01 package", () => {
  const { pkg } = loadScenario(scenarioDir("acme-merger-01"));
  const idx = new ScenarioIndex(pkg);
  it("keeps Acme's counsel as the only negotiator and BigBank's counsel outside the firm", () => {
    expect(pkg.characters.filter((c) => c.negotiates).map((c) => c.id)).toEqual(["target_counsel"]);
    expect(idx.character("lenders_counsel").side).toBe("third_party");
  });
  it("cites contract sections in the answer key that exist in the data room documents", () => {
    const { dir } = loadScenario(scenarioDir("acme-merger-01"));
    const docs = new Map(buildAllDocuments(dir, pkg.documents).map((d) => [d.id, d]));
    const has = (doc: string, ref: string) => docs.get(doc)!.anchors.some((a) => a.ref === ref);
    expect(has("dr-halvorsen-supply", "Section 14.2")).toBe(true);
    expect(has("dr-unity-gpo", "Section 11.1")).toBe(true);
    expect(has("dr-corvane-license", "Section 9.3")).toBe(true);
    expect(has("dr-durham-lease", "Section 15.2")).toBe(true);
    for (const ref of ["Section 6.3", "Section 6.5", "Section 7.2", "Section 9.1"]) expect(has("merger-agreement", ref)).toBe(true);
  });
});

describe("acme-merger-01 fact availability", () => {
  const { pkg } = loadScenario(scenarioDir("acme-merger-01"));
  const daniel = new ScenarioIndex(pkg).character("senior_associate");

  it("withholds data-room facts until M3", () => {
    const before = Object.keys(sliceFactsFor(daniel, pkg.facts, (m) => m === "M1" || m === "M2"));
    expect(before).not.toContain("cap.series_b_class_vote");
    expect(before).not.toContain("cap.series_b_larchmont_pct");
    expect(before).not.toContain("dates.data_room_open");
    expect(before).toContain("cap.larchmont_voting_pct");
    expect(before).toContain("debt.forbearance");
    const after = Object.keys(sliceFactsFor(daniel, pkg.facts, (m) => ["M1", "M2", "M3"].includes(m)));
    expect(after).toContain("cap.series_b_class_vote");
    // Without milestone information (validation, tests) everything counts as available.
    expect(Object.keys(sliceFactsFor(daniel, pkg.facts))).toContain("cap.series_b_class_vote");
  });

  it("tells characters the forbearance ends early if the signing deadline is missed", () => {
    const f = pkg.facts["debt.forbearance"] as { value: string };
    expect(f.value).toMatch(/earlier if a definitive merger agreement is not signed by the target signing date/);
  });
});
