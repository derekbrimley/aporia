import { initialState, step, type EngineEvent, type SessionState } from "@rematter/engine";
import { getPool, listEvents } from "@rematter/db";
import { ScenarioIndex, type ScenarioPackage } from "@rematter/scenario";
import { JUDGE_FLAGS, type JudgeFlag } from "./judge.js";

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
export async function runChecks(sessionId: string, state: SessionState, pkg: ScenarioPackage, judgeFindings?: Record<JudgeFlag, number>): Promise<CheckResult[]> {
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

  if (judgeFindings) {
    out.push({ name: "no_answer_key_leaks_or_fiction_breaks", pass: judgeFindings.answer_key_leak === 0 && judgeFindings.fiction_break === 0, detail: `leaks=${judgeFindings.answer_key_leak} breaks=${judgeFindings.fiction_break}` });
    out.push({ name: "no_false_document_claims", pass: judgeFindings.false_document_claim === 0, detail: `${judgeFindings.false_document_claim} emails` });
    out.push({ name: "no_invented_logistics", pass: judgeFindings.invented_logistics === 0, detail: `${judgeFindings.invented_logistics} emails` });
    out.push({ name: "no_withholding_from_stuck_associate", pass: judgeFindings.withholds_from_stuck_associate === 0, detail: `${judgeFindings.withholds_from_stuck_associate} emails` });
  } else out.push({ name: "no_answer_key_leaks_or_fiction_breaks", pass: true, detail: "judge not run (mock provider); rules layer enforced" });

  let maxSim = 0;
  const qs = state.reflectionQuestionsAsked;
  for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) maxSim = Math.max(maxSim, similarity(qs[i]!, qs[j]!));
  out.push({ name: "reflection_questions_below_similarity_threshold", pass: maxSim < SIMILARITY_THRESHOLD, detail: `${qs.length} questions, max similarity ${maxSim.toFixed(2)}` });

  const debrief = Object.values(state.messages).find((m) => m.kind === "debrief");
  const fired = pkg.consequences.filter((c) => state.consequences[c.id] === "fired");
  // Names that single out one consequence: not the cast, and not a party every consequence mentions.
  const common = new Set(pkg.characters.flatMap((ch) => ch.name.toLowerCase().split(/\s+/)));
  const seen = new Map<string, number>();
  for (const c of pkg.consequences) for (const n of new Set(properNames(c.how_it_appears))) seen.set(n, (seen.get(n) ?? 0) + 1);
  for (const [n, count] of seen) if (count > 1) common.add(n);
  for (const w of `${pkg.meta.counterparty_name} ${pkg.meta.matter_label}`.toLowerCase().split(/[^a-z]+/)) if (w) common.add(w);
  const castNames = common;
  const referenced = fired.filter((c) => debrief && mentions(debrief.body, c, castNames));
  out.push({ name: "debrief_references_two_fired_consequences", pass: Boolean(debrief) && referenced.length >= Math.min(2, fired.length), detail: debrief ? `${referenced.length}/${fired.length} fired consequences referenced` : "no debrief" });

  out.push(...(await invariantChecks(sessionId, state, pkg)));

  const p95 = await getPool().query<{ p95: number | null }>(`select percentile_cont(0.95) within group (order by latency_ms) as p95 from generations where session_id = $1 and role in ('character_writer','reflection_engine')`, [sessionId]);
  out.push({ name: "reply_generation_p95_under_30s", pass: (p95.rows[0]!.p95 ?? 0) < 30_000, detail: `p95 ${Math.round(p95.rows[0]!.p95 ?? 0)}ms (single generation; end-to-end measured by the worker)` });
  return out;
}

/**
 * Whether the debrief refers to a consequence. Evidence is the title's longer words plus the
 * names in how it appeared (Halvorsen, Ostrander), leaving out names that don't single it out.
 */
