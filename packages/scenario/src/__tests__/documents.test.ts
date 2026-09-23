import { describe, it, expect } from "vitest";
import { buildDocumentFromMarkdown } from "../documents.js";

const entry = {
  id: "loan-and-security-agreement",
  title: "Loan and Security Agreement",
  short_title: "LSA",
  kind: "loan_agreement" as const,
  source: "x.md",
  from: "lenders_counsel",
  version: "0.1",
  attorney_reviewed: false,
};

describe("document build", () => {
  it("creates section anchors with human references", () => {
    const md = `# Loan and Security Agreement\n\nPreamble.\n\n## 6. Negative Covenants\n\n### 6.2 Liens\n\nIntro.\n\n(a) first clause.\n\n(b) second clause with **bold**.\n\n## Exhibit A – Collateral Description\n\nAll assets.`;
    const built = buildDocumentFromMarkdown(entry, md);
    const refs = built.anchors.map((a) => a.ref);
    expect(refs).toContain("Section 6");
    expect(refs).toContain("Section 6.2");
    expect(refs).toContain("Section 6.2(a)");
    expect(refs).toContain("Section 6.2(b)");
    expect(refs).toContain("Exhibit A");
    expect(built.html).toContain('id="sec-6-2"');
    expect(built.html).toContain('data-ref="Section 6.2(b)"');
    expect(built.text).toContain("second clause");
  });
  it("is deterministic", () => {
    const md = "# T\n\n## 1. One\n\ntext";
    expect(buildDocumentFromMarkdown(entry, md)).toEqual(buildDocumentFromMarkdown(entry, md));
  });
});
