import { randomUUID } from "node:crypto";
import { appendEvent, getPool, getSessionState } from "@rematter/db";
import { openAssignments, type MessageState, type SessionState } from "@rematter/engine";
import { botAssociatePrompt } from "@rematter/prompts";
import { ScenarioIndex, type Assignment, type ScenarioPackage } from "@rematter/scenario";
import { Names, drainJobs, pendingJobCount, threadForPrompt, unlockStaleJobs, type LlmProvider } from "@rematter/worker";
import { z } from "zod";
import type { PathFile } from "./path.js";
import { rng } from "./rng.js";
import { loadBotScript, type BotScript } from "./script.js";

/** How long to wait between checks while the session's next job is retrying or held by another worker. */
const WAIT_MS = 1000;

const BotOutput = z.object({ body: z.string() });

export interface BotRunLog {
  steps: { at: string; action: string; detail: string }[];
  sent: number;
  received: number;
  stuck: boolean;
}

/**
 * Plays the associate against the real engine, database and worker, headless.
 * Loop: drain the worker -> read new world messages -> decide -> send -> repeat,
 * until the session completes or nothing moves.
 */
export class BotAssociate {
  private seen = new Set<string>();
  private random: () => number;
  private plan = new Map<string, { raise: string[]; miss: string[] }>();
  private doctrineAsked = 0;
  private offScriptDone = new Set<string>();
  private gapDone = false;
  private script: BotScript;
  log: BotRunLog = { steps: [], sent: 0, received: 0, stuck: false };

  constructor(
    private readonly sessionId: string,
    private readonly pkg: ScenarioPackage,
    private readonly path: PathFile,
    private readonly provider: LlmProvider,
    private readonly connectionString: string,
    seed = 1,
    private readonly timeoutMs = Number(process.env.PLAYTHROUGH_TIMEOUT_MINUTES ?? 30) * 60_000,
  ) {
    this.random = rng(seed);
    this.script = loadBotScript(pkg.meta.id);
    const idx = new ScenarioIndex(pkg);
    for (const a of pkg.assignments) {
      const raise: string[] = [];
      const miss: string[] = [];
      for (const i of a.issues) {
        const forced = path.force_raise.includes(i.id) ? true : path.force_miss.includes(i.id) ? false : this.random() < path.raise_rate[i.tier];
        (forced ? raise : miss).push(i.id);
      }
      this.plan.set(a.id, { raise, miss });
    }
    void idx;
  }

  get issuePlan() {
    return Object.fromEntries(this.plan);
  }

  async run(maxRounds = 60): Promise<SessionState> {
    const idx = new ScenarioIndex(this.pkg);
    let state = await getSessionState(this.sessionId, this.pkg);
    if (state.status === "not_started") {
      await appendEvent(this.sessionId, { type: "session_started", payload: { scenarioId: this.pkg.meta.id, scenarioVersion: this.pkg.meta.version, engineVersion: state.engineVersion, associateFirstName: "Sam" } }, "associate", this.pkg);
      this.step("session_started", "");
    }
    let idle = 0;
    // Waiting on a job that can't run here yet doesn't use up a round: a retry scheduled after a
    // failed model call (graphile-worker backs off), or a job another worker holds (a deployed
    // worker listening on the same database picks up the session's jobs too).
    const deadline = Date.now() + this.timeoutMs;
    for (let round = 0; round < maxRounds; round++) {
      if (Date.now() > deadline) break;
      await drainJobs({ connectionString: this.connectionString, provider: this.provider });
      state = await getSessionState(this.sessionId, this.pkg);
      if (state.status === "completed") {
        // Let the debrief land. With a real model it can take a while, or another worker may hold it.
        await drainJobs({ connectionString: this.connectionString, provider: this.provider });
        while ((await pendingJobCount(this.sessionId)) > 0 && Date.now() < deadline) {
          await unlockStaleJobs();
          await new Promise((r) => setTimeout(r, WAIT_MS));
          await drainJobs({ connectionString: this.connectionString, provider: this.provider });
        }
        return getSessionState(this.sessionId, this.pkg);
      }
      const fresh = state.messageOrder.map((id) => state.messages[id]!).filter((m) => m.from !== "associate" && !this.seen.has(m.id));
      for (const m of fresh) this.seen.add(m.id);
      this.log.received += fresh.length;
      let acted = false;
      for (const m of fresh) {
        if (await this.react(state, idx, m)) { acted = true; state = await getSessionState(this.sessionId, this.pkg); }
      }
      const pending = acted ? 0 : await pendingJobCount(this.sessionId);
      if (!acted && pending === 0) {
        // Nothing arrived and nothing is queued: try to move an open assignment forward, else give up.
        const moved = await this.nudge(state, idx);
        if (!moved && ++idle >= 2) { this.log.stuck = true; this.step("stuck", `open: ${openAssignments(state).join(",") || "none"}; milestone ${state.currentMilestone}`); return state; }
      } else {
        idle = 0;
        if (!acted && fresh.length === 0) {
          round--;
          // A worker that died holding one of this session's jobs would otherwise block it for hours.
          await unlockStaleJobs();
          await new Promise((r) => setTimeout(r, WAIT_MS));
        }
      }
    }
    this.log.stuck = true;
    this.step("stuck", Date.now() > deadline ? `timed out after ${Math.round(this.timeoutMs / 60000)} min; milestone ${state.currentMilestone}` : "max rounds");
    return state;
  }

