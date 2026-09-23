"use client";
import { useState } from "react";

const DIMS = [["realism", "Realism"], ["legalAccuracy", "Legal accuracy"], ["socraticQuality", "Socratic quality"], ["voiceConsistency", "Voice consistency"]] as const;

export function RatingScreen({ sample }: { sample: { id: string; from: string; kind: string; subject: string; body: string }[] }) {
  const [i, setI] = useState(0);
  const [r, setR] = useState<Record<string, number>>({ realism: 3, legalAccuracy: 3, socraticQuality: 3, voiceConsistency: 3 });
  const [acceptable, setAcceptable] = useState(true);
  const [notes, setNotes] = useState("");
  const m = sample[i];
  if (!m) return <p className="text-ink-muted">Nothing left to rate in this sample. Reload for another sample.</p>;
  async function submit() {
    await fetch("/api/admin/ratings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: m!.id, ...r, acceptable, notes }) });
    setI(i + 1); setNotes(""); setAcceptable(true); setR({ realism: 3, legalAccuracy: 3, socraticQuality: 3, voiceConsistency: 3 });
  }
  return (
    <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 360px" }}>
      <article className="card"><div className="text-sm text-ink-muted">{m.from} · {m.kind} · {i + 1} of {sample.length}</div><h2 className="display text-[20px] font-normal mt-1">{m.subject}</h2><div className="email-body">{m.body}</div></article>
      <div className="card flex flex-col gap-4">
        {DIMS.map(([k, label]) => <label key={k} className="flex flex-col gap-1 text-sm"><span className="flex justify-between"><b>{label}</b><span>{r[k]}</span></span><input type="range" min={1} max={5} value={r[k]} onChange={(e) => setR({ ...r, [k]: Number(e.target.value) })} /></label>)}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={acceptable} onChange={(e) => setAcceptable(e.target.checked)} />Would give to a first-year unchanged</label>
        <textarea className="text-area" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex gap-2 justify-end"><button type="button" className="btn" onClick={() => setI(i + 1)}>Skip</button><button type="button" className="btn btn-primary" onClick={submit}>Save rating</button></div>
      </div>
    </div>
  );
}
