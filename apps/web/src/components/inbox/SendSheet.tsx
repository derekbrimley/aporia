"use client";
import { useState } from "react";
import { Icon } from "./icons";

/**
 * At-send sheet (mock 2.x): asks for the private rationale at a decision point.
 * No minimum length; "Not my answer yet" sends the email as a question instead.
 */
export function SendSheet(props: { prompt: string; title: string; to: string; cc: string; preview: string; quote?: string; onBack: () => void; onSend: (rationale: string) => void; onNotMyAnswer: () => void; busy: boolean }) {
  const [why, setWhy] = useState("");
  const ready = why.trim().length > 0;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sheet-title" className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: "rgba(38,32,42,0.28)" }}>
      <div className="flex flex-col bg-oat-50 border border-oat-500" style={{ width: 520, maxWidth: "calc(100vw - 32px)", borderRadius: 28, boxShadow: "var(--shadow-sheet)" }}>
        <div className="flex flex-col gap-1" style={{ padding: "24px 28px 14px" }}>
          <h2 id="sheet-title" className="display m-0 text-[23px] leading-[1.2] font-normal">Why are you sending this?</h2>
          <div className="text-sm text-ink-muted">This isn't part of the email.</div>
        </div>
        <div className="quote mx-7 gap-1.5">
          <div className="flex flex-wrap gap-1.5 text-[13px] text-ink-muted"><span className="font-semibold text-ink">To</span><span>{props.to}</span>{props.cc && <><span className="ml-1.5 font-semibold text-ink">Cc</span><span>{props.cc}</span></>}</div>
          {props.quote && <div className="display italic text-sm leading-[1.5] text-ink-muted">“{props.quote}”</div>}
          <div className="text-[15px] leading-[1.45] line-clamp-3">{props.preview}</div>
        </div>
        <div className="flex flex-col gap-2 flex-1" style={{ padding: "18px 28px 0" }}>
          <label htmlFor="rationale" className="flex items-center gap-2 text-[14.5px] font-bold text-plum-600"><Icon.lock />Your reasoning</label>
          <div className="text-[13px] text-ink-muted -mt-1">{props.prompt}</div>
          <textarea id="rationale" className="text-area" style={{ minHeight: 110 }} placeholder="Why are you raising this? What does it mean for the client?" value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
        </div>
        <div className="flex items-center justify-between gap-2.5" style={{ padding: "16px 28px 24px" }}>
          <button type="button" className="btn btn-ghost" onClick={props.onNotMyAnswer} disabled={props.busy}>Not my answer yet</button>
          <div className="flex gap-2.5">
            <button type="button" className="btn" onClick={props.onBack} disabled={props.busy}>Back to edit</button>
            <button type="button" className="btn btn-primary" style={{ padding: "0 22px" }} disabled={!ready || props.busy} onClick={() => props.onSend(why)}>Send email<Icon.send /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
