"use client";
import { useState } from "react";
import { Icon } from "./icons";

const COPY = {
  message: { label: "Flag as unrealistic", ask: "What is unrealistic?", placeholder: "One line: what's unrealistic?" },
  document: { label: "Flag as unrealistic", ask: "What is unrealistic?", placeholder: "One line: what's unrealistic?" },
  thread: { label: "Stuck or going in circles?", ask: "What's going wrong in this conversation?", placeholder: "One line: what's going wrong here?" },
};

/**
 * Tester flag: sits outside the fiction, sends nothing to characters. On an email or a document it
 * reports that piece; on a conversation it reports the conversation itself (stuck, looping, ignored).
 */
export function FlagButton({ targetType, targetId, enabled }: { targetType: "message" | "document" | "thread"; targetId: string; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  if (!enabled) return null;
  if (done) return <span className="text-[12.5px] text-ink-muted">Flagged, thank you.</span>;
  if (!open) return <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}><Icon.flag />{COPY[targetType].label}</button>;
  return (
    <form className="flex items-center gap-2" onSubmit={async (e) => { e.preventDefault(); await fetch("/api/flags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType, targetId, note }) }); setDone(true); }}>
      <input aria-label={COPY[targetType].ask} className="pill-input" style={{ height: 36, width: 260 }} placeholder={COPY[targetType].placeholder} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} required autoFocus />
      <button type="submit" className="btn btn-sm">Send flag</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}
