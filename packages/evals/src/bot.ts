import { randomUUID } from "node:crypto";
import { appendEvent, getPool, getSessionState } from "@aporia/db";
import { openAssignments, openDecisionPoints, type MessageState, type SessionState } from "@aporia/engine";
import { botAssociatePrompt } from "@aporia/prompts";
import { ScenarioIndex, type Assignment, type ScenarioPackage } from "@aporia/scenario";
import { Names, drainJobs, pendingJobCount, threadForPrompt, type LlmProvider } from "@aporia/worker";
import { z } from "zod";
import type { PathFile } from "./path.js";
import { rng } from "./rng.js";

const BotOutput = z.object({ body: z.string(), rationale: z.string().nullable() });

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
  log: BotRunLog = { steps: [], sent: 0, received: 0, stuck: false };

  constructor(
    private readonly sessionId: string,
    private readonly pkg: ScenarioPackage,
    private readonly path: PathFile,
    private readonly provider: LlmProvider,
    private readonly connectionString: string,
    seed = 1,
  ) {
    this.random = rng(seed);
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
    for (let round = 0; round < maxRounds; round++) {
      await drainJobs({ connectionString: this.connectionString, provider: this.provider });
      state = await getSessionState(this.sessionId, this.pkg);
      if (state.status === "completed") {
        // Let the debrief land.
        await drainJobs({ connectionString: this.connectionString, provider: this.provider });
        return getSessionState(this.sessionId, this.pkg);
      }
      const fresh = state.messageOrder.map((id) => state.messages[id]!).filter((m) => m.from !== "associate" && !this.seen.has(m.id));
      for (const m of fresh) this.seen.add(m.id);
      this.log.received += fresh.length;
      let acted = false;
      for (const m of fresh) {
        if (await this.react(state, idx, m)) { acted = true; state = await getSessionState(this.sessionId, this.pkg); }
      }
      if (!acted && (await pendingJobCount(this.sessionId)) === 0) {
        // Nothing arrived and nothing is queued: try to move an open assignment forward, else give up.
        const moved = await this.nudge(state, idx);
        if (!moved && ++idle >= 2) { this.log.stuck = true; this.step("stuck", `open: ${openAssignments(state).join(",") || "none"}; milestone ${state.currentMilestone}`); return state; }
      } else idle = 0;
    }
    this.log.stuck = true;
    this.step("stuck", "max rounds");
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
    if (m.kind === "recap" || m.kind === "debrief" || m.kind === "doctrine" || m.kind === "reply") return false;

    // Off-script behaviors, once each.
    if (this.path.behaviors.off_script && m.beatId === "B-M2-term-sheet" && !this.offScriptDone.has("lender_wrong_topic")) {
      this.offScriptDone.add("lender_wrong_topic");
      await this.send(null, ["lenders_counsel"], [], "Quick question on the term sheet", "Hi Jordan, we got the term sheet from Priya. Could you tell me what the Bank's minimum cash covenant will be so I can prepare comments?", null, "question");
    }
    if (this.path.behaviors.gap_days > 0 && !this.gapDone && m.beatId === "B-M3-doc-set") {
      this.gapDone = true;
      await appendEvent(this.sessionId, { type: "session_resumed", payload: { gapDays: this.path.behaviors.gap_days } }, "api", this.pkg);
      this.step("session_resumed", `gap ${this.path.behaviors.gap_days}d`);
    }
    if (this.path.behaviors.doctrine_questions > this.doctrineAsked && m.beatId === "B-M2-term-sheet") {
      this.doctrineAsked++;
      const q = this.path.behaviors.asks_for_answer
        ? "Northlake Compute is borrowing $100,000,000 from Halden Bank with IP excluded. Should we push back on the negative pledge? What should I tell the client?"
        : "What is a negative pledge, and how does it differ from a security interest under UCC Article 9?";
      await this.send(null, ["practice_support"], [], "Question", q, null, null);
    }

    // Deliverable due on this thread?
    const asgId = thread.assignmentIds.find((a) => state.assignments[a]?.status === "open") ?? (m.beatId ? this.pkg.beats.find((b) => b.id === m.beatId)?.opens_assignment : undefined);
    const asg = asgId && state.assignments[asgId]?.status === "open" ? idx.assignment(asgId) : undefined;
    if (asg && asg.completion.kind === "deliverable" && (m.kind === "beat" || m.kind === "interruption") && (m.beatId ? this.pkg.beats.find((b) => b.id === m.beatId)?.opens_assignment === asg.id : true)) {
      if (this.path.behaviors.asks_for_answer && !this.offScriptDone.has(`ask:${asg.id}`)) {
        this.offScriptDone.add(`ask:${asg.id}`);
        await this.send(m.threadId, [asg.assigned_by], [], null, `Before I start: could you just tell me what the main issues are on this so I make sure I cover them?`, null, "question");
      }
      return this.deliver(state, idx, asg, m);
    }
    if (asg && asg.completion.kind === "replies") {
      const body = thread.associateMessageCount === 0 ? "Thanks Marcus, I've read this and I'm ready for the questions." : "1. I think the lender is underwriting the equity round and the enterprise value behind it rather than cash flow. 2. IP is what the company's value rests on; equipment is replaceable. 3. Tranche 1 gating on the Series C protects the Bank from funding a company that cannot raise.";
      await this.send(m.threadId, [m.from], [], null, body, null, thread.associateMessageCount === 0 ? "acknowledgment" : "question");
      return true;
    }
    if (m.kind === "interruption") {
      await this.send(m.threadId, [m.from], m.cc.filter((c) => c !== "associate"), null, "Short answer for the board: no. Under Section 2.1 and Section 3.2(d), Tranche 1 can only be drawn after the Series C closes, and then within the 30-day availability window. Happy to walk through it after the call.", null, "question");
      return true;
    }
    if (m.kind === "reflection") {
      const body = this.path.rationale_style === "thin"
        ? "Good questions. I'll think about them."
        : "Taking these in turn: the company would lose the ability to raise against its IP later, so the exclusion matters more than the equipment. I'd expect the Bank to want a negative pledge and a lien on IP proceeds, in the negative covenants and the collateral description. And besides IP, leased real estate and equipment under existing financing would fall outside what the Bank can actually reach.";
      await this.send(m.threadId, [m.from], [], null, body, null, "question");
      return true;
    }
    return false;
  }

  private async deliver(state: SessionState, idx: ScenarioIndex, asg: Assignment, trigger: MessageState): Promise<boolean> {
    const plan = this.plan.get(asg.id)!;
    const position = asg.decision_points[0] ? this.path.positions[asg.decision_points[0].id] ?? null : null;
    const names = new Names(this.pkg, state.associateFirstName);
    const prompt = botAssociatePrompt({
      persona: this.path.persona, thread: threadForPrompt(state, trigger.threadId, names), assignment: asg, raise: plan.raise, miss: plan.miss, position, rationaleStyle: this.path.rationale_style,
      instruction: `Write the deliverable for this assignment as an email to ${asg.expected_recipients.map((r) => names.name(r)).join(" and ")}.`,
    });
    const raise = asg.issues.filter((i) => plan.raise.includes(i.id)).map((i) => ({ title: i.title, looks: i.raised_looks_like }));
    const positionLabel = asg.decision_points[0]?.positions.find((p) => p.id === position)?.description ?? null;
    const res = await this.provider.generateJson({ role: "bot_associate", system: prompt.system, user: prompt.user, promptVersion: prompt.version, mockContext: { raise, positionLabel, rationaleStyle: this.path.rationale_style, opening: `Here is my ${asg.title.toLowerCase()}.` } }, BotOutput);
    // Markers let the mock assessor read the plan exactly; the real assessor ignores them because they are stripped here for real providers.
    const markers = this.provider.name === "mock"
      ? "\n\n" + [...plan.raise.map((i) => `[${i}:raised]`), ...plan.miss.map((i) => `[${i}:missed]`), ...(position && asg.decision_points[0] ? [`[${asg.decision_points[0].id}:${position}]`] : [])].join(" ")
      : "";
    const dps = openDecisionPoints(state, this.pkg, trigger.threadId, asg.expected_recipients);
    const to = asg.expected_recipients;
    const cc = asg.expected_recipients.includes("client_contact") && !to.includes("partner") ? ["partner"] : [];
    await this.send(this.threadIdFor(state, asg.thread_key, trigger.threadId), to, cc, null, res.parsed.body + markers, dps[0] ? { rationale: res.parsed.rationale, decisionPointId: dps[0].id } : null, null);
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

  private async send(threadId: string | null, to: string[], cc: string[], subject: string | null, body: string, sheet: { rationale: string | null; decisionPointId: string } | null, intent: "deliverable" | "question" | "logistics" | "acknowledgment" | null) {
    const messageId = randomUUID();
    await appendEvent(this.sessionId, {
      type: "email_sent",
      payload: { messageId, threadId: threadId ?? randomUUID(), subject, to, cc, body, attachments: [], rationale: sheet?.rationale ?? null, decisionPointId: sheet?.decisionPointId ?? null, intent },
    }, "associate", this.pkg);
    this.log.sent++;
    this.step("email_sent", `to=${to.join(",")} intent=${intent ?? "?"} len=${body.length}`);
  }
}

export async function pendingJobs(sessionId: string) {
  return getPool().query(`select task_identifier, run_at, attempts, last_error from graphile_worker.jobs where queue_name = $1`, [`session:${sessionId}`]);
}
