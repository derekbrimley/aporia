import { describe, it, expect } from "vitest";
import { loadScenario, ScenarioIndex, sliceFactsFor, scenarioDir, DEFAULT_SCENARIO_ID, buildAllDocuments, listScenarioIds, formatFact, partitionFactsBySource } from "../index.js";

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

describe("acme-merger-01 fact sources", () => {
  const { pkg, dir } = loadScenario(scenarioDir("acme-merger-01"));
  const docs = new Map(buildAllDocuments(dir, pkg.documents).map((d) => [d.id, d]));
  const idx = new ScenarioIndex(pkg);
  const releasedBy = (beatId: string) => {
    const out = new Set<string>();
    for (const b of pkg.beats) {
      for (const d of b.attachments) out.add(d);
      if (b.id === beatId) break;
    }
    return out;
  };

  it("puts BigBank's liquidation estimate in the term sheet Grace sends at M2", () => {
    expect(pkg.facts["debt.liquidation_recovery"]!.source).toEqual(["bigbank-term-sheet"]);
    expect(releasedBy("B-M2-loi").has("bigbank-term-sheet")).toBe(true);
    expect(docs.get("bigbank-term-sheet")!.text).toContain("$35,000,000 to $40,000,000");
  });

  it("keeps Series B facts from Daniel until the capitalization summary arrives, even inside M3", () => {
    const daniel = idx.character("senior_associate");
    const simon = idx.character("target_counsel");
    const inM3 = (m: string) => ["M1", "M2", "M3"].includes(m);
    const access = (released: string[], who: string) => ({ released: (d: string) => released.includes(d), ownedBy: (d: string) => idx.document(d).from === who });
    const early = sliceFactsFor(daniel, pkg.facts, inM3, access(["letter-of-intent", "bigbank-term-sheet"], daniel.id));
    expect(Object.keys(early)).not.toContain("cap.series_b_class_vote");
    // Ungated facts stay known; they are only labelled as not yet in the associate's documents.
    expect(Object.keys(early)).toContain("cap.larchmont_voting_pct");
    expect(Object.keys(sliceFactsFor(simon, pkg.facts, inM3, access([], simon.id)))).toContain("cap.series_b_class_vote");
    const late = sliceFactsFor(daniel, pkg.facts, inM3, access(["letter-of-intent", "bigbank-term-sheet", "dr-capitalization"], daniel.id));
    expect(Object.keys(late)).toContain("cap.series_b_class_vote");
    const parts = partitionFactsBySource(early, (d) => ["letter-of-intent", "bigbank-term-sheet"].includes(d));
    expect(Object.keys(parts.inDocuments)).toContain("debt.liquidation_recovery");
    expect(Object.keys(parts.notInDocuments)).toContain("cap.larchmont_voting_pct");
    expect(Object.keys(parts.notInDocuments)).toContain("structure.hsr");
  });
});

describe.each(["acme-merger-01", "venture-debt-01"])("%s fact sources", (id) => {
  const { pkg, dir } = loadScenario(scenarioDir(id));
  const docs = new Map(buildAllDocuments(dir, pkg.documents).map((d) => [d.id, d]));

  it("says where every fact lives", () => {
    for (const [k, v] of Object.entries(pkg.facts)) expect(v.source, k).toBeDefined();
  });

  it("only cites documents the associate is actually sent", () => {
    const sent = new Set(pkg.beats.flatMap((b) => b.attachments));
    for (const [k, v] of Object.entries(pkg.facts)) if (Array.isArray(v.source)) for (const d of v.source) expect(sent.has(d), `${k} -> ${d}`).toBe(true);
  });

  // Amounts, percentages and dates must appear, as written, in a document the fact cites.
  it("finds each sourced amount, percentage and date in one of its documents", () => {
    for (const [k, v] of Object.entries(pkg.facts)) {
      if (!Array.isArray(v.source)) continue;
      const texts = v.source.map((d) => docs.get(d)!.text);
      const needles: string[] = [];
      if ((v.type === "money" && v.value !== 0) || v.type === "percent") needles.push(formatFact(v));
      if (v.type === "date") needles.push(`{{${k}}}`);
      if (v.type === "text") needles.push(...(v.value.match(/\$\d[\d,]*\d|\d+%/g) ?? []));
      for (const n of needles) expect(texts.some((t) => t.includes(n)), `${k}: "${n}" not in ${v.source.join(", ")}`).toBe(true);
    }
  });

});
