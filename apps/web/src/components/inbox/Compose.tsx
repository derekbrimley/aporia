"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AddressBookEntry, InboxMessage, InboxThread, Quote } from "./types";
import { Icon } from "./icons";
import { Forwarded } from "./Forwarded";

export interface ComposeState { threadId: string | null; to: string[]; cc: string[]; subject: string; body: string; attachments: string[]; quotes: Quote[]; draftId: string; forwardedMessageId: string | null;
  /** Reply or Reply all on a specific email: the message this reply answers. */
  inReplyTo?: string | null;
  /** Display only, set by the inbox: who and when the answered email is from, when it isn't the latest on the thread. */
  replyNote?: { label: string; at: string } | null }

export function emptyCompose(thread?: InboxThread | null, addressBook: AddressBookEntry[] = [], lastFrom?: string, lastTo: string[] = [], lastCc: string[] = [], inReplyTo: string | null = null): ComposeState {
  // The draft id is minted here so every autosave of this draft upserts the same row.
  if (!thread) return { threadId: null, to: [], cc: [], subject: "", body: "", attachments: [], quotes: [], draftId: crypto.randomUUID(), forwardedMessageId: null };
  const toIds = lastFrom && lastFrom !== "associate" ? [lastFrom] : lastTo.filter((x) => x !== "associate");
  const ccIds = [...lastTo, ...lastCc].filter((x) => x !== "associate" && !toIds.includes(x));
  const email = (id: string) => addressBook.find((a) => a.id === id)?.email;
  return { threadId: thread.id, to: toIds.map(email).filter(Boolean) as string[], cc: ccIds.map(email).filter(Boolean) as string[], subject: thread.subject, body: "", attachments: [], quotes: [], draftId: crypto.randomUUID(), forwardedMessageId: null, inReplyTo };
}

