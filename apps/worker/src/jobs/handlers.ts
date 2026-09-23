import {
  AssessmentOutputSchema, IntentOutputSchema, ReflectionOutputSchema, assessorPrompt, characterWriterPrompt, debriefPrompt, doctrinePrompt,
  intentClassifierPrompt, recapPrompt, reflectionPrompt, type AssessmentOutput,
} from "@aporia/prompts";
import { openAssignments } from "@aporia/engine";
import type { Job } from "@aporia/engine";
import { formatFact, sliceFactsFor, type Facts } from "@aporia/scenario";
import { otherThreadsFor, storyDate, threadForPrompt } from "../context.js";
import { beatSubject, deliverFixed, generateAndDeliver, threadIdForKey } from "./deliver.js";
import type { JobContext, JobOutcome } from "./types.js";

export async function handleJob(ctx: JobContext): Promise<JobOutcome> {
  const p = ctx.job.payload;
  switch (p.kind) {
    case "classify_intent": return classifyIntent(ctx, p.messageId);
    case "assess": return assess(ctx, p.messageId, p.assignmentId);
    case "character_reply": return characterReply(ctx, p.messageId, p.characterId, p.threadId);
    case "beat": return beat(ctx, p.beatId);
    case "reflection": return reflection(ctx, p.messageId, p.assignmentId, p.characterId, p.threadId);
    case "doctrine_answer": return doctrine(ctx, p.messageId, p.threadId);
    case "recap": return recap(ctx, p.gapDays);
    case "debrief": return debrief(ctx);
  }
}

function signoff(c: { first_name: string; id: string }): string {
  return c.id === "partner" ? "E." : c.id === "practice_support" ? "Dana, Practice Support" : c.first_name;
}

function factsDisplay(facts: Facts): string[] {
  return Object.values(facts).map(formatFact);
}

// ---------------------------------------------------------------- intent
async function classifyIntent(ctx: JobContext, messageId: string): Promise<JobOutcome> {
  const msg = ctx.state.messages[messageId];
  if (!msg) throw new Error(`classify_intent: unknown message ${messageId}`);
  const thread = threadForPrompt(ctx.state, msg.threadId, ctx.names).slice(0, -1);
  const open = openAssignments(ctx.state).map((a) => ctx.idx.assignment(a));
  const onThread = open.find((a) => ctx.state.threads[msg.threadId]?.assignmentIds.includes(a.id)) ?? open.find((a) => a.expected_recipients.some((r) => msg.to.includes(r) || msg.cc.includes(r)));
  const p = intentClassifierPrompt({ thread, outgoing: { to: msg.to.map((x) => ctx.names.name(x)), cc: msg.cc.map((x) => ctx.names.name(x)), body: msg.body, attachments: msg.attachments }, openAssignmentTitle: onThread?.title ?? null });
  const res = await ctx.provider.generateJson({ role: "intent_classifier", system: p.system, user: p.user, promptVersion: p.version, mockContext: { body: msg.body, openAssignmentTitle: onThread?.title ?? null }, sessionId: ctx.session.id, jobKey: ctx.job.key }, IntentOutputSchema);
  return {
    events: [{ event: { type: "intent_classified", payload: { messageId, intent: res.parsed.intent, confidence: res.parsed.confidence } }, idempotencyKey: `${ctx.session.id}:intent:${messageId}` }],
    generations: [{ role: "intent_classifier", model: res.model, provider: res.provider, promptVersion: p.version, inputRefs: { messageId }, systemPrompt: p.system, userPrompt: p.user, output: res.text, parsedOutput: res.parsed, usage: res.usage, latencyMs: res.latencyMs, attempt: ctx.attempt }],
  };
}

