import { writingByThread, type SessionState } from "@rematter/engine";
import { ScenarioIndex, type ScenarioPackage } from "@rematter/scenario";
import { getPool } from "@rematter/db";

export interface AddressBookEntry { id: string; name: string; email: string; roleLabel: string; title: string; organization: string; isDoctrine: boolean }
export interface InboxMessage {
  id: string; threadId: string; from: string; to: string[]; cc: string[]; subject: string; body: string; attachments: string[]; at: string; kind: string; intent: string | null; rationale: string | null; quotedRefs: { documentId: string; ref: string; text: string }[]; readAt: string | null;
  /** The message this one forwards, if it is a forward. */
  forwardedMessageId: string | null;
  /** Whether it sits on a hidden practice support thread, which can't be forwarded. */
  private: boolean;
}
export interface InboxThread { id: string; key: string | null; subject: string; participants: string[]; lastMessageAt: string; messageIds: string[]; unread: number }
export interface InboxView {
  sessionId: string; status: string; currentMilestone: string | null; associateFirstName: string; associateEmail: string;
  addressBook: AddressBookEntry[]; threads: InboxThread[]; messages: InboxMessage[];
  documents: { id: string; title: string; shortTitle: string; kind: string; from: string; folder: string | null }[];
  /** Label for this matter at the top of the inbox (e.g. "Halden · Borrower"). */
  matterLabel: string;
  /** How many matters the associate is in; more than one shows the switcher (set by /api/inbox). */
  matterCount?: number;
  milestones: { id: string; title: string }[];
  testerFlagsEnabled: boolean; readOnly: boolean;
  /** Characters with an email on its way to each thread, soonest first ("Marcus is writing…"). */
  writing: Record<string, { from: string; dueAt: string }[]>;
  /** Test checkpoints the associate can load, when their cohort has a source run (set by /api/inbox). */
  checkpoints?: { eventCount: number; label: string; milestoneId: string | null }[] | null;
}

export function addressBook(pkg: ScenarioPackage): AddressBookEntry[] {
  return pkg.characters.map((c) => ({ id: c.id, name: c.name, email: c.email, roleLabel: c.role_label, title: c.title, organization: c.organization, isDoctrine: c.is_doctrine_assistant }));
}

export async function buildInboxView(sessionId: string, state: SessionState, pkg: ScenarioPackage, opts: { associateEmail: string; testerFlagsEnabled: boolean }): Promise<InboxView> {
  const idx = new ScenarioIndex(pkg);
  const reads = await getPool().query<{ id: string; read_at: Date | null }>(`select message_id as id, read_at from message_reads where session_id = $1`, [sessionId]);
  const readAt = new Map(reads.rows.map((r) => [r.id, r.read_at?.toISOString() ?? null]));
  const messages: InboxMessage[] = state.messageOrder.map((id) => {
    const m = state.messages[id]!;
    return { id: m.id, threadId: m.threadId, from: m.from, to: m.to, cc: m.cc, subject: m.subject, body: m.body, attachments: m.attachments, at: m.at, kind: m.kind, intent: m.intent, rationale: m.rationale, quotedRefs: m.quotedRefs, forwardedMessageId: m.forwardedMessageId ?? null, private: state.threads[m.threadId]?.hidden ?? false, readAt: m.from === "associate" ? m.at : readAt.get(m.id) ?? null };
  });
  const threads: InboxThread[] = Object.values(state.threads)
    .map((t) => ({ id: t.id, key: t.key, subject: t.subject, participants: t.participants, lastMessageAt: t.lastMessageAt, messageIds: t.messageIds, unread: t.messageIds.filter((id) => state.messages[id]!.from !== "associate" && !readAt.get(id)).length }))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  return {
    sessionId, status: state.status, currentMilestone: state.currentMilestone, associateFirstName: state.associateFirstName, associateEmail: opts.associateEmail,
    addressBook: addressBook(pkg), threads, messages,
    documents: state.documentsReleased.map((d) => idx.document(d)).map((d) => ({ id: d.id, title: d.title, shortTitle: d.short_title, kind: d.kind, from: d.from, folder: d.folder ?? null })),
    matterLabel: pkg.meta.matter_label,
    milestones: idx.milestonesInOrder.map((m) => ({ id: m.id, title: m.title })),
    testerFlagsEnabled: opts.testerFlagsEnabled, readOnly: state.status === "completed",
    writing: writingByThread(state),
  };
}