/** A new email forwarding a message: a new thread, "Fwd:" subject, the original's attachments carried along. */
export function forwardCompose(m: InboxMessage): ComposeState {
  const subject = /^fwd?:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`;
  return { threadId: null, to: [], cc: [], subject, body: "", attachments: [...m.attachments], quotes: [], draftId: crypto.randomUUID(), forwardedMessageId: m.id };
}

/** What each draft last sent to the server, by draft id, so unchanged drafts aren't re-saved on reopen. */
const lastSaved = new Map<string, string>();
const draftPayload = (s: ComposeState) => JSON.stringify({ id: s.draftId, threadId: s.threadId, to: s.to, cc: s.cc, subject: s.subject || null, body: s.body, attachments: s.attachments, quotes: s.quotes, forwardedMessageId: s.forwardedMessageId, inReplyTo: s.inReplyTo ?? null });
export function markDraftSaved(s: ComposeState) { lastSaved.set(s.draftId, draftPayload(s)); }

function Picker({ label, id, value, onChange, addressBook, exclude }: { label: string; id: string; value: string[]; onChange: (v: string[]) => void; addressBook: AddressBookEntry[]; exclude: string[] }) {
  const options = addressBook.filter((a) => !value.includes(a.email) && !exclude.includes(a.email));
  return (
    <div className="flex items-center gap-2 min-h-[44px] px-1 border-b border-oat-400 flex-wrap py-1">
      <label htmlFor={id} className="w-10 text-[13.5px] text-ink-muted">{label}</label>
      {value.map((e) => {
        const a = addressBook.find((x) => x.email === e);
        return <span key={e} className="flex items-center gap-1 text-[14px] bg-oat-300 rounded-full pl-3 pr-1 h-8">{a?.name ?? e}{a && <span className="role-chip" style={{ padding: "1px 7px" }}>{a.roleLabel}</span>}<button type="button" aria-label={`Remove ${a?.name ?? e}`} data-tip="Remove recipient" className="btn btn-ghost" style={{ height: 28, width: 28, padding: 0 }} onClick={() => onChange(value.filter((x) => x !== e))}><Icon.close /></button></span>;
      })}
      <select id={id} className="bg-transparent border-0 outline-none text-[14px] text-ink-muted flex-1 min-w-[120px] h-8" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
        <option value="">{value.length ? "Add…" : "Choose from the deal…"}</option>
        {options.map((a) => <option key={a.email} value={a.email}>{a.name} · {a.roleLabel}</option>)}
      </select>
    </div>
  );
}

export function Compose(props: {
  state: ComposeState; onChange: (s: ComposeState) => void; addressBook: AddressBookEntry[]; documents: { id: string; shortTitle: string }[];
  isReply: boolean; onDiscard: () => void; onSent: (r: { threadId: string }) => void; readOnly: boolean;
  /** The message being forwarded, when this is a forward. */
  forwarded?: InboxMessage | null; nameOf: (id: string) => string;
  /** Bring the composer into view and put the cursor in the body (after Reply, Reply all, Forward or Compose). */
  focusRequested?: boolean; onFocused?: () => void;
}) {
  const { state, onChange } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saved" | "saving" | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef(state);
  latest.current = state;
  const pending = useRef(false);
  // The last autosave request; send waits for it so a late upsert can't recreate the sent draft.
  const inFlight = useRef<Promise<Response> | null>(null);

  const save = (s: ComposeState) => {
    const body = draftPayload(s);
    const p = fetch("/api/inbox/drafts", { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body }).then((r) => {
      if (r.ok) lastSaved.set(s.draftId, body);
      return r;
    });
    inFlight.current = p;
    return p;
  };
  const cancelSave = () => { pending.current = false; if (saveTimer.current) clearTimeout(saveTimer.current); };

  // Autosave every few seconds; drafts survive reloads. Reopening a draft that hasn't changed
  // since its last save doesn't save it again.
  useEffect(() => {
    if (props.readOnly) return;
    if (!state.body && !state.to.length && !state.quotes.length && !state.forwardedMessageId) return;
    if (lastSaved.get(state.draftId) === draftPayload(state)) return;
    setSaved("saving");
    pending.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      pending.current = false;
      const r = await save(latest.current);
      if (r.ok) setSaved("saved");
    }, 2500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.body, state.to, state.cc, state.subject, state.attachments, state.quotes, state.forwardedMessageId, state.inReplyTo]);

  // Navigating to another thread unmounts the draft; flush any save still waiting on the timer.
  useEffect(() => () => { if (pending.current) void save(latest.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function discard() { cancelSave(); props.onDiscard(); }

  const fullBody = useMemo(() => {
    const quotes = state.quotes.map((q) => `From ${q.documentTitle} · ${q.ref}:\n“${q.text}”`).join("\n\n");
    return quotes ? `${quotes}\n\n${state.body}` : state.body;
  }, [state.quotes, state.body]);

  async function send() {
    setBusy(true); setError(null);
    try {
      // The send deletes the draft row, so no autosave may land after it.
      cancelSave();
      await inFlight.current?.catch(() => undefined);
      const r = await fetch("/api/inbox/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: state.threadId, to: state.to, cc: state.cc, subject: props.isReply ? undefined : state.subject || "(no subject)", body: fullBody, attachments: state.attachments, quotedRefs: state.quotes.map((q) => ({ documentId: q.documentId, ref: q.ref, text: q.text })), draftId: state.draftId, forwardedMessageId: state.forwardedMessageId, inReplyTo: state.inReplyTo ?? null }) });
      const j = (await r.json()) as { error?: string; threadId?: string };
      // Not sent: the draft is still live, so save what autosave was cancelled from saving.
      if (!r.ok) { setError(j.error ?? "Could not send."); void save(latest.current); return; }
      props.onSent({ threadId: j.threadId! });
    } finally { setBusy(false); }
  }

  // Reply on a message near the top of a long thread opens the composer at the bottom, out of sight,
  // so scroll it into view (like a mail client does) and focus the body with the cursor at the end.
  const { focusRequested, onFocused } = props;
  useEffect(() => {
    if (!focusRequested) return;
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // A new email starts with an empty To line, so only replies and forwards jump straight to the body.
    const body = props.isReply || state.forwardedMessageId ? bodyRef.current : null;
    if (body && !body.disabled) {
      body.focus({ preventScroll: true });
      body.setSelectionRange(body.value.length, body.value.length);
    }
    onFocused?.();
  }, [focusRequested, onFocused]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={rootRef} className="flex flex-col flex-1 scroll-mt-14 md:scroll-mt-4 px-3 pb-[calc(16px_+_env(safe-area-inset-bottom))] md:px-7 md:pb-6">
      <div className="flex items-center justify-between h-10 px-1 border-t-2 border-ink text-[12px] font-bold tracking-[0.1em] uppercase">
        <span>{props.isReply ? "Your reply" : state.forwardedMessageId ? "Forward" : "New email"}</span>
        {saved && <span className="text-ink-muted font-medium normal-case tracking-normal">{saved === "saving" ? "Saving draft…" : "Draft saved"}</span>}
      </div>
      <Picker label="To" id="to" value={state.to} onChange={(to) => onChange({ ...state, to })} addressBook={props.addressBook} exclude={state.cc} />
      <Picker label="Cc" id="cc" value={state.cc} onChange={(cc) => onChange({ ...state, cc })} addressBook={props.addressBook} exclude={state.to} />
      {props.isReply && state.replyNote && (
        <div className="flex items-center gap-2 min-h-11 px-1 border-b border-oat-400 text-[13.5px] text-ink-muted"><Icon.reply /><span className="flex-1">Replying to {state.replyNote.label} from {state.replyNote.at}</span>{!props.readOnly && <button type="button" className="btn btn-ghost btn-sm" aria-label="Reply to the thread instead" title="Reply to the thread instead" onClick={() => onChange({ ...state, inReplyTo: null })}><Icon.close /></button>}</div>
      )}
      {!props.isReply && (
        <div className="flex items-center gap-2 h-11 px-1 border-b border-oat-400"><label htmlFor="subject" className="w-14 text-[13.5px] text-ink-muted">Subject</label><input id="subject" className="flex-1 h-10 border-0 bg-transparent text-[15px] outline-none" value={state.subject} onChange={(e) => onChange({ ...state, subject: e.target.value })} /></div>
      )}
      <div className="flex-1 flex flex-col gap-3" style={{ padding: "16px 4px 12px" }}>
        {state.quotes.map((q, i) => (
          <div key={i} className="quote">
            <div className="flex items-center justify-between text-[12px] text-ink-muted"><span>From {q.documentTitle} · {q.ref}</span><button type="button" className="btn btn-ghost btn-sm" aria-label="Remove quote" data-tip="Remove quote" data-tip-align="end" onClick={() => onChange({ ...state, quotes: state.quotes.filter((_, j) => j !== i) })}><Icon.close /></button></div>
            <div className="display italic text-[15.5px] leading-[1.5]">“{q.text}”</div>
          </div>
        ))}
        <label htmlFor="body" className="sr-only">Email body</label>
        <textarea id="body" ref={bodyRef} className="flex-1 border-0 bg-transparent text-[16px] leading-[1.65] outline-none" style={{ minHeight: 140 }} placeholder={props.isReply ? "Write your reply…" : state.forwardedMessageId ? "Add a note…" : "Write your email…"} value={state.body} onChange={(e) => onChange({ ...state, body: e.target.value })} disabled={props.readOnly} />
        {props.forwarded && (
          <div className="relative">
            <Forwarded message={props.forwarded} nameOf={props.nameOf} docTitle={(d) => props.documents.find((x) => x.id === d)?.shortTitle ?? d} />
            {!props.readOnly && <button type="button" className="btn btn-ghost btn-sm absolute top-2 right-2" aria-label="Remove forwarded message" data-tip="Remove forwarded message" data-tip-align="end" onClick={() => onChange({ ...state, forwardedMessageId: null })}><Icon.close /></button>}
          </div>
        )}
        {state.attachments.length > 0 && <div className="flex flex-wrap gap-2">{state.attachments.map((d) => <span key={d} className="btn btn-sm"><Icon.file />{props.documents.find((x) => x.id === d)?.shortTitle ?? d}<button type="button" aria-label="Remove attachment" data-tip="Remove attachment" className="btn btn-ghost" style={{ height: 24, width: 24, padding: 0 }} onClick={() => onChange({ ...state, attachments: state.attachments.filter((x) => x !== d) })}><Icon.close /></button></span>)}</div>}
      </div>
      {error && <p role="alert" className="m-0 mb-2 text-sm text-plum-700">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <select aria-label="Attach a deal document" className="btn btn-sm w-full md:w-auto" value="" onChange={(e) => e.target.value && onChange({ ...state, attachments: [...new Set([...state.attachments, e.target.value])] })} disabled={props.readOnly || !props.documents.length}>
          <option value="">Attach a document…</option>
          {props.documents.filter((d) => !state.attachments.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.shortTitle}</option>)}
        </select>
        <div className="flex gap-2.5 ml-auto">
          <button type="button" className="btn" onClick={discard} disabled={busy}>Discard</button>
          <button type="button" className="btn btn-primary" style={{ padding: "0 22px" }} onClick={() => send()} disabled={busy || props.readOnly || !state.to.length || (!fullBody.trim() && !props.forwarded)}>Send<Icon.send /></button>
        </div>
      </div>
    </div>
  );
}
