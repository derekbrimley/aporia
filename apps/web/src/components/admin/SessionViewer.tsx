"use client";
import { useState } from "react";
import { LocalTime } from "@/components/LocalTime";

type Detail = { state: Record<string, any>; events: { id: string; seq: number; type: string; actor: string; at: string; payload: unknown }[]; generations: Record<string, any>[]; checkpoints: { eventCount: number; label: string }[]; rollbackPoints: RollbackPoint[]; lineage: Lineage; pkg: { id: string; version: string; characters: { id: string; name: string; role_label: string }[]; assignments?: ScorecardAssignment[] } };
type ScorecardAssignment = { id: string; milestone: string; title: string; deliverable: string; threadKey?: string | null; issues: { id: string; tier: string; title: string; description: string; raisedLooksLike: string }[] };

type RollbackPoint = { eventCount: number; beforeMessageId: string | null; milestoneId: string | null };
type Lineage = { archivedAt: string | null; forkedFromSessionId: string | null; forkedFromEventCount: number | null; replacedBy: string | null };

/** Read-only session viewer: state summary, message transcript, event log with replay, per-message generation details. */
type SourceCohort = { id: string; name: string; orgName: string; isSource: boolean };

export function SessionViewer({ id, detail, cohorts }: { id: string; detail: Detail; cohorts: SourceCohort[] }) {
  const [tab, setTab] = useState<"scorecard" | "messages" | "events" | "generations" | "state">("scorecard");
  const [replayed, setReplayed] = useState<string | null>(null);
  const [rollbackTo, setRollbackTo] = useState<number | null>(null);
  const s = detail.state;
  const name = (p: string) => (p === "associate" ? s.associateFirstName || "associate" : detail.pkg.characters.find((c) => c.id === p)?.name ?? p);
  const msgs = (s.messageOrder as string[]).map((m) => s.messages[m]);
  const rollbackBefore = new Map(detail.rollbackPoints.filter((p) => p.beforeMessageId).map((p) => [p.beforeMessageId!, p.eventCount] as const));
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
      <Rollback id={id} detail={detail} name={name} selected={rollbackTo} onSelect={setRollbackTo} />
      <CheckpointSource id={id} checkpoints={detail.checkpoints} cohorts={cohorts} />
      <div className="flex flex-wrap gap-1">{(["scorecard", "messages", "events", "generations", "state"] as const).map((t) => <button key={t} type="button" className="btn btn-sm btn-ghost" aria-pressed={tab === t} style={tab === t ? { background: "var(--color-plum-100)" } : {}} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === "scorecard" && <Scorecard detail={detail} name={name} />}
      {tab === "messages" && <div className="flex flex-col gap-3">{msgs.map((m: any) => <article key={m.id} className="card" style={{ padding: 16 }}><div className="text-[13px] text-ink-muted flex gap-3 flex-wrap"><b className="text-ink">{name(m.from)}</b><span>to {m.to.map(name).join(", ")}{m.cc.length ? ` · cc ${m.cc.map(name).join(", ")}` : ""}</span><span>{m.kind}{m.intent ? ` · ${m.intent}` : ""}{m.beatId ? ` · ${m.beatId}` : ""}{m.assignmentId ? ` · ${m.assignmentId}` : ""}</span><span><LocalTime iso={m.at} /></span>{rollbackBefore.has(m.id) && <button type="button" className="btn btn-sm btn-ghost ml-auto" title="Undo this email and everything after it" onClick={() => { setRollbackTo(rollbackBefore.get(m.id)!); document.getElementById("rollback")?.scrollIntoView({ behavior: "smooth" }); }}>Roll back to before this</button>}</div><div className="display text-[16px] mt-1">{m.subject}</div><div className="email-body mt-2 text-[14px]">{m.body}</div>{m.rationale && <div className="quote mt-2 text-[13.5px]"><b>Rationale (private):</b> {m.rationale}</div>}{m.reflectionQuestions?.length > 0 && <div className="mt-2 text-[13px] text-ink-muted">Reflection questions: {m.reflectionQuestions.join(" | ")}</div>}<GenDetails gens={detail.generations.filter((g) => g.inputRefs?.messageId === m.id || (m.beatId && g.inputRefs?.beatId === m.beatId) || (g.jobKey && m.kind !== "associate" && genByJob.get(g.jobKey)?.length && detail.events.some((e: any) => e.type === "message_delivered" && e.payload.messageId === m.id && e.payload.jobKey === g.jobKey)))} /></article>)}</div>}
      {tab === "events" && <div className="card table-card"><table className="admin-table"><thead><tr><th>Seq</th><th>Type</th><th>Actor</th><th>At</th><th>Payload</th></tr></thead><tbody>{detail.events.map((e) => <tr key={e.id}><td>{e.seq}</td><td>{e.type}</td><td>{e.actor}</td><td><LocalTime iso={e.at} /></td><td><pre className="m-0 text-[12px] whitespace-pre-wrap max-w-[700px]">{JSON.stringify(e.payload, null, 1).slice(0, 800)}</pre></td></tr>)}</tbody></table></div>}
      {tab === "generations" && <div className="flex flex-col gap-2">{detail.generations.map((g) => <details key={g.id} className="card" style={{ padding: 14 }}><summary className="cursor-pointer text-sm">{g.role} · {g.model} · {g.promptVersion} · attempt {g.attempt} · {g.latencyMs}ms · in {g.inputTokens} / out {g.outputTokens} / cached {g.cacheReadTokens} · checker {g.checkerResult ? (g.checkerResult.pass ? "pass" : "FAIL") : "—"} · {g.jobKey}</summary><h4 className="text-[12px] uppercase text-ink-muted mt-3">System</h4><pre className="text-[12px] whitespace-pre-wrap">{g.systemPrompt}</pre><h4 className="text-[12px] uppercase text-ink-muted">User</h4><pre className="text-[12px] whitespace-pre-wrap">{g.userPrompt}</pre><h4 className="text-[12px] uppercase text-ink-muted">Output</h4><pre className="text-[12px] whitespace-pre-wrap">{g.output}</pre>{g.checkerResult && <><h4 className="text-[12px] uppercase text-ink-muted">Checker</h4><pre className="text-[12px] whitespace-pre-wrap">{JSON.stringify(g.checkerResult, null, 1)}</pre></>}</details>)}</div>}
      {tab === "state" && <pre className="card text-[12px] whitespace-pre-wrap">{JSON.stringify(s, null, 1)}</pre>}
    </div>
  );
}

