import { ScenarioIndex, type Assignment, type Beat, type Character, type DecisionPoint, type ScenarioPackage } from "@aporia/scenario";
import { evaluate } from "./conditions.js";
import { cloneState } from "./state.js";
import type {
  AssignmentState, Effect, EmailSentEvent, EngineEvent, Intent, Job, MessageState, SessionState, StepOptions, StepResult, ThreadState,
} from "./types.js";

const RECAP_GAP_DAYS = 3;

/**
 * The simulation engine. Pure: no network, no randomness, no clock other than event.at.
 * Returns a new state (the input is never mutated) and the effects the caller must act on.
 */
export function step(prev: SessionState, event: EngineEvent, pkg: ScenarioPackage, opts: StepOptions = {}): StepResult {
  const idx = new ScenarioIndex(pkg);
  const ctx = new Ctx(cloneState(prev), idx, opts, event.at);
  ctx.state.eventCount += 1;

  switch (event.type) {
    case "session_started":
      ctx.onSessionStarted(event.payload.associateFirstName);
      break;
    case "session_resumed":
      ctx.onSessionResumed(event.payload.gapDays);
      break;
    case "email_sent":
      ctx.onEmailSent(event);
      break;
    case "intent_classified":
      ctx.onIntentClassified(event.payload.messageId, event.payload.intent);
      break;
    case "assessment_recorded":
      ctx.onAssessment(event.payload.messageId, event.payload.assignmentId, event.payload.issues, event.payload.decisions, event.payload.shadow ?? false);
      break;
    case "message_delivered":
      ctx.onMessageDelivered(event);
      break;
    case "message_held":
      ctx.state.jobs[event.payload.jobKey] = "held";
      break;
    case "message_released":
      // The release itself appends a message_delivered event; nothing to do here.
      break;
    case "document_opened":
      if (!ctx.state.documentsOpened.includes(event.payload.documentId)) ctx.state.documentsOpened.push(event.payload.documentId);
      ctx.touch();
      break;
    case "documents_compared":
      ctx.touch();
      break;
    case "job_completed":
      ctx.state.jobs[event.payload.jobKey] = "completed";
      break;
    case "job_failed":
      ctx.state.jobs[event.payload.jobKey] = "failed";
      break;
    case "flag_raised":
      break;
  }

  // Beats and milestone transitions are re-evaluated after every event until stable.
  ctx.settle();
  return { state: ctx.state, effects: ctx.effects };
}

/** Rebuilds state by replaying events in order. */
export function replay(events: EngineEvent[], pkg: ScenarioPackage, initial: SessionState, opts: StepOptions = {}): SessionState {
  let s = initial;
  for (const e of events) s = step(s, e, pkg, opts).state;
  return s;
}

class Ctx {
  effects: Effect[] = [];
  constructor(
    public state: SessionState,
    private idx: ScenarioIndex,
    private opts: StepOptions,
    private at: string,
  ) {}

  touch() {
    this.state.lastActivityAt = this.at;
  }

  // ---------------------------------------------------------------- session
  onSessionStarted(firstName: string) {
    const s = this.state;
    if (s.status !== "not_started") return;
    s.status = "in_progress";
    s.startedAt = this.at;
    s.associateFirstName = firstName;
    this.touch();
    this.enterMilestone(this.idx.firstMilestone.id);
  }

  onSessionResumed(gapDays: number) {
    if (this.state.status !== "in_progress") return;
    this.touch();
    if (gapDays >= RECAP_GAP_DAYS) {
      // The recap goes out before anything else; the session lane is serial.
      this.enqueue({ key: `recap:${this.state.eventCount}`, kind: "recap", delaySeconds: 0, payload: { kind: "recap", resumedAt: this.at, gapDays } });
      this.state.lastRecapAt = this.at;
    }
  }