// ---------------------------------------------------------------- assessor
async function assess(ctx: JobContext, messageId: string, assignmentId: string): Promise<JobOutcome> {
  const msg = ctx.state.messages[messageId];
  const a = ctx.idx.assignment(assignmentId);
  if (!msg) throw new Error(`assess: unknown message ${messageId}`);
  const deltaIds = new Set(a.issues.map((i) => i.delta).filter(Boolean));
  const deltas = ctx.pkg.deltas.filter((d) => deltaIds.has(d.id) || d.surfaces_in === a.milestone);
  const deliverable = msg.body + (msg.quotedRefs.length ? `\n\n[Quoted passages: ${msg.quotedRefs.map((q) => `${q.ref}: "${q.text}"`).join(" | ")}]` : "");
  const p = assessorPrompt({ assignment: a, deltas, deliverable, rationale: msg.rationale, quotedRefs: msg.quotedRefs });
  const res = await ctx.provider.generateJson({
    role: "assessor", system: p.system, user: p.user, promptVersion: p.version, sessionId: ctx.session.id, jobKey: ctx.job.key,
    mockContext: { deliverable, rationale: msg.rationale, issues: a.issues.map((i) => ({ id: i.id, keywords: i.keywords.length ? i.keywords : [i.title] })), decisionPoints: a.decision_points.map((d) => ({ id: d.id, positions: d.positions.map((x) => ({ id: x.id, label: x.label })) })) },
  }, AssessmentOutputSchema);
  const issues: Record<string, "raised" | "partial" | "missed"> = {};
  for (const i of a.issues) issues[i.id] = res.parsed.issues.find((x) => x.id === i.id)?.status ?? "missed";
  const decisions: Record<string, string> = {};
  for (const d of res.parsed.decisions) if (d.position && d.position !== "none") decisions[d.id] = d.position;
  return {
    events: [{ event: { type: "assessment_recorded", payload: { messageId, assignmentId, issues, decisions, summary: res.parsed.summary, shadow: ctx.session.assessorShadowMode } }, idempotencyKey: `${ctx.session.id}:assess:${messageId}` }],
    generations: [{ role: "assessor", model: res.model, provider: res.provider, promptVersion: p.version, inputRefs: { messageId, assignmentId }, systemPrompt: p.system, userPrompt: p.user, output: res.text, parsedOutput: res.parsed, usage: res.usage, latencyMs: res.latencyMs, attempt: ctx.attempt }],
  };
}

// ---------------------------------------------------------------- character reply
async function characterReply(ctx: JobContext, messageId: string, characterId: string, threadId: string): Promise<JobOutcome> {
  const c = ctx.idx.character(characterId);
  const msg = ctx.state.messages[messageId];
  const thread = ctx.state.threads[threadId];
  if (!msg || !thread) throw new Error(`character_reply: unknown message or thread`);
  const facts = sliceFactsFor(c, ctx.pkg.facts);
  const hints = answerKeyHints(ctx, threadId);
  const negotiation = c.id === "lenders_counsel" ? ctx.pkg.negotiation : undefined;
  const to = [msg.from === "associate" ? "associate" : msg.from];
  const cc = [...msg.to, ...msg.cc].filter((x) => x !== c.id && x !== "associate" && !ctx.idx.character(x).is_doctrine_assistant);
  return generateAndDeliver(ctx, { from: c, to, cc, threadId, threadKey: thread.key, subject: thread.subject, attachments: [], kind: "reply", inReplyTo: messageId }, {
    role: "character_writer",
    build: (feedback) => {
      const p = characterWriterPrompt({ character: c, facts, associateFirstName: ctx.state.associateFirstName, thread: threadForPrompt(ctx.state, threadId, ctx.names, { viewerId: c.id }), otherThreads: otherThreadsFor(ctx.state, c.id, threadId, ctx.names), mode: { kind: "reply", toMessageBody: msg.body }, negotiation, feedback, storyDate: storyDate(ctx.now) });
      return { ...p, mockContext: { mode: "reply", associateFirstName: ctx.state.associateFirstName, characterFirstName: c.first_name, signoff: signoff(c), replyHint: c.id === "client_contact" ? "That's helpful, though I'm not sure I follow all of it." : undefined } };
    },
    parse: (res) => ({ body: res.text }),
    check: "full",
    answerKeyHints: hints,
    isSocratic: c.gives_socratic_feedback,
    inputRefs: { messageId, characterId, threadId },
  });
}

// ---------------------------------------------------------------- beats
async function beat(ctx: JobContext, beatId: string): Promise<JobOutcome> {
  const b = ctx.pkg.beats.find((x) => x.id === beatId);
  if (!b) throw new Error(`beat: unknown beat ${beatId}`);
  const sender = ctx.idx.character(b.sender);
  const threadId = threadIdForKey(ctx, b.thread_key);
  const spec = { from: sender, to: b.to, cc: b.cc, threadId, threadKey: b.thread_key, subject: beatSubject(ctx, b, threadId), attachments: b.attachments, kind: (b.is_interruption ? "interruption" : "beat") as "beat" | "interruption", beatId: b.id };
  if (b.mode === "fixed") return deliverFixed(ctx, spec, b.body!);
  const must: Facts = {};
  for (const k of b.must_include_facts) if (ctx.pkg.facts[k]) must[k] = ctx.pkg.facts[k]!;
  const facts = { ...sliceFactsFor(sender, ctx.pkg.facts), ...must };
  return generateAndDeliver(ctx, spec, {
    role: "character_writer",
    build: (feedback) => {
      const p = characterWriterPrompt({ character: sender, facts, associateFirstName: ctx.state.associateFirstName, thread: threadForPrompt(ctx.state, threadId, ctx.names, { viewerId: sender.id }), otherThreads: otherThreadsFor(ctx.state, sender.id, threadId, ctx.names), mode: { kind: b.is_interruption ? "interruption" : "beat", beat: b, mustIncludeFacts: must }, negotiation: sender.id === "lenders_counsel" ? ctx.pkg.negotiation : undefined, feedback, storyDate: storyDate(ctx.now) });
      return { ...p, mockContext: { mode: "beat", brief: b.brief, associateFirstName: ctx.state.associateFirstName, characterFirstName: sender.first_name, signoff: signoff(sender), mustIncludeDisplay: factsDisplay(must) } };
    },
    parse: (res) => ({ body: res.text }),
    check: "full",
    answerKeyHints: answerKeyHints(ctx, threadId),
    isSocratic: sender.gives_socratic_feedback,
    extraFacts: must,
    inputRefs: { beatId },
  });
}

