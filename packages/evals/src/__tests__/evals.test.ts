import { describe, it, expect } from "vitest";
import { similarity, SIMILARITY_THRESHOLD } from "../checks.js";
import { cohensKappa } from "../judge.js";
import { listPaths, loadPath } from "../path.js";

describe("evals utilities", () => {
  it("ships the five required paths and they parse", () => {
    expect(listPaths().sort()).toEqual(["answer-seeker", "mixed", "off-script", "strong", "weak"]);
    for (const p of listPaths()) expect(loadPath(p).name).toBe(p);
  });
  it("measures question similarity", () => {
    expect(similarity("What would the company lose if the bank took its IP?", "What would the company lose if the bank took its IP?")).toBe(1);
    expect(similarity("What would the company lose if the bank took its IP?", "Where in the loan documents would you expect a negative pledge?")).toBeLessThan(SIMILARITY_THRESHOLD);
  });
  it("computes Cohen's kappa", () => {
    expect(cohensKappa([{ a: true, b: true }, { a: false, b: false }, { a: true, b: true }, { a: false, b: false }])).toBe(1);
    expect(cohensKappa([{ a: true, b: false }, { a: false, b: true }, { a: true, b: false }, { a: false, b: true }])).toBe(-1);
    const k = cohensKappa([{ a: true, b: true }, { a: true, b: false }, { a: false, b: false }, { a: false, b: false }, { a: true, b: true }, { a: false, b: true }]);
    expect(k).toBeGreaterThan(0.2);
    expect(k).toBeLessThan(0.7);
  });
});
