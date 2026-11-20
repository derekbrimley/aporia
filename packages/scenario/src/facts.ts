import type { Character, Facts, FactValue } from "./schema.js";

/** Which documents the associate has, and which ones the character wrote or holds as their own side's. */
export interface DocumentAccess {
  /** True once the document has reached the associate's inbox. */
  released: (documentId: string) => boolean;
  /** True if the character produced the document (it is `from` them), so they know it before the associate does. */
  ownedBy: (documentId: string) => boolean;
}

/**
 * Returns the subset of facts a character is allowed to know. Pass `entered` (has the session entered
 * this milestone?) to withhold facts whose `available_from` milestone hasn't arrived yet. With `docs` as
 * well, such a gated fact also waits until one of its `source` documents reaches the associate (or the
 * character produced one of them): a milestone can begin before its documents are delivered. Without
 * them every fact counts as available (validation and tests).
 */
export function sliceFactsFor(character: Character, facts: Facts, entered?: (milestoneId: string) => boolean, docs?: DocumentAccess): Facts {
  const out: Facts = {};
  for (const key of Object.keys(facts)) {
    const f = facts[key]!;
    const gate = f.available_from;
    if (gate && entered && !entered(gate)) continue;
    // A gated fact the associate can only learn from a document stays hidden until that document reaches
    // them, even once the milestone has begun, so nobody discusses it before the associate can read it.
    if (gate && docs && Array.isArray(f.source) && !f.source.some((d) => docs.released(d) || docs.ownedBy(d))) continue;
    for (const pattern of character.knows.facts) {
      if (pattern === key || (pattern.endsWith(".*") && key.startsWith(pattern.slice(0, -1)))) {
        out[key] = f;
        break;
      }
    }
  }
  return out;
}

export function formatFact(v: FactValue): string {
  switch (v.type) {
    case "money":
      return v.display ?? formatMoney(v.value, v.currency);
    case "percent":
      return v.display ?? `${v.value}%`;
    case "number":
      return v.display ?? `${v.value}${v.unit ? " " + v.unit : ""}`;
    case "date":
      return v.display ?? v.value;
    case "text":
    case "party":
    case "placeholder":
      return v.value;
    case "defined_term":
      return `${v.value}: ${v.definition}`;
  }
}

export function formatMoney(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

/** Renders a fact slice as stable, cache-friendly text for a prompt. Keys are sorted. */
export function renderFactsForPrompt(facts: Facts, docTitle?: (documentId: string) => string): string {
  return Object.keys(facts)
    .sort()
    .map((k) => {
      const v = facts[k]!;
      const note = "note" in v && v.note ? `  (${v.note})` : "";
      const where = docTitle && Array.isArray(v.source) ? `  [in: ${v.source.map(docTitle).join("; ")}]` : "";
      return `- ${k}: ${formatFact(v)}${note}${where}`;
    })
    .join("\n");
}

/**
 * Splits a slice by where the associate can read each fact: in a document they already have, or
 * nowhere they can see (background, or a document that hasn't reached them yet). Facts with no
 * `source` (older scenarios) come back as `unsourced`.
 */
export function partitionFactsBySource(facts: Facts, released: (documentId: string) => boolean): { inDocuments: Facts; notInDocuments: Facts; unsourced: Facts } {
  const inDocuments: Facts = {};
  const notInDocuments: Facts = {};
  const unsourced: Facts = {};
  for (const [k, v] of Object.entries(facts)) {
    if (v.source === undefined) unsourced[k] = v;
    else if (Array.isArray(v.source) && v.source.some(released)) inDocuments[k] = { ...v, source: v.source.filter(released) };
    else notInDocuments[k] = v;
  }
  return { inDocuments, notInDocuments, unsourced };
}