// ---------------------------------------------------------------- reflection (Socratic)
async function reflection(ctx: JobContext, messageId: string, assignmentId: string, characterId: string, threadId: string): Promise<JobOutcome> {
  const c = ctx.idx.character(characterId);
  const a = ctx.idx.assignment(assignmentId);
  const msg = ctx.state.messages[messageId];
  const thread = ctx.state.threads[threadId];
  if (!msg || !thread) throw new Error(`reflection: unknown message or thread`);
  const facts = sliceFactsFor(c, ctx.pkg.facts);
  const assessment: AssessmentOutput = {
    issues: a.issues.map((i) => ({ id: i.id, status: ctx.state.issues[i.id] ?? "missed", evidence: "" })),
    decisions: a.decision_points.map((d) => ({ id: d.id, position: ctx.state.decisions[d.id]?.position ?? "none", evidence: "" })),
    rationale_quality: !msg.rationale ? "absent" : msg.rationale.length < 40 ? "thin" : msg.rationale.length < 200 ? "adequate" : "strong",
    summary: "",
  };
  const cc = [...msg.to, ...msg.cc].filter((x) => x !== c.id && x !== "associate" && !ctx.idx.character(x).is_doctrine_assistant);
  return generateAndDeliver(ctx, { from: c, to: ["associate"], cc, threadId, threadKey: thread.key, subject: thread.subject, attachments: [], kind: "reflection", inReplyTo: messageId }, {
    role: "reflection_engine",
    build: (feedback) => {
      const p = reflectionPrompt({ character: c, facts, associateFirstName: ctx.state.associateFirstName, assignment: a, assessment, rationale: msg.rationale, thread: threadForPrompt(ctx.state, threadId, ctx.names, { withRationale: true, viewerId: c.id }), priorQuestions: ctx.state.reflectionQuestionsAsked, storyDate: storyDate(ctx.now), feedback });
      return { ...p, mockContext: { socraticAngles: a.socratic_angles, priorQuestions: ctx.state.reflectionQuestionsAsked, associateFirstName: ctx.state.associateFirstName, signoff: signoff(c), assignmentTitle: a.title } };
    },
    parse: (res) => {
      const parsed = ReflectionOutputSchema.parse(JSON.parse(extractJson(res.text)));
      return { body: parsed.email_body, reflectionQuestions: parsed.questions, parsed };
    },
    check: "full",
    answerKeyHints: a.issues.map((i) => `${i.title}: ${i.raised_looks_like}`),
    isSocratic: true,
    inputRefs: { messageId, assignmentId, characterId },
  });
}

// ---------------------------------------------------------------- doctrine assistant
async function doctrine(ctx: JobContext, messageId: string, threadId: string): Promise<JobOutcome> {
  const c = ctx.idx.doctrineAssistant;
  const msg = ctx.state.messages[messageId];
  if (!msg) throw new Error(`doctrine_answer: unknown message ${messageId}`);
  // Prior exchanges: every earlier associate question to practice support and the answer that followed, from all hidden threads.
  const prior: { question: string; answer: string }[] = [];
  for (const t of Object.values(ctx.state.threads).filter((t) => t.hidden)) {
    const msgs = t.messageIds.map((id) => ctx.state.messages[id]!);
    for (let i = 0; i < msgs.length; i++) {
      const q = msgs[i]!;
      if (q.from !== "associate" || q.id === messageId) continue;
      const ans = msgs.slice(i + 1).find((m) => m.from === c.id);
      if (ans) prior.push({ question: q.body, answer: ans.body });
    }
  }
  return generateAndDeliver(ctx, { from: c, to: ["associate"], cc: [], threadId, threadKey: null, subject: ctx.state.threads[threadId]?.subject ?? "Re: your question", attachments: [], kind: "doctrine", inReplyTo: messageId }, {
    role: "doctrine_assistant",
    build: () => {
      const p = doctrinePrompt({ character: c, associateFirstName: ctx.state.associateFirstName, question: msg.body, priorExchanges: prior });
      return { ...p, mockContext: { associateFirstName: ctx.state.associateFirstName } };
    },
    parse: (res) => ({ body: res.text }),
    check: "none", // sees no deal facts; the associate may have pasted amounts we must not "correct"
    answerKeyHints: [],
    isSocratic: false,
    inputRefs: { messageId },
  });
}

