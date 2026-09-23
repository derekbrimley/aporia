import type { Character, Facts, FactValue } from "./schema.js";

/** Returns the subset of facts a character is allowed to know. */
export function sliceFactsFor(character: Character, facts: Facts): Facts {
  const out: Facts = {};
  for (const key of Object.keys(facts)) {
    for (const pattern of character.knows.facts) {
      if (pattern === key || (pattern.endsWith(".*") && key.startsWith(pattern.slice(0, -1)))) {
        out[key] = facts[key]!;
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
export function renderFactsForPrompt(facts: Facts): string {
  return Object.keys(facts)
    .sort()
    .map((k) => {
      const v = facts[k]!;
      const note = "note" in v && v.note ? `  (${v.note})` : "";
      return `- ${k}: ${formatFact(v)}${note}`;
    })
    .join("\n");
}