  private step(action: string, detail: string) {
    this.log.steps.push({ at: new Date().toISOString(), action, detail });
  }

  /** Decide how to react to one world message. Returns true if an email was sent. */
  private async react(state: SessionState, idx: ScenarioIndex, m: MessageState): Promise<boolean> {
    for (const d of m.attachments) {
      if (!state.documentsOpened.includes(d)) {
        await appendEvent(this.sessionId, { type: "document_opened", payload: { documentId: d } }, "associate", this.pkg);
        this.step("document_opened", d);
      }
    }
    if (m.attachments.length >= 2) await appendEvent(this.sessionId, { type: "documents_compared", payload: { documentIds: [m.attachments[0]!, m.attachments[1]!] } }, "associate", this.pkg);
    const thread = state.threads[m.threadId]!;
    if (m.kind === "recap" || m.kind === "nudge" || m.kind === "debrief" || m.kind === "doctrine" || m.kind === "reply") return false;

    // Off-script behaviors, once each.
    const sc = this.script;
    if (this.path.behaviors.off_script && m.beatId === sc.probe_beat && !this.offScriptDone.has("off_script")) {
      this.offScriptDone.add("off_script");
      await this.send(null, sc.off_script.to, [], sc.off_script.subject, sc.off_script.body, "question");
    }
    if (this.path.behaviors.gap_days > 0 && !this.gapDone && m.beatId === sc.gap_beat) {
      this.gapDone = true;
      await appendEvent(this.sessionId, { type: "session_resumed", payload: { gapDays: this.path.behaviors.gap_days } }, "api", this.pkg);
      this.step("session_resumed", `gap ${this.path.behaviors.gap_days}d`);
    }
    if (this.path.behaviors.doctrine_questions > this.doctrineAsked && m.beatId === sc.probe_beat) {
      this.doctrineAsked++;
      const q = this.path.behaviors.asks_for_answer ? sc.doctrine.asks_for_answer : sc.doctrine.general;
      await this.send(null, ["practice_support"], [], "Question", q, null);
    }

    // Deliverable due on this thread?
    const asgId = thread.assignmentIds.find((a) => state.assignments[a]?.status === "open") ?? (m.beatId ? this.pkg.beats.find((b) => b.id === m.beatId)?.opens_assignment : undefined);
    const asg = asgId && state.assignments[asgId]?.status === "open" ? idx.assignment(asgId) : undefined;
    if (asg && asg.completion.kind === "deliverable" && (m.kind === "beat" || m.kind === "interruption") && (m.beatId ? this.pkg.beats.find((b) => b.id === m.beatId)?.opens_assignment === asg.id : true)) {
      if (this.path.behaviors.asks_for_answer && !this.offScriptDone.has(`ask:${asg.id}`)) {
        this.offScriptDone.add(`ask:${asg.id}`);
        await this.send(m.threadId, [asg.assigned_by], [], null, `Before I start: could you just tell me what the main issues are on this so I make sure I cover them?`, "question");
      }
      return this.deliver(state, idx, asg, m);
    }
    if (asg && asg.completion.kind === "replies") {
      const body = thread.associateMessageCount === 0 ? sc.replies.first : sc.replies.later;
      await this.send(m.threadId, [m.from], [], null, body, thread.associateMessageCount === 0 ? "acknowledgment" : "question");
      return true;
    }
    if (m.kind === "interruption") {
      await this.send(m.threadId, [m.from], m.cc.filter((c) => c !== "associate"), null, sc.interruption_reply, "question");
      return true;
    }
    if (m.kind === "reflection") {
      const body = this.path.reasoning_style === "thin" ? sc.reflection_reply.thin : sc.reflection_reply.full;
      await this.send(m.threadId, [m.from], [], null, body, "question");
      return true;
    }
    return false;
  }

