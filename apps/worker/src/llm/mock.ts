import type { z } from "zod";
import type { LlmJsonResult, LlmProvider, LlmRequest, LlmTextResult } from "./provider.js";

/**
 * Deterministic mock provider for tests, CI and the bot-associate harness
 * without API keys. It reads `mockContext` to produce output that exercises the
 * real engine paths (issue keywords -> assessment, briefs -> emails, etc.).
 * It never calls the network.
 */
export class MockProvider implements LlmProvider {
  readonly name = "mock" as const;
  /** Optional overrides keyed by role, for tests that need a specific output. */
  overrides = new Map<string, (req: LlmRequest) => unknown>();

  async generateText(req: LlmRequest): Promise<LlmTextResult> {
    const out = this.overrides.get(req.role)?.(req) ?? this.produce(req);
    const text = typeof out === "string" ? out : JSON.stringify(out);
    return { text, usage: { inputTokens: est(req.system + req.user), outputTokens: est(text), cacheReadTokens: 0 }, latencyMs: 1, model: "mock", provider: "mock", stopReason: "end_turn" };
  }

  async generateJson<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<LlmJsonResult<T>> {
    const out = this.overrides.get(req.role)?.(req) ?? this.produce(req);
    const parsed = schema.parse(out);
    const text = JSON.stringify(parsed);
    return { text, parsed, usage: { inputTokens: est(req.system + req.user), outputTokens: est(text), cacheReadTokens: 0 }, latencyMs: 1, model: "mock", provider: "mock", stopReason: "end_turn" };
  }