function GenDetails({ gens }: { gens: Record<string, any>[] }) {
  if (!gens.length) return null;
  return <details className="mt-2"><summary className="cursor-pointer text-[12.5px] text-ink-muted">{gens.length} generation{gens.length > 1 ? "s" : ""}</summary>{gens.map((g) => <div key={g.id} className="text-[12px] text-ink-muted mt-1">{g.role} · {g.model} · {g.promptVersion} · attempt {g.attempt} · {g.latencyMs}ms · checker {g.checkerResult ? (g.checkerResult.pass ? "pass" : "FAIL: " + JSON.stringify(g.checkerResult.violations)) : "—"}</div>)}</details>;
}

/**
 * Roll the tester's session back to an earlier point, or start them over. Nothing is deleted: this run is
 * archived (it stays here and in exports) and the kept part is replayed into a new session.
 */
function Rollback({ id, detail, name, selected, onSelect }: { id: string; detail: Detail; name: (p: string) => string; selected: number | null; onSelect: (n: number | null) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const s = detail.state;
  const { lineage } = detail;
  const total = detail.events.length;
  const milestoneLabel = new Map(detail.checkpoints.map((c) => [c.eventCount, c.label]));
  const label = (p: RollbackPoint) => {
    const m = p.beforeMessageId ? s.messages[p.beforeMessageId] : null;
    const n = m ? (s.messageOrder as string[]).indexOf(m.id) + 1 : 0;
    const before = m ? `before email ${n}: ${m.from === "associate" ? `${name("associate")}'s email` : `${name(m.from)}'s ${m.kind === "beat" ? "email" : m.kind}`} "${m.subject}"` : "";
    const start = p.milestoneId ? `Start of ${milestoneLabel.get(p.eventCount) ?? p.milestoneId}` : "";
    return [start, start && before ? `(${before})` : before.charAt(0).toUpperCase() + before.slice(1)].filter(Boolean).join(" ");
  };
  const undone = (n: number) => detail.events.filter((e) => e.seq > n && (e.type === "email_sent" || e.type === "message_delivered")).length;
  const value = selected ?? "";
  async function go() {
    if (selected == null) return;
    setBusy(true);
    const r = await fetch(`/api/admin/sessions/${id}/rollback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventCount: selected }) });
    const b = (await r.json().catch(() => ({}))) as { error?: string; sessionId?: string | null };
    setBusy(false);
    setConfirming(false);
    if (!r.ok) return setMsg(b.error ?? "Rollback failed.");
    if (b.sessionId) window.location.href = `/admin/sessions/${b.sessionId}`;
    else { setMsg("Reset. This run is archived; the tester gets a fresh session the next time they open their inbox."); setTimeout(() => window.location.reload(), 1500); }
  }
  return (
    <div id="rollback" className="card flex flex-col gap-2 text-sm" style={{ padding: 18 }}>
      <div className="text-ink-muted text-[12px] uppercase">Roll back</div>
      {lineage.forkedFromSessionId && (
        <div>
          Copied from <a className="underline" href={`/admin/sessions/${lineage.forkedFromSessionId}`}>session {lineage.forkedFromSessionId.slice(0, 8)}</a>
          {lineage.forkedFromEventCount != null ? ` (its first ${lineage.forkedFromEventCount} events)` : ""}.
        </div>
      )}
      {lineage.archivedAt && (
        <div>
          This run is archived (<LocalTime iso={lineage.archivedAt} />).{" "}
          {lineage.replacedBy ? <>Replaced by <a className="underline" href={`/admin/sessions/${lineage.replacedBy}`}>session {lineage.replacedBy.slice(0, 8)}</a>. </> : null}
          Rolling it back replaces the tester&apos;s current run in this matter.
        </div>
      )}
      <p className="m-0 text-ink-muted">
        Pick a point: the tester&apos;s inbox goes back to just before it. This run is archived, not deleted, so it stays here and in exports. Replies and scripted emails after the point are written again by the model as the tester plays on. The tester gets no email about it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="text-input" style={{ maxWidth: 640 }} value={value} onChange={(e) => { onSelect(e.target.value === "" ? null : Number(e.target.value)); setConfirming(false); setMsg(null); }}>
          <option value="">Choose a point…</option>
          <option value={0}>Start over: archive this run, fresh session on their next visit</option>
          {detail.rollbackPoints.map((p) => <option key={p.eventCount} value={p.eventCount}>{label(p)}</option>)}
        </select>
        {selected != null && !confirming && <button type="button" className="btn btn-sm" onClick={() => setConfirming(true)}>Roll back…</button>}
      </div>
      {selected != null && confirming && (
        <div className="flex flex-wrap items-center gap-3 bg-plum-50" style={{ padding: 12, borderRadius: 8 }}>
          <span>
            {selected === 0
              ? `Archive this run (${total} events, ${undone(0)} emails) and start ${name("associate")} over from the welcome email?`
              : `Keep ${selected} of ${total} events and undo ${undone(selected)} email${undone(selected) === 1 ? "" : "s"}?`}
          </span>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void go()}>{busy ? "Rolling back…" : selected === 0 ? "Start over" : "Roll back"}</button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}
      {msg && <span className="text-ink-muted">{msg}</span>}
    </div>
  );
}

/** Test checkpoints this run offers, and which cohorts load from it. */
function CheckpointSource({ id, checkpoints, cohorts }: { id: string; checkpoints: { eventCount: number; label: string }[]; cohorts: SourceCohort[] }) {
  const [cohortId, setCohortId] = useState(cohorts.find((c) => !c.isSource)?.id ?? cohorts[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const using = cohorts.filter((c) => c.isSource);
  async function set(cid: string, sessionId: string | null) {
    const r = await fetch("/api/admin/cohorts/checkpoints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cohortId: cid, sessionId }) });
    setMsg(r.ok ? (sessionId ? "Saved. Associates in that cohort now see a checkpoint menu in their inbox. Reload to update this list." : "Turned off for that cohort. Reload to update this list.") : ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Failed");
  }
  return (
    <div className="card flex flex-col gap-2 text-sm" style={{ padding: 18 }}>
      <div className="text-ink-muted text-[12px] uppercase">Test checkpoints</div>
      {checkpoints.length ? <div>{checkpoints.map((c) => c.label).join(" · ")}</div> : <div className="text-ink-muted">This run hasn't reached a milestone yet.</div>}
      {using.length > 0 && <div>Loaded from by: {using.map((c) => <span key={c.id} className="mr-3">{c.orgName} · {c.name} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void set(c.id, null)}>Turn off</button></span>)}</div>}
      {checkpoints.length > 0 && cohorts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select className="text-input" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.orgName} · {c.name}</option>)}</select>
          <button type="button" className="btn btn-sm" disabled={!cohortId} onClick={() => void set(cohortId, id)}>Use this run for that cohort</button>
        </div>
      )}
      {msg && <span className="text-ink-muted">{msg}</span>}
    </div>
  );
}

const RESULT_STYLE: Record<string, { label: string; color: string }> = {
  raised: { label: "Raised", color: "#1e7a46" },
  partial: { label: "Partial", color: "#9a6700" },
  missed: { label: "Missed", color: "#b42318" },
};

/**
 * One card per assignment: what was asked, which email was graded as the deliverable, the
 * assessor's summary, and each answer-key issue with its result. Reads the scenario's
 * assignments.yaml (sent with the detail) and the session's assessment events.
 */
export function Scorecard({ detail, name }: { detail: Detail; name: (p: string) => string }) {
  const s = detail.state;
  const assignments = detail.pkg.assignments ?? [];
  if (!assignments.length) return <p className="text-ink-muted text-sm">This scenario has no assignments.</p>;
  // The assessment that completed each assignment (not probes or late second deliverables).
  const assessed = new Map<string, { summary?: string; reasoningQuality?: string; at: string }>();
  for (const e of detail.events) {
    if (e.type !== "assessment_recorded") continue;
    const p = e.payload as { messageId: string; assignmentId: string; summary?: string; reasoningQuality?: string; probe?: boolean };
    if (s.assignments[p.assignmentId]?.deliverableMessageId === p.messageId) assessed.set(p.assignmentId, { summary: p.summary, reasoningQuality: p.reasoningQuality, at: e.at });
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-muted text-[13px] m-0">The answer key comes from the scenario&apos;s assignments.yaml. &quot;Graded email&quot; is the message the engine took as the deliverable; if it looks like the wrong email, the score reflects that email, not the associate&apos;s best work.</p>
      {assignments.map((a) => {
        const st = s.assignments[a.id] as { status: string; deliverableMessageId: string | null } | undefined;
        const msg = st?.deliverableMessageId ? s.messages[st.deliverableMessageId] : undefined;
        const info = assessed.get(a.id);
        const gradedThreadKey = msg ? (s.threads[msg.threadId] as { key: string | null } | undefined)?.key ?? null : null;
        const offThread = Boolean(msg && a.threadKey && gradedThreadKey !== a.threadKey);
        const counts = { raised: 0, partial: 0, missed: 0 } as Record<string, number>;
        for (const i of a.issues) { const r = s.issues[i.id]; if (r && r in counts) counts[r]! += 1; }
        return (
          <details key={a.id} className="card" style={{ padding: 16 }} open={st?.status === "complete" && a.issues.length > 0}>
            <summary className="cursor-pointer flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <b className="text-ink">{a.id}</b>
              <span className="display text-[16px]">{a.title}</span>
              <span className="text-ink-muted text-[13px]">{a.milestone} · {st?.status ?? "pending"}</span>
              {a.issues.length > 0 && st?.status === "complete" && (
                <span className="text-[13px] ml-auto">
                  {(["raised", "partial", "missed"] as const).map((k) => <span key={k} style={{ color: RESULT_STYLE[k]!.color, marginLeft: 10 }}>{counts[k]} {k}</span>)}
                </span>
              )}
            </summary>
            <div className="mt-3 text-[14px] flex flex-col gap-2">
              <div><span className="text-ink-muted text-[12px] uppercase">Asked for</span><div>{a.deliverable}</div></div>
              <div>
                <span className="text-ink-muted text-[12px] uppercase">Graded email</span>
                {msg ? (
                  <div>
                    {offThread && <div className="text-[13px]" style={{ color: RESULT_STYLE.partial!.color }}>Graded from another thread, not this assignment&apos;s own: check it is the email the associate meant as this deliverable.</div>}
                    <b>{msg.subject}</b> <span className="text-ink-muted">· to {(msg.to as string[]).map(name).join(", ")} · <LocalTime iso={msg.at} /></span>
                    <div className="email-body text-[13px] text-ink-muted mt-1" style={{ maxHeight: 96, overflow: "hidden" }}>{String(msg.body).slice(0, 400)}{String(msg.body).length > 400 ? "…" : ""}</div>
                  </div>
                ) : <div className="text-ink-muted">{st?.status === "complete" ? "Completed without a graded email." : "Not submitted yet."}</div>}
              </div>
              {info?.summary && <div><span className="text-ink-muted text-[12px] uppercase">Assessor summary{info.reasoningQuality ? ` · reasoning ${info.reasoningQuality}` : ""}</span><div>{info.summary}</div></div>}
              {a.issues.length > 0 && (
                <table className="admin-table mt-1">
                  <thead><tr><th>Issue</th><th>Result</th><th>What a strong answer catches</th></tr></thead>
                  <tbody>
                    {a.issues.map((i) => {
                      const r = s.issues[i.id] as string | undefined;
                      const style = r ? RESULT_STYLE[r] : undefined;
                      return (
                        <tr key={i.id}>
                          <td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}><b>{i.id}</b><div className="text-ink-muted text-[12px]">{i.tier}</div></td>
                          <td style={{ verticalAlign: "top", color: style?.color }}>{style?.label ?? "—"}</td>
                          <td style={{ verticalAlign: "top" }}><div><b>{i.title}.</b> {i.description}</div><div className="text-ink-muted text-[12.5px] mt-1">Raised looks like: {i.raisedLooksLike}</div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