function mentions(body: string, c: { title: string; how_it_appears: string }, castNames: Set<string>): boolean {
  const b = body.toLowerCase();
  if (b.includes(c.title.toLowerCase())) return true;
  const titleWords = c.title.toLowerCase().split(/[^a-z']+/).filter((w) => w.length > 5);
  const names = properNames(c.how_it_appears).filter((w) => !castNames.has(w));
  const key = [...new Set([...titleWords, ...names])];
  return key.filter((w) => b.includes(w)).length >= Math.min(2, key.length);
}

/** Capitalized words that are not the first word of a sentence. */
function properNames(text: string): string[] {
  return [...text.matchAll(/(?<![.!?]\s|^)\b[A-Z][a-z]{3,}\b/g)].map((m) => m[0].toLowerCase());
}

/** A thread this long inside one milestone is a conversation going in circles (Austin's ran 24). */
export const RUNAWAY_THREAD_MESSAGES = 16;

/**
 * Deterministic checks on how the session unfolded, independent of what the model wrote, so they
 * hold on the mock provider in CI. Each one is a failure a tester hit.
 */
export async function invariantChecks(sessionId: string, state: SessionState, pkg: ScenarioPackage): Promise<CheckResult[]> {
  const out: CheckResult[] = [];

  // Two replies from one character to one email (B-20, the double reply in session 259601d4).
  const doubles: string[] = [];
  for (const t of Object.values(state.threads)) {
    const tm = t.messageIds.map((id) => state.messages[id]!);
    for (let i = 1; i < tm.length; i++) {
      if (tm[i]!.kind === "reply" && tm[i - 1]!.kind === "reply" && tm[i]!.from === tm[i - 1]!.from && tm[i]!.from !== "associate") doubles.push(`${tm[i]!.from} on "${t.subject}"`);
    }
  }
  out.push({ name: "no_double_replies", pass: doubles.length === 0, detail: doubles.join("; ") || "ok" });

  // A thread that keeps going inside one milestone (the 24-message follow-up thread in session 6772ce0f).
  const milestoneAt = (at: string) => {
    let cur: string | null = null;
    for (const m of [...pkg.milestones].sort((a, b) => a.order - b.order)) {
      const e = state.milestones[m.id]?.enteredAt;
      if (e && e <= at) cur = m.id;
    }
    return cur;
  };
  const runaway: string[] = [];
  for (const t of Object.values(state.threads)) {
    if (t.hidden) continue;
    const counts = new Map<string, number>();
    for (const id of t.messageIds) {
      const k = milestoneAt(state.messages[id]!.at) ?? "-";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const [k, n] of counts) if (n > RUNAWAY_THREAD_MESSAGES) runaway.push(`"${t.subject}" ${n} messages in ${k}`);
  }
  out.push({ name: "no_runaway_threads", pass: runaway.length === 0, detail: runaway.join("; ") || `max ${RUNAWAY_THREAD_MESSAGES} per thread per milestone` });

  const events = await listEvents(sessionId);

  // Follow-ups on a private reflection thread are conversation, not work to grade (session 6772ce0f).
  const probes = events.filter((e) => e.type === "assessment_recorded" && e.payload.probe).map((e) => (e as Extract<EngineEvent, { type: "assessment_recorded" }>).payload.messageId)
    .filter((id) => state.threads[state.messages[id]?.threadId ?? ""]?.key?.startsWith("reflection:"));
  out.push({ name: "no_probe_assessments_on_follow_up_threads", pass: probes.length === 0, detail: probes.length ? `${probes.length} probes` : "ok" });

  out.push(await gatedFactsCheck(sessionId, events, pkg));
  return out;
}

/**
 * Facts gated to a milestone must not reach a character's prompt (or the email) before the milestone
 * starts and one of their source documents has reached the associate (session 6772ce0f: Daniel had the
 * Series B class vote 23 minutes before the data room email). Checks every prompt path at once, so a new
 * path that skips `factsFor` fails here. Only long text facts are matched, so short values that also
 * appear elsewhere don't trip it.
 */
export async function gatedFactsCheck(sessionId: string, events: EngineEvent[], pkg: ScenarioPackage): Promise<CheckResult> {
  const gated = Object.entries(pkg.facts).filter(([, f]) => f.available_from && "value" in f && typeof f.value === "string" && f.value.length >= 40);
  if (!gated.length) return { name: "gated_facts_wait_for_documents", pass: true, detail: "no gated text facts" };
  const testMode = (await getPool().query<{ test_mode: boolean }>(`select test_mode from sessions where id = $1`, [sessionId])).rows[0]?.test_mode ?? true;
  const gens = (await getPool().query<{ job_key: string; system_prompt: string; user_prompt: string }>(
    `select job_key, system_prompt, user_prompt from generations where session_id = $1 and role in ('character_writer','reflection_engine','recap_debrief') and job_key is not null`, [sessionId])).rows;
  const byJob = new Map<string, string[]>();
  for (const g of gens) byJob.set(g.job_key, [...(byJob.get(g.job_key) ?? []), g.system_prompt + "\n" + g.user_prompt]);
  const docFrom = new Map(pkg.documents.map((d) => [d.id, d.from]));
  let state = initialState(pkg);
  const early: string[] = [];
  let checked = 0;
  for (const e of events) {
    if (e.type === "message_delivered") {
      const p = e.payload;
      const texts = [...(byJob.get(p.jobKey ?? "") ?? []), p.body];
      checked++;
      for (const [key, f] of gated) {
        const entered = Boolean(state.milestones[f.available_from!]?.enteredAt);
        const src = Array.isArray(f.source) ? f.source : [];
        const docOk = !src.length || src.some((d) => state.documentsReleased.includes(d) || p.attachments.includes(d) || docFrom.get(d) === p.from);
        if (entered && docOk) continue;
        if (texts.some((t) => t.includes((f as { value: string }).value))) early.push(`${key} reached ${p.from} (${p.kind}${p.beatId ? ` ${p.beatId}` : ""}) before ${entered ? "its document" : f.available_from}`);
      }
    }
    state = step(state, e, pkg, { zeroDelays: testMode }).state;
  }
  return { name: "gated_facts_wait_for_documents", pass: early.length === 0, detail: early.length ? [...new Set(early)].join("; ") : `${gated.length} gated facts, ${checked} emails checked` };
}
