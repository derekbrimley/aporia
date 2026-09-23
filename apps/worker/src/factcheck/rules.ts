import type { Facts, FactValue } from "@aporia/scenario";

export interface Violation {
  kind: "amount" | "percent" | "date" | "party" | "fiction_break" | "grading" | "slice_contradiction" | "answer_key_leak" | "invented_fact";
  detail: string;
}

const FICTION_BREAK = /\b(simulation|simulated|as an ai|language model|large language model|\bllm\b|prompt(?:ed|s)?\b|training exercise|this exercise|role[- ]?play|chatbot|i am an ai|i'm an ai|artificial intelligence)\b/i;
const GRADING = /\b(you (?:missed|forgot|failed to|got (?:this|that|it) wrong)|incorrect|that is wrong|you are wrong|(?:your )?score|\d+\s*(?:\/|out of)\s*\d+|grade[sd]?\b|well done on|full marks)\b/i;

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
const DATE_RE = new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:,\\s*(\\d{4}))?\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b`, "gi");
const MONEY_RE = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(million|mm|m|bn|billion|k|thousand)?\b/gi;
const PERCENT_RE = /(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/gi;

function toNumber(raw: string, unit?: string): number {
  let n = Number(raw.replace(/,/g, ""));
  const u = (unit ?? "").toLowerCase();
  if (u === "million" || u === "mm" || u === "m") n *= 1_000_000;
  else if (u === "bn" || u === "billion") n *= 1_000_000_000;
  else if (u === "k" || u === "thousand") n *= 1_000;
  return n;
}

function moneyValues(facts: Facts): Set<number> {
  const out = new Set<number>();
  for (const v of Object.values(facts)) if (v.type === "money") out.add(v.value);
  return out;
}
function percentValues(facts: Facts): Set<number> {
  const out = new Set<number>();
  for (const v of Object.values(facts)) if (v.type === "percent") out.add(v.value);
  return out;
}
function textOf(v: FactValue): string {
  return "value" in v ? String(v.value) : "";
}

/** Every distinct number that appears in any text/placeholder fact in the slice is also acceptable (e.g. amounts quoted inside a description). */
function numbersInText(facts: Facts): Set<number> {
  const out = new Set<number>();
  for (const v of Object.values(facts)) {
    const t = textOf(v) + ("definition" in v ? " " + v.definition : "");
    for (const m of t.matchAll(MONEY_RE)) out.add(toNumber(m[1]!, m[2]));
    for (const m of t.matchAll(PERCENT_RE)) out.add(Number(m[1]));
  }
  return out;
}

/**
 * Layer 1 of the fact checker: extract dollar amounts, percentages, dates and
 * party names from the draft and compare each to the character's slice.
 * Any mismatch fails. Small integers that are not money are ignored.
 */
export function ruleCheck(draft: string, slice: Facts, allFacts: Facts): Violation[] {
  const out: Violation[] = [];
  const knownMoney = moneyValues(slice);
  const knownPct = percentValues(slice);
  const inText = numbersInText(slice);

  for (const m of draft.matchAll(MONEY_RE)) {
    const n = toNumber(m[1]!, m[2]);
    if (n < 1000) continue; // "$5" is never a deal fact
    if (!knownMoney.has(n) && !inText.has(n)) out.push({ kind: "amount", detail: `Amount ${m[0]} is not in the character's known facts` });
  }
  for (const m of draft.matchAll(PERCENT_RE)) {
    const n = Number(m[1]);
    if (!knownPct.has(n) && !inText.has(n)) out.push({ kind: "percent", detail: `Percentage ${m[0]} is not in the character's known facts` });
  }
  const knownDates = new Set<string>();
  for (const v of Object.values(slice)) {
    if (v.type === "date") {
      knownDates.add(v.value);
      if (v.display) knownDates.add(v.display.toLowerCase());
      const d = new Date(v.value + "T00:00:00Z");
      knownDates.add(d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).toLowerCase());
    }
    const t = textOf(v);
    for (const m of t.matchAll(DATE_RE)) knownDates.add(m[0].toLowerCase().replace(/,\s*\d{4}$/, ""));
  }
  for (const m of draft.matchAll(DATE_RE)) {
    const raw = m[0].toLowerCase();
    const noYear = raw.replace(/,\s*\d{4}$/, "");
    if (!knownDates.has(raw) && !knownDates.has(noYear)) out.push({ kind: "date", detail: `Date "${m[0]}" is not in the character's known facts` });
  }
  // Party names known to the deal but outside this character's slice.
  const sliceText = Object.values(slice).map((v) => textOf(v) + ("aliases" in v ? " " + v.aliases.join(" ") : "")).join(" ").toLowerCase();
  for (const [key, v] of Object.entries(allFacts)) {
    if (v.type !== "party" || key in slice) continue;
    const names = [v.value, ...v.aliases].filter((n) => n.length > 4);
    for (const name of names) {
      if (draft.toLowerCase().includes(name.toLowerCase()) && !sliceText.includes(name.toLowerCase())) {
        out.push({ kind: "party", detail: `Mentions ${name}, which this character does not know about` });
        break;
      }
    }
  }
  if (FICTION_BREAK.test(draft)) out.push({ kind: "fiction_break", detail: `Draft breaks the fiction: ${draft.match(FICTION_BREAK)![0]}` });
  if (GRADING.test(draft)) out.push({ kind: "grading", detail: `Draft grades or announces an error: "${draft.match(GRADING)![0]}"` });
  return out;
}
