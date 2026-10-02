"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocView, InboxThread, InboxView, Layout, Quote } from "./types";
import { Icon } from "./icons";
import { FlagButton } from "./FlagButton";
import { Compose, emptyCompose, forwardCompose, markDraftSaved, type ComposeState } from "./Compose";
import { Forwarded } from "./Forwarded";
import { DocumentPanel } from "./DocumentPanel";

type Folder = "inbox" | "sent";

/** Drafts are keyed by thread id; a new email that has no thread yet uses this key. */
const NEW = "new";
const draftKey = (c: ComposeState) => c.threadId ?? NEW;

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function InboxApp({ userName }: { userName: string }) {
  const [view, setView] = useState<InboxView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<Folder>("inbox");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ComposeState>>({});
  const [docs, setDocs] = useState<(DocView | null)[]>([null, null]);
  const [layout, setLayout] = useState<Layout>("even");
  const [library, setLibrary] = useState(false);
  const docCache = useRef(new Map<string, DocView>());

  const load = useCallback(async () => {
    const r = await fetch("/api/inbox", { cache: "no-store" });
    if (!r.ok) { setError(((await r.json()) as { error?: string }).error ?? "Could not load your inbox."); return; }
    const v = (await r.json()) as InboxView;
    setView(v);
    setSelected((s) => s ?? v.threads.find((t) => !t.key?.startsWith("recap"))?.id ?? v.threads[0]?.id ?? null);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Restore autosaved drafts so they survive a reload. Newest first, so the latest draft per thread wins.
  useEffect(() => {
    void fetch("/api/inbox/drafts", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) return;
      const { drafts: rows } = (await r.json()) as { drafts: { id: string; threadId: string | null; to: string[]; cc: string[]; subject: string | null; body: string; attachments: string[]; quotes: Quote[]; forwardedMessageId: string | null }[] };
      const restored: Record<string, ComposeState> = {};
      for (const d of rows) {
        const key = d.threadId ?? NEW;
        if (restored[key]) continue;
        restored[key] = { threadId: d.threadId, to: d.to, cc: d.cc, subject: d.subject ?? "", body: d.body, attachments: d.attachments, quotes: d.quotes, draftId: d.id, forwardedMessageId: d.forwardedMessageId ?? null };
        markDraftSaved(restored[key]);
      }
      setDrafts((cur) => ({ ...restored, ...cur }));
    });
  }, []);

  // Live updates over server-sent events; quiet unread indicator, no pop-ups.
  useEffect(() => {
    const es = new EventSource("/api/inbox/stream");
    es.addEventListener("inbox", () => void load());
    es.onerror = () => { /* the browser reconnects automatically */ };
    return () => es.close();
  }, [load]);

  const name = useCallback((id: string) => (id === "associate" ? "you" : view?.addressBook.find((a) => a.id === id)?.name ?? id), [view]);
  const role = useCallback((id: string) => (id === "associate" ? "Associate" : view?.addressBook.find((a) => a.id === id)?.roleLabel ?? ""), [view]);

  // One row per thread in Inbox (keyed to the latest received message), one row per sent email in Sent.
  const rows = useMemo(() => {
    if (!view) return [];
    const q = search.trim().toLowerCase();
    const byId = new Map(view.messages.map((m) => [m.id, m]));
    const matches = (subject: string, bodies: string[]) => !q || subject.toLowerCase().includes(q) || bodies.some((b) => b.toLowerCase().includes(q));
    if (folder === "sent") {
      const subjects = new Map(view.threads.map((t) => [t.id, t.subject]));
      return view.messages
        .filter((m) => m.from === "associate")
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((m) => ({ key: m.id, threadId: m.threadId, subject: subjects.get(m.threadId) ?? m.subject, message: m, unread: 0, people: [] as string[], at: m.at }))
        .filter((r) => matches(r.subject, [r.message.body]));
    }
    return view.threads.flatMap((t) => {
      const msgs = t.messageIds.map((id) => byId.get(id)).filter((m) => m !== undefined);
      const received = msgs.filter((m) => m.from !== "associate");
      // A thread with no reply yet stays listed, shown by who it went to rather than as from the associate.
      const last = received[received.length - 1] ?? msgs[msgs.length - 1];
      if (!last || !matches(t.subject, msgs.map((m) => m.body))) return [];
      return [{ key: t.id, threadId: t.id, subject: t.subject, message: last, unread: t.unread, people: t.participants.filter((p) => p !== "associate"), at: t.lastMessageAt }];
    });
  }, [view, folder, search]);

  const thread = view?.threads.find((t) => t.id === selected) ?? null;
  // The open draft follows the selection: the reply draft for the selected thread, or the new email.
  const compose = drafts[selected ?? NEW] ?? null;
  const putDraft = (c: ComposeState) => setDrafts((d) => ({ ...d, [draftKey(c)]: c }));
  const dropDraft = (key: string) => setDrafts(({ [key]: _, ...rest }) => rest);
  const hasText = (c: ComposeState | undefined) => Boolean(c && (c.body.trim() || c.quotes.length || c.forwardedMessageId));
  const messageById = useCallback((id: string | null) => (id ? view?.messages.find((m) => m.id === id) ?? null : null), [view]);
  const docTitle = (id: string) => view?.documents.find((x) => x.id === id)?.shortTitle ?? id;
  const messages = useMemo(() => (thread && view ? thread.messageIds.map((id) => view.messages.find((m) => m.id === id)!).filter(Boolean) : []), [thread, view]);

  // Mark visible messages read.
  useEffect(() => {
    if (!thread) return;
    const unread = messages.filter((m) => m.from !== "associate" && !m.readAt).map((m) => m.id);
    if (unread.length) void fetch("/api/inbox/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageIds: unread }) }).then(() => setView((v) => v && { ...v, messages: v.messages.map((m) => (unread.includes(m.id) ? { ...m, readAt: new Date().toISOString() } : m)), threads: v.threads.map((t) => (t.id === thread.id ? { ...t, unread: 0 } : t)) }));
  }, [thread?.id, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openDoc(id: string, slot: 0 | 1 = 0) {
    let d = docCache.current.get(id);
    if (!d) {
      const r = await fetch(`/api/documents/${id}`);
      if (!r.ok) return;
      d = (await r.json()) as DocView;
      docCache.current.set(id, d);
    }
    setDocs((prev) => { const next = [...prev] as (DocView | null)[]; next[slot] = d!; if (slot === 1 && !next[0]) { next[0] = d!; next[1] = null; } return next; });
    void fetch("/api/inbox/opened", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: id }) });
    if (slot === 1 && docs[0]) void fetch("/api/inbox/compared", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentIds: [docs[0].id, id] }) });
    setLibrary(false);
  }

  function replyTo(t: InboxThread) {
    const last = [...messages].reverse().find((m) => m.from !== "associate") ?? messages[messages.length - 1];
    return emptyCompose(t, view?.addressBook, last?.from, last?.to ?? [], last?.cc ?? []);
  }
  function startReply() { if (thread && !drafts[thread.id]) putDraft(replyTo(thread)); }
  /** Forwarding opens it as the new email; an unsent new email is only replaced if the associate agrees. */
  function startForward(m: InboxView["messages"][number]) {
    if (hasText(drafts[NEW]) && !window.confirm("Replace your unsent new email with this forward?")) return;
    const old = drafts[NEW];
    if (old) void fetch("/api/inbox/drafts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: old.draftId }) });
    putDraft(forwardCompose(m));
    setSelected(null); setSelectedRow(null);
  }
  function startNew() { if (!drafts[NEW]) putDraft(emptyCompose()); setSelected(null); setSelectedRow(null); }
  function addQuote(q: Quote) {
    const key = thread?.id ?? NEW;
    setDrafts((d) => {
      const c = d[key] ?? (thread ? replyTo(thread) : emptyCompose());
      return { ...d, [key]: { ...c, quotes: [...c.quotes, q] } };
    });
  }

  if (error) return <main className="min-h-screen flex items-center justify-center p-6"><div className="card max-w-[520px]"><h1 className="display text-[26px] font-normal m-0 mb-2">Nothing here yet</h1><p className="m-0 text-ink-muted">{error}</p><form action="/api/auth/sign-out" method="post" className="mt-4"><button className="btn">Sign out</button></form></div></main>;
  if (!view) return <main className="min-h-screen flex items-center justify-center text-ink-muted">Loading your inbox…</main>;

  const cols = layout === "email" ? "292px 1fr 420px" : layout === "docs" ? "292px 460px 1fr" : "292px 540px 1fr";
  const docsOpen = docs.some(Boolean);
  const milestoneTitle = view.milestones.find((m) => m.id === view.currentMilestone)?.title;

  return (
    <main className="h-screen grid" style={{ gridTemplateColumns: docsOpen ? cols : "292px 1fr", minWidth: 1280 }}>
      {/* ---------------------------------------------------------------- thread list */}
      <section aria-label="Threads" className="flex flex-col gap-3.5 min-h-0" style={{ padding: "24px 14px 0" }}>
        <div className="flex items-center justify-between gap-2 px-1.5">
          <div className="flex flex-col gap-0.5">
            <div className="text-[12px] font-semibold tracking-[0.08em] uppercase text-ink-muted">Halden · Borrower</div>
            <h1 className="display text-[28px] leading-[1.15] font-normal m-0">Inbox</h1>
          </div>
          <button type="button" className="btn btn-primary" style={{ padding: "0 16px" }} onClick={startNew} disabled={view.readOnly}><Icon.compose />Compose</button>
        </div>
        <div className="pill-input"><Icon.search /><input aria-label="Search email" placeholder="Search email" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="flex gap-1 px-1" role="tablist" aria-label="Folders">
          {(["inbox", "sent"] as Folder[]).map((f) => <button key={f} role="tab" aria-selected={folder === f} type="button" className="btn btn-sm btn-ghost" style={folder === f ? { background: "var(--color-plum-100)" } : {}} onClick={() => setFolder(f)}>{f === "inbox" ? "Inbox" : "Sent"}</button>)}
          {milestoneTitle && <span className="ml-auto self-center text-[12px] text-ink-muted truncate" title="Where the deal is">{view.readOnly ? "Closed" : milestoneTitle}</span>}
        </div>
        <div className="flex flex-col gap-1 overflow-auto flex-1 min-h-0" role="list">
          {drafts[NEW] && (
            <button type="button" role="listitem" className="thread-item" aria-current={selected === null} onClick={() => { setSelected(null); setSelectedRow(null); }}>
              <span className="flex items-center justify-between gap-2 w-full"><span className="text-[15px] font-medium text-plum-700">Draft</span><span className="role-chip">New email</span></span>
              <span className="display text-[16px] leading-[1.35]">{drafts[NEW].subject || "(no subject)"}</span>
              <span className="snippet">{drafts[NEW].body.replace(/\s+/g, " ").slice(0, 90)}</span>
            </button>
          )}
          {rows.map((r) => {
            const sent = folder === "sent";
            const outgoing = r.message.from === "associate";
            // Everyone on the thread, so a sender stays visible after someone else replies on it.
            const group = !outgoing && r.people.length > 1;
            const who = outgoing ? `To ${r.message.to.map(name).join(", ")}` : group ? [...r.people.map((p) => name(p).split(" ")[0]), "You"].join(", ") : name(r.message.from);
            const current = r.threadId === selected && (!sent || selectedRow === null || selectedRow === r.key);
            return (
              <button key={r.key} type="button" role="listitem" className="thread-item" aria-current={current} onClick={() => { setSelected(r.threadId); setSelectedRow(sent ? r.key : null); }}>
                <span className="flex items-center justify-between gap-2 w-full"><span className={`flex items-center gap-2 text-[15px] min-w-0 ${r.unread ? "font-bold" : "font-medium"}`} title={group ? r.people.map(name).join(", ") : undefined}>{r.unread > 0 && <span className="unread-dot" aria-label="Unread" />}<span className="truncate">{who}</span></span>{outgoing || group ? <span className="text-[12.5px] text-ink-muted whitespace-nowrap">{fmt(r.at)}</span> : <span className={`role-chip ${r.unread ? "role-chip-accent" : ""}`}>{role(r.message.from)}</span>}</span>
                <span className="display text-[16px] leading-[1.35]">{r.subject}</span>
                <span className="snippet">{!sent && hasText(drafts[r.threadId]) && <span className="text-plum-700">Draft · </span>}{(r.message.body.trim() || (r.message.forwardedMessageId ? "Forwarded message" : "")).replace(/\s+/g, " ").slice(0, 90)}</span>
              </button>
            );
          })}
          {!rows.length && <p className="text-ink-muted text-sm px-3">Nothing here yet.</p>}
        </div>
        <div style={{ padding: "0 0 20px" }}>
          <button type="button" className="btn w-full" style={{ height: 48, justifyContent: "flex-start" }} onClick={() => setLibrary(true)} disabled={!view.documents.length}><span className="flex text-plum-600"><Icon.library /></span><span className="flex-1 text-left">Document library</span>{view.documents.length > 0 && <span className="text-ink-muted text-[13px]">{view.documents.length}</span>}</button>
          <form action="/api/auth/sign-out" method="post" className="mt-2 px-1"><button className="btn btn-ghost btn-sm text-ink-muted">Sign out, {userName}</button></form>
        </div>
      </section>

      {/* ---------------------------------------------------------------- thread + compose */}
      <section aria-label="Conversation" className="flex flex-col min-h-0 bg-oat-100 border-x border-oat-400 overflow-auto">
        {view.readOnly && <div className="px-8 py-2 text-[13px] bg-plum-100 text-plum-700">The deal has closed. Your inbox stays available to read.</div>}
        {thread ? (
          <>
            <div className="flex flex-col gap-3.5 border-b border-oat-400" style={{ padding: "28px 32px 18px" }}>
              <h2 className="display text-[27px] leading-[1.22] font-normal m-0">{thread.subject}</h2>
              <div className="text-[13.5px] text-ink-muted">{messages.length} {messages.length === 1 ? "message" : "messages"}</div>
            </div>
            {messages.map((m) => (
              <article key={m.id} className="flex flex-col gap-3.5 border-b border-oat-400" style={{ padding: "20px 32px" }} aria-label={`Message from ${name(m.from)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5 text-[13.5px] text-ink-muted">
                    <div className="flex items-center gap-2"><span className="text-[14.5px] font-semibold text-ink whitespace-nowrap">{m.from === "associate" ? "You" : name(m.from)}</span><span className="role-chip">{role(m.from)}</span><span className="text-[12.5px]">{fmt(m.at)}</span></div>
                    <div>To {m.to.map(name).join(", ")}{m.cc.length > 0 && <> · Cc {m.cc.map(name).join(", ")}</>}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!view.readOnly && !m.private && <button type="button" className="btn btn-ghost btn-sm" onClick={() => startForward(m)}><Icon.forward />Forward</button>}
                    {m.from !== "associate" && <FlagButton targetType="message" targetId={m.id} enabled={view.testerFlagsEnabled} />}
                  </div>
                </div>
                {m.body.trim() && <div className="email-body">{m.body}</div>}
                {messageById(m.forwardedMessageId) && <Forwarded message={messageById(m.forwardedMessageId)!} nameOf={name} docTitle={docTitle} onOpenDoc={(d) => openDoc(d, 0)} />}
                {m.rationale && <div className="quote"><div className="flex items-center gap-1.5 text-[12px] text-ink-muted"><Icon.lock />Your reasoning · Not part of the email</div><div className="text-[14px] leading-[1.5]">{m.rationale}</div></div>}
                {m.attachments.length > 0 && <div className="flex flex-wrap gap-2">{m.attachments.map((d) => <button key={d} type="button" className="btn btn-sm" onClick={() => openDoc(d, 0)}><span className="flex text-plum-600"><Icon.file /></span>{view.documents.find((x) => x.id === d)?.shortTitle ?? d}</button>)}</div>}
              </article>
            ))}
            {!compose && !view.readOnly && <div className="border-t border-oat-400 mt-auto" style={{ padding: "16px 32px 24px" }}><button type="button" className="btn btn-primary" onClick={startReply}><Icon.reply />Reply</button></div>}
          </>
        ) : (!compose && <div className="flex-1 flex items-center justify-center text-ink-muted">Select a thread</div>)}
        {compose && <Compose key={draftKey(compose)} state={compose} onChange={putDraft} addressBook={view.addressBook} documents={view.documents} isReply={Boolean(compose.threadId)} readOnly={view.readOnly} forwarded={messageById(compose.forwardedMessageId)} nameOf={name} onDiscard={() => { if (compose.draftId) void fetch("/api/inbox/drafts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: compose.draftId }) }); dropDraft(draftKey(compose)); }} onSent={({ threadId }) => { dropDraft(draftKey(compose)); setSelected(threadId); void load(); }} />}
      </section>

      {/* ---------------------------------------------------------------- documents */}
      {docsOpen && <section aria-label="Documents" className="flex flex-col min-h-0">
        <DocumentPanel open={docs} library={view.documents.map((d) => ({ id: d.id, shortTitle: d.shortTitle, title: d.title, from: d.from }))} layout={layout} onLayout={setLayout} onOpen={(id, slot) => void openDoc(id, slot)} onClose={(slot) => setDocs((p) => { const n = [...p] as (DocView | null)[]; n[slot] = null; if (!n[0] && n[1]) { n[0] = n[1]; n[1] = null; } return n; })} canQuote={!view.readOnly} onQuote={addQuote} flagsEnabled={view.testerFlagsEnabled} roleOf={role} nameOf={name} />
      </section>}

      {library && (
        <div role="dialog" aria-modal="true" aria-label="Document library" className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: "rgba(38,32,42,0.28)" }} onClick={() => setLibrary(false)}>
          <div className="card flex flex-col gap-3" style={{ width: 520, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="display m-0 text-[24px] font-normal">Document library</h2>
            <p className="m-0 text-ink-muted text-[14px]">Every attachment on the deal, in one place. Open one to read it next to your email; use Compare in the panel to add a second.</p>
            <div className="text-[12px] uppercase tracking-[0.08em] text-ink-muted">{view.documents.length} documents</div>
            <ul className="m-0 p-0 list-none flex flex-col gap-1">
              {view.documents.map((d) => <li key={d.id} className="flex items-center justify-between gap-3 p-2 rounded-[16px] hover:bg-oat-300"><div className="flex items-center gap-2 min-w-0"><span className="text-plum-600 flex"><Icon.file /></span><div><div className="text-[15px]">{d.title}</div><div className="text-[12.5px] text-ink-muted">From {name(d.from)} · {role(d.from)}</div></div></div><button type="button" className="btn btn-sm" onClick={() => openDoc(d.id, 0)}>Open</button></li>)}
            </ul>
            <div className="flex justify-end"><button type="button" className="btn" onClick={() => setLibrary(false)}>Close</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
