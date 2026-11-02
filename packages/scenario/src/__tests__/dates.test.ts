import { describe, it, expect } from "vitest";
import { buildAllDocuments, loadScenario, scenarioDir, DEFAULT_SCENARIO_ID } from "../index.js";
import { fillFacts, forSession, resolveDates } from "../dates.js";

const dir = scenarioDir(DEFAULT_SCENARIO_ID);
const { pkg } = loadScenario(dir);
const documents = new Map(buildAllDocuments(dir, pkg.documents).map((d) => [d.id, d]));

describe("session dates", () => {
  it("counts deal dates from the session's start and keeps them off weekends", () => {
    // Monday 2026-11-02.
    const f = resolveDates(pkg.facts, "2026-11-02T15:00:00Z");
    const v = (k: string) => (f[k] as { value: string }).value;
    expect(v("dates.term_sheet")).toBe("2026-10-30"); // -3 lands on Friday
    expect(v("dates.lsa_draft")).toBe("2026-11-02");
    expect(v("dates.target_series_close")).toBe("2026-11-24");
    expect(v("dates.target_loan_close")).toBe("2026-11-30");
    expect((f["dates.target_loan_close"] as { display: string }).display).toBe("November 30, 2026");
    // Tuesday start: -3 is a Saturday, moved back to Friday. Friday start: +22 is a Saturday, moved to Monday.
    expect((resolveDates(pkg.facts, "2026-11-03T09:00:00Z")["dates.term_sheet"] as { value: string }).value).toBe("2026-10-30");
    const g = resolveDates(pkg.facts, "2026-11-06T09:00:00Z");
    expect((g["dates.target_series_close"] as { value: string }).value).toBe("2026-11-30");
  });

  it("leaves facts alone without a session", () => {
    expect(resolveDates(pkg.facts, null)).toBe(pkg.facts);
  });

  it("fills {{fact}} tokens in beats and documents, and leaves no token behind", () => {
    const s = forSession(pkg, documents, "2026-11-02T15:00:00Z");
    const priya = s.pkg.beats.find((b) => b.id === "B-M2-term-sheet")!;
    expect(priya.body).toContain("targeting a close around November 24, 2026");
    expect(s.documents.get("term-sheet")!.html).toContain("October 30, 2026");
    for (const b of s.pkg.beats) expect(`${b.body ?? ""}${b.brief ?? ""}`).not.toMatch(/\{\{/);
    for (const d of s.documents.values()) expect(d.html + d.text).not.toMatch(/\{\{/);
    expect(fillFacts("{{no.such_fact}}", s.pkg.facts)).toBe("{{no.such_fact}}");
  });
});
