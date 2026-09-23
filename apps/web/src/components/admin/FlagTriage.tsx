"use client";
import { useState } from "react";

export function FlagTriage({ flags }: { flags: { id: string; sessionId: string; targetType: string; targetId: string; note: string; status: string; createdAt: string; userName: string }[] }) {
  const [items, setItems] = useState(flags);
  async function set(id: string, status: "triaged" | "dismissed" | "open") {
    await fetch(`/api/admin/flags/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    setItems((x) => x.map((f) => (f.id === id ? { ...f, status } : f)));
  }
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="admin-table">
        <thead><tr><th>When</th><th>Who</th><th>Target</th><th>Note</th><th>Status</th><th></th></tr></thead>
        <tbody>{items.map((f) => <tr key={f.id}><td>{new Date(f.createdAt).toLocaleString()}</td><td>{f.userName}</td><td>{f.targetType} <span className="text-ink-muted">{f.targetId.slice(0, 8)}</span><div><a className="text-plum-600 text-[12.5px]" href={`/admin/sessions/${f.sessionId}`}>session</a></div></td><td>{f.note}</td><td>{f.status}</td><td className="whitespace-nowrap"><button type="button" className="btn btn-sm" onClick={() => set(f.id, "triaged")}>Triaged</button> <button type="button" className="btn btn-sm btn-ghost" onClick={() => set(f.id, "dismissed")}>Dismiss</button></td></tr>)}{!items.length && <tr><td colSpan={6} className="text-ink-muted">No flags yet.</td></tr>}</tbody>
      </table>
    </div>
  );
}