  private produce(req: LlmRequest): unknown {
    const c = (req.mockContext ?? {}) as Record<string, any>;
    switch (req.role) {
      case "intent_classifier": {
        const body: string = String(c.body ?? "");
        const marker = body.match(/\[intent:(deliverable|question|logistics|acknowledgment)\]/);
        if (marker) return { intent: marker[1], confidence: 1 };
        const trimmed = body.trim();
        if (/^(thanks|thank you|noted|will do|got it|sounds good|ok)\b/i.test(trimmed) && trimmed.length < 80) return { intent: "acknowledgment", confidence: 0.9 };
        if (c.openAssignmentTitle && trimmed.length > 150 && !/\?\s*$/.test(trimmed)) return { intent: "deliverable", confidence: 0.8 };
        if (/\?/.test(trimmed)) return { intent: "question", confidence: 0.8 };
        if (/attached|scheduling|call at|calendar|forward/i.test(trimmed)) return { intent: "logistics", confidence: 0.7 };
        return { intent: trimmed.length > 150 ? "deliverable" : "question", confidence: 0.6 };
      }
      case "assessor": {
        const deliverable = String(c.deliverable ?? "").toLowerCase();
        const issues = (c.issues as { id: string; keywords: string[] }[]) ?? [];
        const dps = (c.decisionPoints as { id: string; positions: { id: string; label: string }[] }[]) ?? [];
        return {
          issues: issues.map((i) => {
            const hits = i.keywords.filter((k) => deliverable.includes(k.toLowerCase()));
            const forced = deliverable.match(new RegExp(`\\[${i.id.replace(".", "\\.")}:(raised|partial|missed)\\]`, "i"));
            const status = forced ? forced[1]!.toLowerCase() : hits.length >= 2 ? "raised" : hits.length === 1 ? "partial" : "missed";
            return { id: i.id, status, evidence: hits.length ? hits.join(", ") : "not present" };
          }),
          decisions: dps.map((d) => {
            const forced = deliverable.match(new RegExp(`\\[${d.id.replace(".", "\\.")}:(P\\d)\\]`, "i"));
            const byLabel = d.positions.find((p) => deliverable.includes(p.label.toLowerCase()));
            return { id: d.id, position: forced ? forced[1]!.toUpperCase() : byLabel?.id ?? "none", evidence: forced ? "marker" : byLabel?.label ?? "none" };
          }),
          rationale_quality: !c.rationale ? "absent" : String(c.rationale).length < 40 ? "thin" : String(c.rationale).length < 200 ? "adequate" : "strong",
          summary: "Mock assessment: matched issue keywords in the deliverable.",
        };
      }
      case "character_writer": {
        const first = c.associateFirstName ?? "there";
        const signoff = c.signoff ?? c.characterFirstName ?? "";
        const facts: string[] = c.mustIncludeDisplay ?? [];
        const brief: string = c.brief ?? "";
        const body = c.mode === "reply"
          ? `${first}, thanks for your note. ${c.replyHint ?? "Let me think about that and come back to you."} What is your own read on it?`
          : `${first}, ${brief.replace(/\s+/g, " ").trim()}${facts.length ? ` For reference: ${facts.join("; ")}.` : ""}`;
        return `${body}\n\n${signoff}`;
      }
      case "reflection_engine": {
        const angles: string[] = c.socraticAngles ?? [];
        const prior: string[] = c.priorQuestions ?? [];
        const n = prior.length;
        const qs = angles.length
          ? angles.slice(n % Math.max(angles.length, 1), (n % Math.max(angles.length, 1)) + 2).map((a, i) => `${i === 0 ? "When you wrote that, " : "And "}what did you make of ${a.charAt(0).toLowerCase()}${a.slice(1).replace(/\.$/, "")}?`)
          : [`What led you to frame it that way in the ${c.assignmentTitle ?? "note"}?`];
        const uniq = qs.map((q, i) => (prior.includes(q) ? `${q.slice(0, -1)} this time around (${n + i})?` : q));
        return { questions: uniq, email_body: `${c.associateFirstName ?? "Thanks"}, thanks for this. A few questions before we go back to the client.\n\n${uniq.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nNo rush.\n\n${c.signoff ?? ""}` };
      }
      case "doctrine_assistant":
        return `${c.associateFirstName ?? "Hi"},\n\nOn your question: as a general matter, a negative pledge is a covenant not to grant liens on specified assets; it creates no security interest and gives the lender only a contract claim, so it is weaker than a perfected lien under UCC Article 9 but preserves the borrower's title. I can only speak to the general rule, not to any particular matter.\n\nDana, Practice Support`;
      case "fact_checker":
        return { pass: true, violations: [] };
      case "recap_debrief":
        return c.kind === "debrief"
          ? `${c.associateFirstName ?? ""}, now that we have closed, a few decisions worth walking back through.\n\n${((c.fired as string[]) ?? []).map((t) => `${t}: this surfaced later in the deal, as you saw.`).join("\n\n")}\n\nTake a moment to think about which of these you would call differently, and why.\n\nE.`
          : `${c.associateFirstName ?? ""}, a quick note since you have been away a few days. ${c.recapHint ?? ""} Nothing has moved; pick up where you left off.\n\nMarcus`;
      case "eval_judge":
        return { realism: 4, legal_accuracy: 4, socratic_quality: 4, voice_consistency: 4, acceptable: true, answer_key_leak: false, fiction_break: false, notes: "mock" };
      case "bot_associate": {
        const raise: { title: string; looks: string }[] = c.raise ?? [];
        const position: string | null = c.positionLabel ?? null;
        const body = [
          c.opening ?? "Here are my thoughts.",
          raise.length ? "" : "I went through the materials against what we discussed. Nothing jumped out at me beyond the points already covered on the earlier threads, so I would be comfortable proceeding on the current drafts unless you see something I should look at more closely.",
          ...raise.map((r, i) => `${i + 1}. ${r.title}. ${r.looks}`),
          position ? `On the overall call: ${position}.` : "",
          c.closing ?? "Happy to discuss.",
        ].filter(Boolean).join("\n\n");
        const rationale = c.rationaleStyle === "none" ? null : c.rationaleStyle === "thin" ? "Seemed right." : `I focused on ${raise.map((r) => r.title.toLowerCase()).join(", ") || "the client's timeline"} because those affect what the client can actually do before closing.`;
        return { body, rationale };
      }
    }
    return "";
  }
}

function est(s: string) {
  return Math.ceil(s.length / 4);
}