  // ---------------------------------------------------------------- email from the associate
  onEmailSent(event: EmailSentEvent) {
    const p = event.payload;
    const s = this.state;
    if (s.status === "not_started") { this.warn("email_sent before session_started"); return; }
    this.touch();
    const thread = this.ensureThread(p.threadId, null, p.subject ?? "(no subject)", ["associate", ...p.to, ...p.cc]);
    const isDoctrine = p.to.includes(this.idx.doctrineAssistant.id) || p.cc.includes(this.idx.doctrineAssistant.id);
    if (isDoctrine) thread.hidden = true;

    const intent: Intent | null = p.notMyAnswerYet ? "question" : p.intent ?? null;
    const msg: MessageState = {
      id: p.messageId, threadId: p.threadId, from: "associate", to: p.to, cc: p.cc,
      subject: thread.subject, body: p.body, attachments: p.attachments, at: this.at, kind: "associate",
      intent, rationale: p.rationale ?? null, decisionPointId: p.decisionPointId ?? null, beatId: null,
      assignmentId: null, reflectionQuestions: [], quotedRefs: p.quotedRefs ?? [],
    };
    this.addMessage(msg);
    thread.associateMessageCount += 1;
    thread.lastIntent = intent;

    // Count the email against every open assignment on this thread.
    for (const aid of thread.assignmentIds) {
      const a = s.assignments[aid];
      if (a && a.status === "open") a.emailsSent += 1;
    }

    if (isDoctrine) {
      // The doctrine assistant sees only the question text. Nothing else happens.
      this.enqueue({ key: `doctrine:${p.messageId}`, kind: "doctrine_answer", delaySeconds: this.delayFor(this.idx.doctrineAssistant, `doctrine:${p.messageId}`), payload: { kind: "doctrine_answer", messageId: p.messageId, threadId: p.threadId } });
      return;
    }

    // Reply-count completions (for example the orientation self-check).
    for (const aid of [...thread.assignmentIds]) {
      const asg = this.idx.assignment(aid);
      const st = s.assignments[aid]!;
      if (st.status === "open" && asg.completion.kind === "replies" && thread.associateMessageCount >= asg.completion.count) {
        this.completeAssignment(aid, p.messageId);
      }
    }

    if (intent) this.routeByIntent(msg, intent);
    else this.enqueue({ key: `classify:${p.messageId}`, kind: "classify_intent", delaySeconds: 0, payload: { kind: "classify_intent", messageId: p.messageId } });
  }

  onIntentClassified(messageId: string, intent: Intent) {
    const msg = this.state.messages[messageId];
    if (!msg) { this.warn(`intent_classified for unknown message ${messageId}`); return; }
    if (msg.intent) return; // already routed at send time
    msg.intent = intent;
    const thread = this.state.threads[msg.threadId];
    if (thread) thread.lastIntent = intent;
    this.routeByIntent(msg, intent);
  }

  /** Decides what the world does with an associate email once its intent is known. */
  private routeByIntent(msg: MessageState, intent: Intent) {
    const thread = this.state.threads[msg.threadId]!;
    const beatsTriggeredHere = this.settleBeats().filter((b) => b.thread_key === thread.key);

    if (intent === "deliverable") {
      const assignment = this.resolveAssignmentForDeliverable(msg);
      if (assignment && (assignment.issues.length > 0 || assignment.decision_points.length > 0)) {
        msg.assignmentId = assignment.id;
        this.state.assignments[assignment.id]!.deliverableMessageId = msg.id;
        this.enqueue({ key: `assess:${msg.id}`, kind: "assess", delaySeconds: 0, payload: { kind: "assess", messageId: msg.id, assignmentId: assignment.id } });
        return;
      }
    }
    if (intent === "acknowledgment") return; // real colleagues don't reply to "thanks"
    if (beatsTriggeredHere.length > 0) return; // a scripted beat answers this email

    const responder = this.pickResponder(msg);
    if (!responder) return;
    this.enqueue({
      key: `reply:${msg.id}:${responder.id}`,
      kind: "character_reply",
      delaySeconds: this.delayFor(responder, `reply:${msg.id}`),
      payload: { kind: "character_reply", messageId: msg.id, characterId: responder.id, threadId: msg.threadId },
    });
  }

