import type { MessageState, SessionState } from "@aporia/engine";
import type { ThreadMessageForPrompt } from "@aporia/prompts";
import { ScenarioIndex, type ScenarioPackage } from "@aporia/scenario";

/** Display helpers that turn participant ids into names for prompts and the UI. */
export class Names {
  private idx: ScenarioIndex;
  constructor(readonly pkg: ScenarioPackage, readonly associateFirstName: string) {
    this.idx = new ScenarioIndex(pkg);
  }
  name(p: string): string {
    if (p === "associate") return this.associateFirstName || "the associate";
    return this.idx.characters.get(p)?.name ?? p;
  }
  role(p: string): string {
    if (p === "associate") return this.pkg.meta.associate.role_label;
    return this.idx.characters.get(p)?.role_label ?? "";
  }
}

/** Thread messages as a prompt sees them. Rationales are included only when `withRationale` (reflection engine). */
export function threadForPrompt(state: SessionState, threadId: string, names: Names, opts: { withRationale?: boolean; viewerId?: string } = {}): ThreadMessageForPrompt[] {
  const t = state.threads[threadId];
  if (!t) return [];
  return t.messageIds
    .map((id) => state.messages[id]!)
    .filter((m) => !opts.viewerId || m.from === opts.viewerId || m.to.includes(opts.viewerId) || m.cc.includes(opts.viewerId) || m.to.includes("associate") && opts.viewerId === "associate")
    .map((m) => toPromptMessage(m, names, opts.withRationale ?? false));
}

export function toPromptMessage(m: MessageState, names: Names, withRationale: boolean): ThreadMessageForPrompt {
  return {
    from: names.name(m.from),
    fromRole: names.role(m.from),
    to: m.to.map((p) => names.name(p)),
    cc: m.cc.map((p) => names.name(p)),
    at: m.at.slice(0, 16).replace("T", " "),
    body: m.body,
    rationale: withRationale ? m.rationale : undefined,
  };
}

/** Other visible threads for a character, most recent first, excluding the current one and hidden threads. */
export function otherThreadsFor(state: SessionState, characterId: string, excludeThreadId: string, names: Names, limit = 3) {
  return Object.values(state.threads)
    .filter((t) => t.id !== excludeThreadId && !t.hidden && t.participants.includes(characterId))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    .slice(0, limit)
    .map((t) => ({ subject: t.subject, messages: threadForPrompt(state, t.id, names) }));
}

export function storyDate(at: string): string {
  return new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