  private async deliver(state: SessionState, idx: ScenarioIndex, asg: Assignment, trigger: MessageState): Promise<boolean> {
    const plan = this.plan.get(asg.id)!;
    const position = asg.decision_points[0] ? this.path.positions[asg.decision_points[0].id] ?? null : null;
    const names = new Names(this.pkg, state.associateFirstName);
    const prompt = botAssociatePrompt({ dealType: this.pkg.meta.deal_type,
      persona: this.path.persona, thread: threadForPrompt(state, trigger.threadId, names), assignment: asg, raise: plan.raise, miss: plan.miss, position, reasoningStyle: this.path.reasoning_style,
      instruction: `Write the deliverable for this assignment as an email to ${asg.expected_recipients.map((r) => names.name(r)).join(" and ")}.`,
    });
    const raise = asg.issues.filter((i) => plan.raise.includes(i.id)).map((i) => ({ title: i.title, looks: i.raised_looks_like }));
    const positionLabel = asg.decision_points[0]?.positions.find((p) => p.id === position)?.description ?? null;
    const res = await this.provider.generateJson({ role: "bot_associate", system: prompt.system, user: prompt.user, promptVersion: prompt.version, mockContext: { raise, positionLabel, reasoningStyle: this.path.reasoning_style, opening: `Here is my ${asg.title.toLowerCase()}.` } }, BotOutput);
    // Markers let the mock assessor read the plan exactly; the real assessor ignores them because they are stripped here for real providers.
    const markers = this.provider.name === "mock"
      ? "\n\n" + [...plan.raise.map((i) => `[${i}:raised]`), ...plan.miss.map((i) => `[${i}:missed]`), ...(position && asg.decision_points[0] ? [`[${asg.decision_points[0].id}:${position}]`] : [])].join(" ")
      : "";
    const to = asg.expected_recipients;
    const cc = asg.expected_recipients.includes("client_contact") && !to.includes("partner") ? ["partner"] : [];
    await this.send(this.threadIdFor(state, asg.thread_key, trigger.threadId), to, cc, null, res.parsed.body + markers, null);
    this.step("deliverable", `${asg.id} raise=${plan.raise.join(",")} miss=${plan.miss.join(",")} position=${position ?? "-"}`);
    return true;
  }

  private threadIdFor(state: SessionState, key: string, fallback: string): string {
    return state.threadIdByKey[key] ?? fallback;
  }

  /** Try to progress when the inbox is quiet: deliver any open deliverable assignment we have not answered. */
  private async nudge(state: SessionState, idx: ScenarioIndex): Promise<boolean> {
    for (const aid of openAssignments(state)) {
      const asg = idx.assignment(aid);
      if (asg.completion.kind !== "deliverable") continue;
      const tid = state.threadIdByKey[asg.thread_key];
      const last = tid ? state.threads[tid]!.messageIds.map((i) => state.messages[i]!).filter((m) => m.from !== "associate").at(-1) : undefined;
      if (last) { this.step("nudge", aid); return this.deliver(state, idx, asg, last); }
    }
    return false;
  }

  private async send(threadId: string | null, to: string[], cc: string[], subject: string | null, body: string, intent: "deliverable" | "question" | "logistics" | "acknowledgment" | null) {
    const messageId = randomUUID();
    await appendEvent(this.sessionId, {
      type: "email_sent",
      payload: { messageId, threadId: threadId ?? randomUUID(), subject, to, cc, body, attachments: [], intent },
    }, "associate", this.pkg);
    this.log.sent++;
    this.step("email_sent", `to=${to.join(",")} intent=${intent ?? "?"} len=${body.length}`);
  }
}

export async function pendingJobs(sessionId: string) {
  return getPool().query(`select task_identifier, run_at, attempts, last_error from graphile_worker.jobs where queue_name = $1`, [`session:${sessionId}`]);
}
