import { describe, it, expect } from "vitest";
import { loadScenario, scenarioDir, DEFAULT_SCENARIO_ID, ScenarioIndex, sliceFactsFor } from "@aporia/scenario";
import { characterWriterPrompt, doctrinePrompt, MODELS, CHARACTER_HARD_RULES } from "../index.js";

const { pkg } = loadScenario(scenarioDir(DEFAULT_SCENARIO_ID));
const idx = new ScenarioIndex(pkg);

describe("prompts", () => {
  it("pins a model for every role and never hard-codes model ids in prompts", () => {
    for (const spec of Object.values(MODELS)) expect(spec.anthropic).toMatch(/^claude-/);
    const p = characterWriterPrompt({ character: idx.character("senior_associate"), facts: {}, associateFirstName: "Sam", thread: [], mode: { kind: "reply", toMessageBody: "x" }, storyDate: "2026-10-01" });
    expect(p.system + p.user).not.toMatch(/claude-/);
  });
  it("puts stable content first so the prefix caches, and includes the hard rules", () => {
    const facts = sliceFactsFor(idx.character("client_contact"), pkg.facts);
    const p = characterWriterPrompt({ character: idx.character("client_contact"), facts, associateFirstName: "Sam", thread: [], mode: { kind: "reply", toMessageBody: "x" }, storyDate: "2026-10-01" });
    expect(p.system.startsWith("You are Priya Raman")).toBe(true);
    expect(p.system).toContain(CHARACTER_HARD_RULES);
    expect(p.system).toContain("client.financials.monthly_burn");
    expect(p.system).not.toContain("covenants.minimum_cash");
  });
  it("gives the doctrine assistant no deal facts", () => {
    const p = doctrinePrompt({ character: idx.doctrineAssistant, associateFirstName: "Sam", question: "What is a negative pledge?", priorExchanges: [] });
    expect(p.system).not.toContain("Northlake");
    expect(p.system).not.toContain("Halden");
  });
});
