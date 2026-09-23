"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AddressBookEntry, InboxThread, Quote } from "./types";
import { Icon } from "./icons";
import { SendSheet } from "./SendSheet";

export interface ComposeState { threadId: string | null; to: string[]; cc: string[]; subject: string; body: string; attachments: string[]; quotes: Quote[]; draftId: string | null }

export function emptyCompose(thread?: InboxThread | null, addressBook: AddressBookEntry[] = [], lastFrom?: string, lastTo: string[] = [], lastCc: string[] = []): ComposeState {
  if (!thread) return { threadId: null, to: [], cc: [], subject: "", body: "", attachments: [], quotes: [], draftId: null };
  const toIds = lastFrom && lastFrom !== "associate" ? [lastFrom] : lastTo.filter((x) => x !== "associate");
  const ccIds = [...lastTo, ...lastCc].filter((x) => x !== "associate" && !toIds.includes(x));
  const email = (id: string) => addressBook.find((a) => a.id === id)?.email;
  return { threadId: thread.id, to: toIds.map(email).filter(Boolean) as string[], cc: ccIds.map(email).filter(Boolean) as string[], subject: thread.subject, body: "", attachments: [], quotes: [], draftId: null };
}

function Picker({ label, id, value, onChange, addressBook, exclude }: { label: string; id: string; value: string[]; onChange: (v: string[]) => void; addressBook: AddressBookEntry[]; exclude: string[] }) {
  const options = addressBook.filter((a) => !value.includes(a.email) && !exclude.includes(a.email));
  return (
    <div className="flex items-center gap-2 min-h-[44px] px-1 border-b border-oat-400 flex-wrap py-1">
      <label htmlFor={id} className="w-10 text-[13.5px] text-ink-muted">{label}</label>
      {value.map((e) => {
        const a = addressBook.find((x) => x.email === e);
        return <span key={e} className="flex items-center gap-1 text-[14px] bg-oat-300 rounded-full pl-3 pr-1 h-8">{a?.name ?? e}{a && <span className="role-chip" style={{ padding: "1px 7px" }}>{a.roleLabel}</span>}<button type="button" aria-label={`Remove ${a?.name ?? e}`} className="btn btn-ghost" style={{ height: 28, width: 28, padding: 0 }} onClick={() => onChange(value.filter((x) => x !== e))}><Icon.close /></button></span>;
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
}) {
  const { state, onChange } = props;
  const [sheet, setSheet] = useState<{ prompt: string; title: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saved" | "saving" | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Autosave every few seconds; drafts survive reloads.
  useEffect(() => {
    if (props.readOnly) return;
    if (!state.body && !state.to.length) return;
    setSaved("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const r = await fetch("/api/inbox/drafts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: state.draftId ?? undefined, threadId: state.threadId, to: state.to, cc: state.cc, subject: state.subject || null, body: state.body, attachments: state.attachments }) });
      if (r.ok) { const j = (await r.json()) as { id: string }; if (!state.draftId) onChange({ ...state, draftId: j.id }); setSaved("saved"); }
    }, 2500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.body, state.to, state.cc, state.subject, state.attachments]);

  const fullBody = useMemo(() => {
    const quotes = state.quotes.map((q) => `From ${q.documentTitle} · ${q.ref}:\n“${q.text}”`).join("\n\n");
    return quotes ? `${quotes}\n\n${state.body}` : state.body;
  }, [state.quotes, state.body]);

  async function send(extra: { rationale?: string; decisionPointId?: string; notMyAnswerYet?: boolean } = {}) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/inbox/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: state.threadId, to: state.to, cc: state.cc, subject: props.isReply ? undefined : state.subject || "(no subject)", body: fullBody, attachments: state.attachments, quotedRefs: state.quotes.map((q) => ({ documentId: q.documentId, ref: q.ref, text: q.text })), draftId: state.draftId, ...extra }) });
      const j = (await r.json()) as { needsRationale?: boolean; decisionPoint?: { id: string; title: string; prompt: string }; error?: string; threadId?: string };
      if (!r.ok) { setError(j.error ?? "Could not send."); return; }
      if (j.needsRationale && j.decisionPoint) { setSheet({ prompt: j.decisionPoint.prompt, title: j.decisionPoint.title, id: j.decisionPoint.id }); return; }
      setSheet(null);
      props.onSent({ threadId: j.threadId! });
    } finally { setBusy(false); }
  }

  const names = (emails: string[]) => emails.map((e) => props.addressBook.find((a) => a.email === e)?.name ?? e).join(", ");
  return (
    <div className="flex flex-col flex-1" style={{ padding: "0 28px 24px" }}>
      <div className="flex items-center justify-between h-10 px-1 border-t-2 border-ink text-[12px] font-bold tracking-[0.1em] uppercase">
        <span>{props.isReply ? "Your reply" : "New email"}</span>
        {saved && <span className="text-ink-muted font-medium normal-case tracking-normal">{saved === "saving" ? "Saving draft…" : "Draft saved"}</span>}
      </div>
      <Picker label="To" id="to" value={state.to} onChange={(to) => onChange({ ...state, to })} addressBook={props.addressBook} exclude={state.cc} />
      <Picker label="Cc" id="cc" value={state.cc} onChange={(cc) => onChange({ ...state, cc })} addressBook={props.addressBook} exclude={state.to} />
      {!props.isReply && (
        <div className="flex items-center gap-2 h-11 px-1 border-b border-oat-400"><label htmlFor="subject" className="w-14 text-[13.5px] text-ink-muted">Subject</label><input id="subject" className="flex-1 h-10 border-0 bg-transparent text-[15px] outline-none" value={state.subject} onChange={(e) => onChange({ ...state, subject: e.target.value })} /></div>
      )}
      <div className="flex-1 flex flex-col gap-3" style={{ padding: "16px 4px 12px" }}>
        {state.quotes.map((q, i) => (
          <div key={i} className="quote">
            <div className="flex items-center justify-between text-[12px] text-ink-muted"><span>From {q.documentTitle} · {q.ref}</span><button type="button" className="btn btn-ghost btn-sm" aria-label="Remove quote" onClick={() => onChange({ ...state, quotes: state.quotes.filter((_, j) => j !== i) })}><Icon.close /></button></div>
            <div className="display italic text-[15.5px] leading-[1.5]">“{q.text}”</div>
          </div>
        ))}
        <label htmlFor="body" className="sr-only">Email body</label>
        <textarea id="body" ref={bodyRef} className="flex-1 border-0 bg-transparent text-[16px] leading-[1.65] outline-none" style={{ minHeight: 140 }} placeholder={props.isReply ? "Write your reply…" : "Write your email…"} value={state.body} onChange={(e) => onChange({ ...state, body: e.target.value })} disabled={props.readOnly} />
        {state.attachments.length > 0 && <div className="flex flex-wrap gap-2">{state.attachments.map((d) => <span key={d} className="btn btn-sm"><Icon.file />{props.documents.find((x) => x.id === d)?.shortTitle ?? d}<button type="button" aria-label="Remove attachment" className="btn btn-ghost" style={{ height: 24, width: 24, padding: 0 }} onClick={() => onChange({ ...state, attachments: state.attachments.filter((x) => x !== d) })}><Icon.close /></button></span>)}</div>}
      </div>
      {error && <p role="alert" className="m-0 mb-2 text-sm text-plum-700">{error}</p>}
      <div className="flex items-center justify-between gap-2.5">
        <select aria-label="Attach a deal document" className="btn btn-sm" value="" onChange={(e) => e.target.value && onChange({ ...state, attachments: [...new Set([...state.attachments, e.target.value])] })} disabled={props.readOnly || !props.documents.length}>
          <option value="">Attach a document…</option>
          {props.documents.filter((d) => !state.attachments.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.shortTitle}</option>)}
        </select>
        <div className="flex gap-2.5">
          <button type="button" className="btn" onClick={props.onDiscard} disabled={busy}>Discard</button>
          <button type="button" className="btn btn-primary" style={{ padding: "0 22px" }} onClick={() => send()} disabled={busy || props.readOnly || !state.to.length || !fullBody.trim()}>Send<Icon.send /></button>
        </div>
      </div>
      {sheet && <SendSheet prompt={sheet.prompt} title={sheet.title} to={names(state.to)} cc={names(state.cc)} preview={state.body} quote={state.quotes[0]?.text} busy={busy} onBack={() => setSheet(null)} onSend={(rationale) => send({ rationale, decisionPointId: sheet.id })} onNotMyAnswer={() => send({ notMyAnswerYet: true, decisionPointId: sheet.id })} />}
    </div>
  );
}
