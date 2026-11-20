import { getPool } from "@rematter/db";
import type { SessionState } from "@rematter/engine";
import { JudgeOutputSchema, characterCard, judgePrompt, renderThread, type JudgeDocument, type JudgeOutput } from "@rematter/prompts";
import { ScenarioIndex, dateAnchor, forSession, getScenario, type ScenarioPackage } from "@rematter/scenario";
import { Names, threadForPrompt, type LlmProvider } from "@rematter/worker";

export interface JudgedMessage { messageId: string; from: string; kind: string; rating: JudgeOutput }

/** The judge's flags that fail a run, by check name. */
export const JUDGE_FLAGS = ["answer_key_leak", "fiction_break", "false_document_claim", "invented_logistics", "withholds_from_stuck_associate"] as const;
export type JudgeFlag = (typeof JUDGE_FLAGS)[number];

/**
 * The documents the associate had received before a message arrived, in full and with the session's
 * dates filled in: what a character could fairly point the associate to at that moment.
 */
export function documentsBefore(state: SessionState, pkg: ScenarioPackage, messageId: string, timeZone: string | null = null): JudgeDocument[] {
  const { documents } = forSession(pkg, getScenario(pkg.meta.id).documents, dateAnchor(state), timeZone);
  const seen: string[] = [];
  for (const id of state.messageOrder) {
    if (id === messageId) break;
    const m = state.messages[id]!;
    if (m.from === "associate" || !(m.to.includes("associate") || m.cc.includes("associate"))) continue;
    for (const d of m.attachments) if (!seen.includes(d)) seen.push(d);
  }
  return seen.flatMap((d) => {
    const doc = documents.get(d);
    return doc ? [{ title: doc.title, text: doc.text }] : [];
  });
}

/**
 * Offline judge: rates every character email in a session and stores ratings as rater_type = judge.
 * `onlyAfter` skips emails up to and including that message (a run loaded from a checkpoint only
 * judges what it wrote itself).
 */
export async function judgeSession(sessionId: string, orgId: string, state: SessionState, pkg: ScenarioPackage, provider: LlmProvider, opts: { onlyAfter?: string | null } = {}): Promise<JudgedMessage[]> {
  const idx = new ScenarioIndex(pkg);
  const names = new Names(pkg, state.associateFirstName);
  const out: JudgedMessage[] = [];
  const start = opts.onlyAfter ? state.messageOrder.indexOf(opts.onlyAfter) + 1 : 0;
  for (const id of state.messageOrder.slice(start)) {
    const m = state.messages[id]!;
    if (m.from === "associate" || m.kind === "doctrine") continue;
    const c = idx.character(m.from);
    // Only what was in the thread when this email was written: later emails make it look out of sequence.
    const before = state.threads[m.threadId]?.messageIds.indexOf(m.id) ?? -1;
    const thread = threadForPrompt(state, m.threadId, names).slice(0, Math.max(0, before));
    const hints = (state.threads[m.threadId]?.assignmentIds ?? []).flatMap((a) => idx.assignment(a).issues.map((i) => `${i.title}: ${i.raised_looks_like}`));
    const p = judgePrompt({
      dealType: pkg.meta.deal_type, characterCard: characterCard(c), thread: renderThread(thread), email: m.body, answerKeyHints: hints, isSocratic: m.kind === "reflection",
      consequence: pkg.consequences.find((q) => q.beat && q.beat === m.beatId)?.how_it_appears,
      associateDocuments: documentsBefore(state, pkg, m.id),
    });
    const res = await provider.generateJson({ role: "eval_judge", system: p.system, user: p.user, promptVersion: p.version, sessionId }, JudgeOutputSchema);
    out.push({ messageId: m.id, from: m.from, kind: m.kind, rating: res.parsed });
    await getPool().query(
      `insert into ratings (org_id, session_id, message_id, rater_type, rater_id, realism, legal_accuracy, socratic_quality, voice_consistency, acceptable, notes) values ($1,$2,$3,'judge',$4,$5,$6,$7,$8,$9,$10)`,
      [orgId, sessionId, m.id, p.version, res.parsed.realism, res.parsed.legal_accuracy, res.parsed.socratic_quality, res.parsed.voice_consistency, res.parsed.acceptable, res.parsed.notes],
    );
  }
  return out;
}

/** Cohen's kappa between two binary raters over the same items. */
export function cohensKappa(pairs: { a: boolean; b: boolean }[]): number {
  const n = pairs.length;
  if (!n) return NaN;
  const agree = pairs.filter((p) => p.a === p.b).length / n;
  const pa = pairs.filter((p) => p.a).length / n;
  const pb = pairs.filter((p) => p.b).length / n;
  const chance = pa * pb + (1 - pa) * (1 - pb);
  return chance === 1 ? 1 : (agree - chance) / (1 - chance);
}

/** Kappa between attorney ratings and judge ratings on messages both have rated. */
export async function agreementKappa(): Promise<{ n: number; kappa: number }> {
  const rows = await getPool().query<{ human: boolean; judge: boolean }>(
    `select h.acceptable as human, j.acceptable as judge from ratings h join ratings j on j.message_id = h.message_id and j.rater_type = 'judge' where h.rater_type = 'human'`,
  );
  return { n: rows.rowCount ?? 0, kappa: cohensKappa(rows.rows.map((r) => ({ a: r.human, b: r.judge }))) };
}
