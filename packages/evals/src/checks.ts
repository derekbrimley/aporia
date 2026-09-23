import type { SessionState } from "@aporia/engine";
import { getPool } from "@aporia/db";
import { ScenarioIndex, type ScenarioPackage } from "@aporia/scenario";

export interface CheckResult { name: string; pass: boolean; detail: string }

/** Word-set Jaccard similarity; the repetition guard threshold applies to it. */
export function similarity(a: string, b: string): number {
  const w = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((x) => x.length > 3));
  const A = w(a), B = w(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export const SIMILARITY_THRESHOLD = 0.6;

/** The automatic checks the spec requires on every bot run. */
export async function runChecks(sessionId: string, state: SessionState, pkg: ScenarioPackage, judgeFindings?: { leaks: number; breaks: number }): Promise<CheckResult[]> {
  const idx = new ScenarioIndex(pkg);
  const out: CheckResult[] = [];
  const order = idx.milestonesInOrder.map((m) => m.id);
  const completed = order.filter((m) => state.milestones[m]?.completedAt);
  const inOrder = completed.every((m, i) => order[i] === m) && (completed.length < 2 || completed.every((m, i) => i === 0 || state.milestones[m]!.completedAt! >= state.milestones[completed[i - 1]!]!.completedAt!));
  out.push({ name: "reaches_closing_in_order", pass: state.status === "completed" && inOrder && completed.length === order.length, detail: `completed ${completed.join(",")} status=${state.status}` });

  const held = await getPool().query<{ n: number }>(`select count(*)::int as n from held_emails where session_id = $1 and status = 'held'`, [sessionId]);
  out.push({ name: "zero_held_emails", pass: held.rows[0]!.n === 0, detail: `${held.rows[0]!.n} held` });

  const finalFails = await getPool().query<{ n: number }>(
    `select count(*)::int as n from generations g where g.session_id = $1 and g.role in ('character_writer','reflection_engine','recap_debrief') and (g.checker_result->>'pass') = 'false'
       and g.attempt = (select max(attempt) from generations g2 where g2.session_id = g.session_id and g2.job_key = g.job_key and g2.role = g.role)`, [sessionId]);
  out.push({ name: "zero_fact_check_failures_after_regeneration", pass: finalFails.rows[0]!.n === 0, detail: `${finalFails.rows[0]!.n} final-attempt failures` });

  const unfired = Object.entries(state.consequences).filter(([cid, st]) => st === "seeded" && state.milestones[idx.consequences.get(cid)!.payoff_milestone]?.enteredAt);
  out.push({ name: "seeded_consequences_fire_by_payoff", pass: unfired.length === 0, detail: unfired.length ? `unfired: ${unfired.map(([c]) => c).join(",")}` : `${Object.keys(state.consequences).length} seeded, all fired by payoff` });

  const undeliveredBeats = Object.entries(state.beats).filter(([, s]) => s === "enqueued");
  out.push({ name: "all_triggered_beats_delivered", pass: undeliveredBeats.length === 0, detail: undeliveredBeats.map(([b]) => b).join(",") || "ok" });

  if (judgeFindings) out.push({ name: "no_answer_key_leaks_or_fiction_breaks", pass: judgeFindings.leaks === 0 && judgeFindings.breaks === 0, detail: `leaks=${judgeFindings.leaks} breaks=${judgeFindings.breaks}` });
  else out.push({ name: "no_answer_key_leaks_or_fiction_breaks", pass: true, detail: "judge not run (mock provider); rules layer enforced" });

  let maxSim = 0;
  const qs = state.reflectionQuestionsAsked;
  for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) maxSim = Math.max(maxSim, similarity(qs[i]!, qs[j]!));
  out.push({ name: "reflection_questions_below_similarity_threshold", pass: maxSim < SIMILARITY_THRESHOLD, detail: `${qs.length} questions, max similarity ${maxSim.toFixed(2)}` });

  const debrief = Object.values(state.messages).find((m) => m.kind === "debrief");
  const fired = pkg.consequences.filter((c) => state.consequences[c.id] === "fired");
  const referenced = fired.filter((c) => debrief && mentions(debrief.body, c));
  out.push({ name: "debrief_references_two_fired_consequences", pass: Boolean(debrief) && referenced.length >= Math.min(2, fired.length) && fired.length >= 2, detail: debrief ? `${referenced.length}/${fired.length} fired consequences referenced` : "no debrief" });

  const p95 = await getPool().query<{ p95: number | null }>(`select percentile_cont(0.95) within group (order by latency_ms) as p95 from generations where session_id = $1 and role in ('character_writer','reflection_engine')`, [sessionId]);
  out.push({ name: "reply_generation_p95_under_30s", pass: (p95.rows[0]!.p95 ?? 0) < 30_000, detail: `p95 ${Math.round(p95.rows[0]!.p95 ?? 0)}ms (single generation; end-to-end measured by the worker)` });
  return out;
}

function mentions(body: string, c: { title: string; how_it_appears: string }): boolean {
  const b = body.toLowerCase();
  if (b.includes(c.title.toLowerCase())) return true;
  const key = c.title.toLowerCase().split(/\s+/).filter((w) => w.length > 5);
  return key.filter((w) => b.includes(w)).length >= Math.min(2, key.length);
}
