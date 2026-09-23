import { getPool } from "@aporia/db";
import type { SessionState } from "@aporia/engine";
import { JudgeOutputSchema, characterCard, judgePrompt, renderThread, type JudgeOutput } from "@aporia/prompts";
import { ScenarioIndex, type ScenarioPackage } from "@aporia/scenario";
import { Names, threadForPrompt, type LlmProvider } from "@aporia/worker";

export interface JudgedMessage { messageId: string; from: string; kind: string; rating: JudgeOutput }

/** Offline judge: rates every character email in a session and stores ratings as rater_type = judge. */
export async function judgeSession(sessionId: string, orgId: string, state: SessionState, pkg: ScenarioPackage, provider: LlmProvider): Promise<JudgedMessage[]> {
  const idx = new ScenarioIndex(pkg);
  const names = new Names(pkg, state.associateFirstName);
  const out: JudgedMessage[] = [];
  for (const id of state.messageOrder) {
    const m = state.messages[id]!;
    if (m.from === "associate" || m.kind === "doctrine") continue;
    const c = idx.character(m.from);
    const thread = threadForPrompt(state, m.threadId, names).filter((t) => t.body !== m.body);
    const hints = (state.threads[m.threadId]?.assignmentIds ?? []).flatMap((a) => idx.assignment(a).issues.map((i) => `${i.title}: ${i.raised_looks_like}`));
    const p = judgePrompt({ characterCard: characterCard(c), thread: renderThread(thread), email: m.body, answerKeyHints: hints, isSocratic: m.kind === "reflection" });
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
