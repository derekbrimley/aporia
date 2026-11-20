import type { MessageState, SessionState } from "@rematter/engine";
import type { AssociateReading, ForwardedForPrompt, ThreadMessageForPrompt } from "@rematter/prompts";
import { ScenarioIndex, type BuiltDocument, type Character, type ScenarioPackage } from "@rematter/scenario";

/** Display helpers that turn participant ids into names for prompts and the UI. */
export class Names {
  private idx: ScenarioIndex;
  constructor(readonly pkg: ScenarioPackage, readonly associateFirstName: string, readonly timeZone: string | null = null) {
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

/** "YYYY-MM-DD HH:MM" on the associate's clock, so email times agree with the story date. */
export function sentAt(iso: string, timeZone: string | null): string {
  if (!timeZone) return iso.slice(0, 16).replace("T", " ");
  return new Date(iso).toLocaleString("sv-SE", { timeZone: safeTimeZone(timeZone), hour12: false }).slice(0, 16);
}

/** Thread messages as a prompt sees them. */
export function threadForPrompt(state: SessionState, threadId: string, names: Names, opts: { viewerId?: string } = {}): ThreadMessageForPrompt[] {
  const t = state.threads[threadId];
  if (!t) return [];
  return t.messageIds
    .map((id) => state.messages[id]!)
    .filter((m) => !opts.viewerId || m.from === opts.viewerId || m.to.includes(opts.viewerId) || m.cc.includes(opts.viewerId) || m.to.includes("associate") && opts.viewerId === "associate")
    .map((m) => toPromptMessage(m, names, state));
}

export function toPromptMessage(m: MessageState, names: Names, state?: SessionState): ThreadMessageForPrompt {
  const fwd = state && m.forwardedMessageId ? state.messages[m.forwardedMessageId] : undefined;
  return {
    from: names.name(m.from),
    fromRole: names.role(m.from),
    to: m.to.map((p) => names.name(p)),
    cc: m.cc.map((p) => names.name(p)),
    at: sentAt(m.at, names.timeZone),
    body: m.body,
    forwarded: fwd ? forwardedForPrompt(fwd, names) : null,
  };
}

/** A forwarded email as its new recipients see it. Attachments are named by document title. */
export function forwardedForPrompt(m: MessageState, names: Names): ForwardedForPrompt {
  const docs = new Map(names.pkg.documents.map((d) => [d.id, d.title]));
  return {
    from: names.name(m.from),
    fromRole: names.role(m.from),
    to: m.to.map((p) => names.name(p)),
    cc: m.cc.map((p) => names.name(p)),
    at: sentAt(m.at, names.timeZone),
    subject: m.subject,
    body: m.body,
    attachments: m.attachments.map((d) => docs.get(d) ?? d),
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

/**
 * Today's date inside the fiction, on the associate's calendar. `timeZone` is the one their browser
 * reported when the session started; older sessions have none and stay on UTC.
 */
export function storyDate(at: string, timeZone?: string | null): string {
  return new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: safeTimeZone(timeZone) });
}

/** The zone if the runtime knows it, else UTC. */
export function safeTimeZone(timeZone?: string | null): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** Titles of the documents attached to emails the associate has received, first seen first. */
export function associateDocuments(state: SessionState, names: Names): string[] {
  const docs = new Map(names.pkg.documents.map((d) => [d.id, d.title]));
  const seen = new Set<string>();
  for (const id of state.messageOrder) {
    const m = state.messages[id]!;
    if (m.from === "associate" || !(m.to.includes("associate") || m.cc.includes("associate"))) continue;
    for (const d of m.attachments) seen.add(d);
  }
  return [...seen].map((d) => docs.get(d) ?? d);
}

/** Which documents the associate has, for prompts that split facts into ones they can look up and ones they can't. */
export function associateReading(state: SessionState, names: Names): AssociateReading {
  const titles = new Map(names.pkg.documents.map((d) => [d.id, d.title]));
  return { associateFirstName: names.name("associate"), released: [...state.documentsReleased], docTitle: (d) => titles.get(d) ?? d };
}

/**
 * The full text of the associate's documents that this character knows, in the order they arrived,
 * so the character can check what a document actually says instead of recalling it.
 */
export function documentTextsFor(state: SessionState, documents: Map<string, BuiltDocument>, character: Character): { title: string; text: string }[] {
  const known = new Set(character.knows.documents);
  return state.documentsReleased.filter((d) => known.has(d) && documents.has(d)).map((d) => ({ title: documents.get(d)!.title, text: documents.get(d)!.text }));
}

/** For the associate's own firm: each assignment the associate owes right now, as "title: what to deliver". */
export function currentWorkFor(state: SessionState, pkg: ScenarioPackage, character: Character): string[] | undefined {
  if (character.side !== "own_firm") return undefined;
  return pkg.assignments.filter((a) => state.assignments[a.id]?.status === "open").map((a) => `${a.title}: ${a.deliverable.trim()}`);
}

/**
 * On a private follow-up thread (the side thread a reflection opens when work went outside the firm),
 * whether this character has already replied there once and should now close it.
 */
export function followUpThreadFor(state: SessionState, threadId: string, characterId: string): { closeNow: boolean } | undefined {
  const t = state.threads[threadId];
  if (!t?.key?.startsWith("reflection:")) return undefined;
  const replies = t.messageIds.map((id) => state.messages[id]!).filter((m) => m.from === characterId && m.kind === "reply").length;
  return { closeNow: replies >= 1 };
}

/**
 * How many times in a row this character has already answered the associate's questions on this
 * thread, counting back from the newest email to the last time the associate sent anything other than
 * a question (or someone else wrote). Two rounds of hints without progress means the associate is
 * stuck, and the reply should stop withholding (see `helpFor`).
 */
export function questionRounds(state: SessionState, threadId: string, characterId: string): number {
  const msgs = (state.threads[threadId]?.messageIds ?? []).map((id) => state.messages[id]!);
  let rounds = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.from === "associate") {
      if (m.intent && m.intent !== "question") break;
      continue;
    }
    if (m.from === characterId && m.kind === "reply") rounds++;
    else break;
  }
  return rounds;
}

/**
 * For a character who teaches by asking: after one round of hints the reply points to the exact place
 * in the document, and after two it simply answers. Pushing longer reads as withholding.
 */
export function helpFor(state: SessionState, threadId: string, character: Character): "point" | "answer" | undefined {
  if (!character.gives_socratic_feedback) return undefined;
  const rounds = questionRounds(state, threadId, character.id);
  return rounds >= 2 ? "answer" : rounds >= 1 ? "point" : undefined;
}

/**
 * Whether this character has already written on the thread since the given email arrived. Their
 * reply then saw the email (prompts include the whole thread), so a second reply would repeat it.
 */
export function answeredSince(state: SessionState, threadId: string, messageId: string, characterId: string): boolean {
  const ids = state.threads[threadId]?.messageIds ?? [];
  const i = ids.indexOf(messageId);
  return i >= 0 && ids.slice(i + 1).some((id) => {
    const m = state.messages[id];
    return m?.from === characterId && m.kind === "reply";
  });
}
