"use client";
import { useState } from "react";

type Detail = { state: Record<string, any>; events: { id: string; seq: number; type: string; actor: string; at: string; payload: unknown }[]; generations: Record<string, any>[]; pkg: { id: string; version: string; characters: { id: string; name: string; role_label: string }[] } };

/** Read-only session viewer: state summary, message transcript, event log with replay, per-message generation details. */
export function SessionViewer({ id, detail }: { id: string; detail: Detail }) {
  const [tab, setTab] = useState<"messages" | "events" | "generations" | "state">("messages");
  const [replayed, setReplayed] = useState<string | null>(null);
  const s = detail.state;
  const name = (p: string) => (p === "associate" ? s.associateFirstName || "associate" : detail.pkg.characters.find((c) => c.id === p)?.name ?? p);
  const msgs = (s.messageOrder as string[]).map((m) => s.messages[m]);
  const genByJob = new Map<string, Record<string, any>[]>();
  for (const g of detail.generations) { const k = g.jobKey ?? "-"; genByJob.set(k, [...(genByJob.get(k) ?? []), g]); }
  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-wrap gap-6 text-sm" style={{ padding: 18 }}>
        <div><div className="text-ink-muted text-[12px] uppercase">Status</div>{s.status} · {s.currentMilestone}</div>
        <div><div className="text-ink-muted text-[12px] uppercase">Scenario</div>{detail.pkg.id}@{detail.pkg.version} · engine {s.engineVersion}</div>
        <div><div className="text-ink-muted text-[12px] uppercase">Issues</div>{Object.values(s.issues as Record<string, string>).filter((x) => x === "raised").length} raised · {Object.values(s.issues as Record<string, string>).filter((x) => x === "partial").length} partial · {Object.values(s.issues as Record<string, string>).filter((x) => x === "missed").length} missed</div>
        <div><div className="text-ink-muted text-[12px] uppercase">Consequences</div>{Object.entries(s.consequences as Record<string, string>).map(([k, v]) => `${k}:${v}`).join(" ") || "none"}</div>
        <div><div className="text-ink-muted text-[12px] uppercase">Decisions</div>{Object.entries(s.decisions as Record<string, { position: string }>).map(([k, v]) => `${k}=${v.position}`).join(" ") || "none"}</div>
        <button type="button" className="btn btn-sm ml-auto" onClick={async () => { const r = await fetch(`/api/admin/sessions/${id}`, { method: "POST" }); setReplayed(r.ok ? "Projections rebuilt from the event log." : "Replay failed."); }}>Replay events</button>
        {replayed && <span className="text-ink-muted">{replayed}</span>}
      </div>
      <div className="flex gap-1">{(["messages", "events", "generations", "state"] as const).map((t) => <button key={t} type="button" className="btn btn-sm btn-ghost" aria-pressed={tab === t} style={tab === t ? { background: "var(--color-plum-100)" } : {}} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === "messages" && <div className="flex flex-col gap-3">{msgs.map((m: any) => <article key={m.id} className="card" style={{ padding: 16 }}><div className="text-[13px] text-ink-muted flex gap-3 flex-wrap"><b className="text-ink">{name(m.from)}</b><span>to {m.to.map(name).join(", ")}{m.cc.length ? ` · cc ${m.cc.map(name).join(", ")}` : ""}</span><span>{m.kind}{m.intent ? ` · ${m.intent}` : ""}{m.beatId ? ` · ${m.beatId}` : ""}{m.assignmentId ? ` · ${m.assignmentId}` : ""}</span><span>{new Date(m.at).toLocaleString()}</span></div><div className="display text-[16px] mt-1">{m.subject}</div><div className="email-body mt-2 text-[14px]">{m.body}</div>{m.rationale && <div className="quote mt-2 text-[13.5px]"><b>Rationale (private):</b> {m.rationale}</div>}{m.reflectionQuestions?.length > 0 && <div className="mt-2 text-[13px] text-ink-muted">Reflection questions: {m.reflectionQuestions.join(" | ")}</div>}<GenDetails gens={detail.generations.filter((g) => g.inputRefs?.messageId === m.id || (m.beatId && g.inputRefs?.beatId === m.beatId) || (g.jobKey && m.kind !== "associate" && genByJob.get(g.jobKey)?.length && detail.events.some((e: any) => e.type === "message_delivered" && e.payload.messageId === m.id && e.payload.jobKey === g.jobKey)))} /></article>)}</div>}
      {tab === "events" && <div className="card" style={{ padding: 0, overflow: "hidden" }}><table className="admin-table"><thead><tr><th>Seq</th><th>Type</th><th>Actor</th><th>At</th><th>Payload</th></tr></thead><tbody>{detail.events.map((e) => <tr key={e.id}><td>{e.seq}</td><td>{e.type}</td><td>{e.actor}</td><td>{new Date(e.at).toLocaleString()}</td><td><pre className="m-0 text-[12px] whitespace-pre-wrap max-w-[700px]">{JSON.stringify(e.payload, null, 1).slice(0, 800)}</pre></td></tr>)}</tbody></table></div>}
      {tab === "generations" && <div className="flex flex-col gap-2">{detail.generations.map((g) => <details key={g.id} className="card" style={{ padding: 14 }}><summary className="cursor-pointer text-sm">{g.role} · {g.model} · {g.promptVersion} · attempt {g.attempt} · {g.latencyMs}ms · in {g.inputTokens} / out {g.outputTokens} / cached {g.cacheReadTokens} · checker {g.checkerResult ? (g.checkerResult.pass ? "pass" : "FAIL") : "—"} · {g.jobKey}</summary><h4 className="text-[12px] uppercase text-ink-muted mt-3">System</h4><pre className="text-[12px] whitespace-pre-wrap">{g.systemPrompt}</pre><h4 className="text-[12px] uppercase text-ink-muted">User</h4><pre className="text-[12px] whitespace-pre-wrap">{g.userPrompt}</pre><h4 className="text-[12px] uppercase text-ink-muted">Output</h4><pre className="text-[12px] whitespace-pre-wrap">{g.output}</pre>{g.checkerResult && <><h4 className="text-[12px] uppercase text-ink-muted">Checker</h4><pre className="text-[12px] whitespace-pre-wrap">{JSON.stringify(g.checkerResult, null, 1)}</pre></>}</details>)}</div>}
      {tab === "state" && <pre className="card text-[12px] whitespace-pre-wrap">{JSON.stringify(s, null, 1)}</pre>}
    </div>
  );
}

function GenDetails({ gens }: { gens: Record<string, any>[] }) {
  if (!gens.length) return null;
  return <details className="mt-2"><summary className="cursor-pointer text-[12.5px] text-ink-muted">{gens.length} generation{gens.length > 1 ? "s" : ""}</summary>{gens.map((g) => <div key={g.id} className="text-[12px] text-ink-muted mt-1">{g.role} · {g.model} · {g.promptVersion} · attempt {g.attempt} · {g.latencyMs}ms · checker {g.checkerResult ? (g.checkerResult.pass ? "pass" : "FAIL: " + JSON.stringify(g.checkerResult.violations)) : "—"}</div>)}</details>;
}
