import { describe, it, expect } from "vitest";
import { loadScenario, scenarioDir, DEFAULT_SCENARIO_ID, ScenarioIndex, sliceFactsFor } from "@aporia/scenario";
import { characterWriterPrompt, doctrinePrompt, intentClassifierPrompt, renderThread, MODELS, CHARACTER_HARD_RULES } from "../index.js";

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
  it("quotes a forwarded email beneath the note, for characters and the classifier", () => {
    const forwarded = { from: "Jordan Hale", fromRole: "Lender's counsel", to: ["Sam"], cc: [], at: "2026-10-01 09:00", subject: "Loan documents", body: "Drafts attached.", attachments: ["Loan Agreement"] };
    const thread = [{ from: "Sam", fromRole: "Associate", to: ["Marcus Bell"], cc: [], at: "2026-10-01 10:00", body: "Forwarding as asked.", forwarded }];
    const rendered = renderThread(thread);
    expect(rendered).toContain("Forwarding as asked.\n\n---------- Forwarded message ----------\nFrom: Jordan Hale (Lender's counsel)");
    expect(rendered).toContain("Attachments: Loan Agreement");
    const p = characterWriterPrompt({ character: idx.character("senior_associate"), facts: {}, associateFirstName: "Sam", thread, mode: { kind: "reply", toMessageBody: "Forwarding as asked." }, storyDate: "2026-10-01" });
    expect(p.user).toContain("Drafts attached.");
    expect(p.user).toContain("forwarded you the email");
    const c = intentClassifierPrompt({ thread: [], outgoing: { to: ["Marcus Bell"], cc: [], body: "", attachments: [], forwarded } });
    expect(c.user).toContain("(no note)");
    expect(c.user).toContain("Drafts attached.");
  });
});
