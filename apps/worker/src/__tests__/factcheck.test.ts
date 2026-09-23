import { describe, it, expect } from "vitest";
import { loadScenario, scenarioDir, DEFAULT_SCENARIO_ID, ScenarioIndex, sliceFactsFor } from "@aporia/scenario";
import { ruleCheck } from "../factcheck/rules.js";
import { MockProvider } from "../llm/mock.js";
import { derivedUuid } from "../ids.js";

const { pkg } = loadScenario(scenarioDir(DEFAULT_SCENARIO_ID));
const idx = new ScenarioIndex(pkg);

describe("fact checker rules layer", () => {
  const client = idx.character("client_contact");
  const slice = sliceFactsFor(client, pkg.facts);

  it("passes a draft that only uses known facts", () => {
    const v = ruleCheck("Priya here. Tranche 1 is $50,000,000 and opens when the $150,000,000 Series C closes, targeting November 14, 2026.", slice, pkg.facts);
    expect(v).toEqual([]);
  });
  it("fails on an amount outside the slice", () => {
    const v = ruleCheck("The Bank wants a $12,000,000 minimum cash floor.", slice, pkg.facts);
    expect(v.map((x) => x.kind)).toContain("amount");
  });
  it("fails on a percentage, date, or party the character does not know", () => {
    expect(ruleCheck("The margin is 7.25%.", slice, pkg.facts).map((x) => x.kind)).toContain("percent");
    expect(ruleCheck("We close on December 3.", slice, pkg.facts).map((x) => x.kind)).toContain("date");
    expect(ruleCheck("Jordan Hale said no.", slice, pkg.facts).map((x) => x.kind)).toContain("party");
  });
  it("catches fiction breaks and grading", () => {
    expect(ruleCheck("As an AI I cannot say.", slice, pkg.facts).map((x) => x.kind)).toContain("fiction_break");
    expect(ruleCheck("You missed the landlord waiver point. 3/5.", slice, pkg.facts).map((x) => x.kind)).toContain("grading");
  });
  it("accepts amounts that appear inside the character's text facts", () => {
    const lender = idx.character("lenders_counsel");
    const v = ruleCheck("The closing fee is 1.00% and the final payment fee 3.50%.", sliceFactsFor(lender, pkg.facts), pkg.facts);
    expect(v).toEqual([]);
  });
});

describe("mock provider", () => {
  it("classifies intent from body shape and honours markers", async () => {
    const m = new MockProvider();
    const q = await m.generateJson({ role: "intent_classifier", system: "", user: "", promptVersion: "x", mockContext: { body: "Thanks!" } }, (await import("@aporia/prompts")).IntentOutputSchema);
    expect(q.parsed.intent).toBe("acknowledgment");
    const d = await m.generateJson({ role: "intent_classifier", system: "", user: "", promptVersion: "x", mockContext: { body: "x".repeat(200), openAssignmentTitle: "Term sheet comments" } }, (await import("@aporia/prompts")).IntentOutputSchema);
    expect(d.parsed.intent).toBe("deliverable");
  });
  it("assesses by issue keywords", async () => {
    const m = new MockProvider();
    const r = await m.generateJson({ role: "assessor", system: "", user: "", promptVersion: "x", mockContext: { deliverable: "The landlord waiver for the leased site is a long-lead item.", rationale: "x", issues: [{ id: "A2.I4", keywords: ["landlord", "waiver"] }, { id: "A2.I1", keywords: ["revenue", "tested"] }], decisionPoints: [] } }, (await import("@aporia/prompts")).AssessmentOutputSchema);
    expect(r.parsed.issues.find((i) => i.id === "A2.I4")?.status).toBe("raised");
    expect(r.parsed.issues.find((i) => i.id === "A2.I1")?.status).toBe("missed");
  });
});

describe("derived ids", () => {
  it("are stable uuids", () => {
    expect(derivedUuid("a", "b")).toBe(derivedUuid("a", "b"));
    expect(derivedUuid("a", "b")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
