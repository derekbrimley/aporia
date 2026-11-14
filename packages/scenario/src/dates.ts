import type { BuiltDocument, Facts, ScenarioPackage } from "./schema.js";
import { formatFact } from "./facts.js";

/**
 * Deal dates follow the associate's calendar. A date fact with `offset_days` is that many days from
 * the session's anchor (the day it started), moved off weekends: back to Friday for a past date,
 * forward to Monday for a future one. Its `value` in facts.yaml is only the fallback for code with
 * no session (validation, unit tests).
 *
 * Text anywhere in the scenario can name a fact as `{{fact.key}}`: fixed beat bodies, briefs and
 * document sources. `forSession` fills them in, so the documents, emails, prompts and fact checker
 * all see the same dates.
 */

const TOKEN_RE = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\s*\}\}/g;
const DAY = 86_400_000;

/** The day a session's dates count from. A later "shift dates" feature only has to move this. */
export function dateAnchor(state: { startedAt: string | null; dateAnchor?: string | null }): string | null {
  return state.dateAnchor ?? state.startedAt;
}

function offWeekend(t: number, offset: number): number {
  const day = new Date(t).getUTCDay();
  if (day === 6) return t + (offset < 0 ? -1 : 2) * DAY;
  if (day === 0) return t + (offset < 0 ? -2 : 1) * DAY;
  return t;
}

export function displayDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The calendar day of an ISO timestamp in a time zone, as YYYY-MM-DD. With no zone (or one the
 * runtime doesn't know) it is the UTC day, which is how sessions without a recorded zone count.
 */
export function anchorDay(anchor: string, timeZone?: string | null): string {
  if (timeZone) {
    try {
      return new Date(anchor).toLocaleDateString("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      // unknown zone: fall through to UTC
    }
  }
  return anchor.slice(0, 10);
}

/** Facts with every offset date resolved against the anchor (an ISO timestamp; its day in `timeZone`, else UTC, counts). */
export function resolveDates(facts: Facts, anchor: string | null, timeZone?: string | null): Facts {
  if (!anchor) return facts;
  const start = Date.parse(anchorDay(anchor, timeZone) + "T00:00:00Z");
  if (Number.isNaN(start)) return facts;
  const out: Facts = {};
  for (const [k, v] of Object.entries(facts)) {
    if (v.type === "date" && v.offset_days != null) {
      const value = new Date(offWeekend(start + v.offset_days * DAY, v.offset_days)).toISOString().slice(0, 10);
      out[k] = { ...v, value, display: displayDate(value) };
    } else out[k] = v;
  }
  return out;
}

/** Replaces `{{fact.key}}` with the fact's display text. Unknown keys are left as written. */
export function fillFacts(text: string, facts: Facts): string {
  return text.replace(TOKEN_RE, (whole, key: string) => (facts[key] ? formatFact(facts[key]!) : whole));
}

/** Every `{{fact.key}}` named in a text, for validation. */
export function factTokens(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => m[1]!);
}

/** The scenario as this session sees it: dates resolved, and fact tokens filled in beats and documents. */
export function forSession(pkg: ScenarioPackage, documents: Map<string, BuiltDocument>, anchor: string | null, timeZone?: string | null): { pkg: ScenarioPackage; documents: Map<string, BuiltDocument> } {
  const facts = resolveDates(pkg.facts, anchor, timeZone);
  const fill = (s: string | undefined) => (s == null ? s : fillFacts(s, facts));
  const beats = pkg.beats.map((b) => ({ ...b, body: fill(b.body), brief: fill(b.brief) }));
  const docs = new Map<string, BuiltDocument>();
  for (const [id, d] of documents) docs.set(id, { ...d, html: fillFacts(d.html, facts), text: fillFacts(d.text, facts) });
  return { pkg: { ...pkg, facts, beats }, documents: docs };
}