  private pickResponder(msg: MessageState): Character | undefined {
    const candidates = [...msg.to, ...msg.cc].filter((x) => x !== "associate" && this.idx.characters.has(x));
    const id = candidates.find((c) => !this.idx.character(c).is_doctrine_assistant);
    return id ? this.idx.character(id) : undefined;
  }

  /** The open assignment on this thread, else the open assignment whose expected recipients were addressed. */
  private resolveAssignmentForDeliverable(msg: MessageState): Assignment | undefined {
    const thread = this.state.threads[msg.threadId]!;
    const open = (aid: string) => this.state.assignments[aid]?.status === "open";
    const onThread = thread.assignmentIds.filter(open).map((a) => this.idx.assignment(a)).find((a) => a.completion.kind === "deliverable");
    if (onThread) return onThread;
    const recipients = new Set([...msg.to, ...msg.cc]);
    const current = this.state.currentMilestone ? this.idx.milestone(this.state.currentMilestone).assignments : [];
    for (const aid of [...current, ...Object.keys(this.state.assignments)]) {
      if (!open(aid)) continue;
      const a = this.idx.assignment(aid);
      if (a.completion.kind === "deliverable" && a.expected_recipients.some((r) => recipients.has(r))) {
        if (!thread.assignmentIds.includes(aid)) thread.assignmentIds.push(aid);
        return a;
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------- assessment
  onAssessment(messageId: string, assignmentId: string, issues: Record<string, "raised" | "partial" | "missed">, decisions: Record<string, string>, shadow: boolean) {
    const s = this.state;
    const asg = this.idx.assignments.get(assignmentId);
    if (!asg) { this.warn(`assessment for unknown assignment ${assignmentId}`); return; }
    const msg = s.messages[messageId];
    const shadowMode = shadow || this.opts.assessorShadowMode === true;

    // Every issue on the assignment gets a status; anything the assessor did not mention is missed.
    for (const i of asg.issues) s.issues[i.id] = issues[i.id] ?? "missed";
    for (const d of asg.decision_points) {
      const pos = decisions[d.id];
      if (pos && d.positions.some((p) => p.id === pos)) s.decisions[d.id] = { position: pos, rationale: msg?.rationale ?? null, messageId };
    }
    if (msg) msg.assignmentId = assignmentId;

    if (!shadowMode) {
      for (const c of this.idx.pkg.consequences) {
        if (s.consequences[c.id]) continue;
        const seedHit = "issue" in c.seed
          ? c.seed.issue in issues || asg.issues.some((i) => i.id === (c.seed as { issue: string }).issue)
            ? s.issues[c.seed.issue] === c.seed.outcome
            : false
          : s.decisions[c.seed.decision_point]?.position === c.seed.outcome;
        if (seedHit) {
          s.consequences[c.id] = "seeded";
          this.effects.push({ type: "consequence_seeded", consequenceId: c.id });
        }
      }
    }

    const st = s.assignments[assignmentId]!;
    if (st.status === "open" && asg.completion.kind === "deliverable" && !shadowMode) this.completeAssignment(assignmentId, messageId);

    // Socratic follow-up from the feedback character, aimed by the assessment.
    const feedback = this.idx.character(asg.feedback_from);
    if (msg) {
      this.enqueue({
        key: `reflect:${messageId}`,
        kind: "reflection",
        delaySeconds: this.delayFor(feedback, `reflect:${messageId}`),
        payload: { kind: "reflection", messageId, assignmentId, characterId: feedback.id, threadId: msg.threadId },
      });
    }
  }

  // ---------------------------------------------------------------- world messages
  onMessageDelivered(event: Extract<EngineEvent, { type: "message_delivered" }>) {
    const p = event.payload;
    const s = this.state;
    const thread = this.ensureThread(p.threadId, p.threadKey ?? null, p.subject, [p.from, ...p.to, ...p.cc]);
    if (p.kind === "doctrine") thread.hidden = true;
    const msg: MessageState = {
      id: p.messageId, threadId: p.threadId, from: p.from, to: p.to, cc: p.cc, subject: p.subject || thread.subject, body: p.body,
      attachments: p.attachments, at: this.at, kind: p.kind, intent: null, rationale: null, decisionPointId: null,
      beatId: p.beatId ?? null, assignmentId: null, reflectionQuestions: p.reflectionQuestions ?? [], quotedRefs: [],
    };
    this.addMessage(msg);
    for (const d of p.attachments) if (!s.documentsReleased.includes(d)) s.documentsReleased.push(d);
    for (const q of p.reflectionQuestions ?? []) s.reflectionQuestionsAsked.push(q);
    if (p.jobKey) s.jobs[p.jobKey] = "completed";
    if (p.beatId) {
      s.beats[p.beatId] = "delivered";
      const beat = this.idx.pkg.beats.find((b) => b.id === p.beatId);
      if (beat?.opens_assignment) this.openAssignment(beat.opens_assignment, p.threadId);
    }
  }

  // ---------------------------------------------------------------- milestones and assignments
  private enterMilestone(id: string) {
    const s = this.state;
    const m = s.milestones[id]!;
    if (m.enteredAt) return;
    m.enteredAt = this.at;
    s.currentMilestone = id;
    this.effects.push({ type: "milestone_entered", milestoneId: id });
    // Consequences whose payoff is this milestone fire on entry; their beats then trigger.
    for (const c of this.idx.pkg.consequences) {
      if (c.payoff_milestone === id && s.consequences[c.id] === "seeded") {
        s.consequences[c.id] = "fired";
        this.effects.push({ type: "consequence_fired", consequenceId: c.id });
      }
    }
  }

  private completeMilestone(id: string) {
    const s = this.state;
    const m = s.milestones[id]!;
    if (m.completedAt) return;
    m.completedAt = this.at;
    this.effects.push({ type: "milestone_reached", milestoneId: id });
    const next = this.idx.nextMilestone(id);
    if (!next) {
      s.status = "completed";
      s.completedAt = this.at;
      this.effects.push({ type: "session_completed" });
      this.enqueue({ key: "debrief", kind: "debrief", delaySeconds: this.delayFor(this.idx.character("partner"), "debrief"), payload: { kind: "debrief" } });
    }
  }

  private openAssignment(id: string, threadId: string) {
    const st = this.state.assignments[id]!;
    if (st.status !== "pending") return;
    st.status = "open";
    st.openedAt = this.at;
    const thread = this.state.threads[threadId];
    if (thread && !thread.assignmentIds.includes(id)) thread.assignmentIds.push(id);
    this.effects.push({ type: "assignment_opened", assignmentId: id });
  }

  private completeAssignment(id: string, messageId: string) {
    const st: AssignmentState = this.state.assignments[id]!;
    if (st.status === "complete") return;
    st.status = "complete";
    st.completedAt = this.at;
    st.deliverableMessageId = st.deliverableMessageId ?? messageId;
    this.effects.push({ type: "assignment_completed", assignmentId: id });
  }

  /** Re-evaluates milestone exits/entries and beat triggers until nothing changes. */
  settle() {
    for (let guard = 0; guard < 20; guard++) {
      let changed = false;
      const cur = this.state.currentMilestone;
      if (cur && this.state.status !== "not_started") {
        const m = this.idx.milestone(cur);
        if (!this.state.milestones[cur]!.completedAt && evaluate(m.exit, this.state)) {
          this.completeMilestone(cur);
          changed = true;
        }
        if (this.state.milestones[cur]!.completedAt) {
          const next = this.idx.nextMilestone(cur);
          if (next && !this.state.milestones[next.id]!.enteredAt && evaluate(next.entry, this.state)) {
            this.enterMilestone(next.id);
            changed = true;
          }
        }
      }
      if (this.settleBeats().length > 0) changed = true;
      if (!changed) break;
    }
  }

  /** Enqueues every beat whose trigger now holds. Returns the beats enqueued in this pass. */
  settleBeats(): Beat[] {
    if (this.state.status === "not_started") return [];
    const out: Beat[] = [];
    for (const b of this.idx.pkg.beats) {
      if (this.state.beats[b.id]) continue;
      if (!b.after.every((a) => this.state.beats[a])) continue;
      if (!evaluate(b.trigger, this.state)) continue;
      this.state.beats[b.id] = "enqueued";
      const sender = this.idx.character(b.sender);
      this.enqueue({
        key: `beat:${b.id}`,
        kind: "beat",
        delaySeconds: b.delay_seconds ?? this.delayFor(sender, `beat:${b.id}`),
        payload: { kind: "beat", beatId: b.id },
      });
      out.push(b);
    }
    return out;
  }

  // ---------------------------------------------------------------- helpers
  private ensureThread(id: string, key: string | null, subject: string, participants: string[]): ThreadState {
    const s = this.state;
    let t = s.threads[id];
    if (!t) {
      t = { id, key, subject, participants: [], messageIds: [], assignmentIds: [], associateMessageCount: 0, lastIntent: null, lastMessageAt: this.at, hidden: false };
      s.threads[id] = t;
      if (key && !s.threadIdByKey[key]) s.threadIdByKey[key] = id;
      if (key) for (const a of this.idx.assignmentsByThread.get(key) ?? []) if (!t.assignmentIds.includes(a.id)) t.assignmentIds.push(a.id);
    } else if (key && !t.key) {
      t.key = key;
      if (!s.threadIdByKey[key]) s.threadIdByKey[key] = id;
    }
    for (const p of participants) if (!t.participants.includes(p)) t.participants.push(p);
    t.lastMessageAt = this.at;
    return t;
  }

  private addMessage(m: MessageState) {
    const s = this.state;
    if (s.messages[m.id]) return;
    s.messages[m.id] = m;
    s.messageOrder.push(m.id);
    s.threads[m.threadId]!.messageIds.push(m.id);
  }

  private enqueue(job: Job) {
    if (this.state.jobs[job.key]) return; // idempotent
    this.state.jobs[job.key] = "enqueued";
    this.effects.push({ type: "enqueue_job", job });
  }

  /** Deterministic delay inside the character's window, keyed by the job so replays agree. */
  private delayFor(c: Character, key: string): number {
    if (this.opts.zeroDelays) return 0;
    const { min, max } = c.reply_delay_seconds;
    if (max <= min) return min;
    let h = 2166136261;
    for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return min + (h % (max - min + 1));
  }

  private warn(message: string) {
    this.effects.push({ type: "warning", message });
  }
}

// ---------------------------------------------------------------- read helpers used by the API and worker

/** Decision points on this thread that are still open: drives the at-send sheet. */
export function openDecisionPoints(state: SessionState, pkg: ScenarioPackage, threadId: string | null, recipients: string[] = []): (DecisionPoint & { assignment: string })[] {
  const idx = new ScenarioIndex(pkg);
  const out: (DecisionPoint & { assignment: string })[] = [];
  const candidates = new Set<string>();
  const thread = threadId ? state.threads[threadId] : undefined;
  for (const a of thread?.assignmentIds ?? []) candidates.add(a);
  const rec = new Set(recipients);
  for (const [aid, st] of Object.entries(state.assignments)) {
    if (st.status !== "open") continue;
    const a = idx.assignment(aid);
    if (a.expected_recipients.some((r) => rec.has(r))) candidates.add(aid);
  }
  for (const aid of candidates) {
    if (state.assignments[aid]?.status !== "open") continue;
    for (const d of idx.assignment(aid).decision_points) if (!state.decisions[d.id]) out.push({ ...d, assignment: aid });
  }
  return out;
}

/** Threads a character is a participant of, excluding hidden doctrine threads for everyone but the assistant. */
export function threadsVisibleTo(state: SessionState, characterId: string): ThreadState[] {
  return Object.values(state.threads).filter((t) => t.participants.includes(characterId) && (!t.hidden || t.participants.includes(characterId)));
}

export function messagesOnThread(state: SessionState, threadId: string): MessageState[] {
  return (state.threads[threadId]?.messageIds ?? []).map((id) => state.messages[id]!);
}

export function openAssignments(state: SessionState): string[] {
  return Object.entries(state.assignments).filter(([, s]) => s.status === "open").map(([id]) => id);
}
