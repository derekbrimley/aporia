"use client";
import { useState } from "react";

export function HeldQueue({ held }: { held: { id: string; sessionId: string; jobKey: string; userName: string; violations: unknown; proposedDelivery: { payload: { body: string; from: string; subject: string } }; createdAt: string }[] }) {
  const [items, setItems] = useState(held);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  async function act(id: string, action: "release" | "discard") {
    const r = await fetch(`/api/admin/held/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, body: bodies[id] }) });
    if (r.ok) setItems((x) => x.filter((h) => h.id !== id));
  }
  if (!items.length) return <p className="text-ink-muted">Nothing is held.</p>;
  return (
    <div className="flex flex-col gap-4">
      {items.map((h) => (
        <article key={h.id} className="card flex flex-col gap-3" style={{ padding: 18 }}>
          <div className="text-sm text-ink-muted">{h.userName} · {h.proposedDelivery.payload.from} · {h.jobKey} · {new Date(h.createdAt).toLocaleString()}</div>
          <div className="display text-[17px]">{h.proposedDelivery.payload.subject}</div>
          <pre className="text-[12.5px] whitespace-pre-wrap bg-plum-50 rounded-[14px] p-3 m-0">Violations: {JSON.stringify(h.violations, null, 1)}</pre>
          <textarea className="text-area" style={{ minHeight: 160 }} value={bodies[h.id] ?? h.proposedDelivery.payload.body} onChange={(e) => setBodies({ ...bodies, [h.id]: e.target.value })} />
          <div className="flex gap-2 justify-end"><button type="button" className="btn" onClick={() => act(h.id, "discard")}>Discard</button><button type="button" className="btn btn-primary" onClick={() => act(h.id, "release")}>Release to associate</button></div>
        </article>
      ))}
    </div>
  );
}