// ---------------------------------------------------------------- recap
async function recap(ctx: JobContext, gapDays: number): Promise<JobOutcome> {
  const c = ctx.idx.character("senior_associate");
  const m = ctx.idx.milestone(ctx.state.currentMilestone ?? ctx.idx.firstMilestone.id);
  const open = openAssignments(ctx.state).map((a) => ctx.idx.assignment(a).title);
  const recent = Object.values(ctx.state.threads).filter((t) => !t.hidden).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)).slice(0, 4).map((t) => t.subject);
  const threadId = threadIdForKey(ctx, `recap-${ctx.job.key}`);
  return generateAndDeliver(ctx, { from: c, to: ["associate"], cc: [], threadId, threadKey: null, subject: "Where things stand", attachments: [], kind: "recap" }, {
    role: "recap_debrief",
    build: (feedback) => {
      const p = recapPrompt({ character: c, facts: sliceFactsFor(c, ctx.pkg.facts), associateFirstName: ctx.state.associateFirstName, gapDays, milestone: m, openItems: open, recentSubjects: recent, storyDate: storyDate(ctx.now) });
      return { ...p, user: feedback.length ? `${p.user}\n\nFix: ${feedback.join("; ")}` : p.user, mockContext: { kind: "recap", associateFirstName: ctx.state.associateFirstName, recapHint: m.recap_hint } };
    },
    parse: (res) => ({ body: res.text }),
    check: "full",
    answerKeyHints: [],
    isSocratic: false,
    inputRefs: { gapDays, milestone: m.id },
  });
}

// ---------------------------------------------------------------- debrief
async function debrief(ctx: JobContext): Promise<JobOutcome> {
  const c = ctx.idx.character("partner");
  const fired = ctx.pkg.consequences
    .filter((q) => ctx.state.consequences[q.id] === "fired")
    .map((q) => {
      const seedDescription = "issue" in q.seed
        ? `the ${ctx.idx.issues.get(q.seed.issue)?.title.toLowerCase() ?? q.seed.issue} point was ${q.seed.outcome}`
        : `the associate chose "${ctx.idx.decisionPoints.get(q.seed.decision_point)?.positions.find((p) => p.id === q.seed.outcome)?.label ?? q.seed.outcome}"`;
      const rationale = "decision_point" in q.seed ? ctx.state.decisions[q.seed.decision_point]?.rationale ?? null : (() => {
        const asg = ctx.idx.issues.get((q.seed as { issue: string }).issue)?.assignment;
        const mid = asg ? ctx.state.assignments[asg]?.deliverableMessageId : null;
        return mid ? ctx.state.messages[mid]?.rationale ?? null : null;
      })();
      return { consequence: q, seedDescription, rationale };
    });
  const decisions = Object.entries(ctx.state.decisions).map(([dpId, d]) => {
    const dp = ctx.idx.decisionPoints.get(dpId);
    return { title: dp?.title ?? dpId, position: dp?.positions.find((p) => p.id === d.position)?.label ?? d.position, rationale: d.rationale };
  });
  const threadId = threadIdForKey(ctx, "debrief");
  return generateAndDeliver(ctx, { from: c, to: ["associate"], cc: ["senior_associate"], threadId, threadKey: "debrief", subject: "Northlake: closing debrief", attachments: [], kind: "debrief" }, {
    role: "recap_debrief",
    build: (feedback) => {
      const p = debriefPrompt({ character: c, facts: sliceFactsFor(c, ctx.pkg.facts), associateFirstName: ctx.state.associateFirstName, fired, notFiredPositive: [], decisions, storyDate: storyDate(ctx.now) });
      return { ...p, user: feedback.length ? `${p.user}\n\nFix: ${feedback.join("; ")}` : p.user, mockContext: { kind: "debrief", associateFirstName: ctx.state.associateFirstName, fired: fired.map((f) => f.consequence.title) } };
    },
    parse: (res) => ({ body: res.text, parsed: { referencedConsequences: fired.map((f) => f.consequence.id) } }),
    check: "full",
    answerKeyHints: [],
    isSocratic: false,
    inputRefs: { fired: fired.map((f) => f.consequence.id) },
  });
}

// ---------------------------------------------------------------- helpers
function answerKeyHints(ctx: JobContext, threadId: string): string[] {
  const t = ctx.state.threads[threadId];
  const ids = new Set(t?.assignmentIds ?? []);
  for (const a of openAssignments(ctx.state)) ids.add(a);
  const out: string[] = [];
  for (const aid of ids) for (const i of ctx.idx.assignment(aid).issues) out.push(`${i.title}: ${i.raised_looks_like}`);
  return out;
}

export function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

export type { Job };
