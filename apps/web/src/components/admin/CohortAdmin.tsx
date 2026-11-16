"use client";
import { useState } from "react";

type UserRow = { id: string; name: string; email: string; role: string; orgName: string; lastSeenAt: string | null; removedAt: string | null; cohorts: string[]; otherFirms: number };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never");

export function CohortAdmin({ role, cohorts, users, orgs, scenarios, testRuns }: { role: string; users: UserRow[]; testRuns: { count: number; shown: boolean }; cohorts: { id: string; name: string; orgId: string; orgName: string; scenarioId: string; scenarioVersion: string; assessorShadowMode: boolean; members: number }[]; orgs: { id: string; name: string; slug: string }[]; scenarios: { id: string; title: string; version: string; status: string }[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [invite, setInvite] = useState({ cohortId: cohorts[0]?.id ?? "", email: "", name: "", role: "associate" });
  const [cohort, setCohort] = useState({ orgId: orgs[0]?.id ?? "", orgName: "", orgSlug: "", name: "", scenarioId: scenarios[0]?.id ?? "", assessorShadowMode: true });
  async function doInvite(e: React.FormEvent) {
    e.preventDefault();
    const c = cohorts.find((x) => x.id === invite.cohortId);
    const r = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...invite, orgId: c?.orgId }) });
    const j = (await r.json()) as { error?: string; devLink?: string };
    setMsg(r.ok ? `Invited ${invite.email}.${j.devLink ? ` Dev sign-in link: ${j.devLink}` : ""}` : j.error ?? "Failed");
  }
  async function doCohort(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/admin/cohorts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...cohort, orgId: cohort.orgId || undefined, orgName: cohort.orgName || undefined, orgSlug: cohort.orgSlug || undefined }) });
    setMsg(r.ok ? "Cohort created. Reload to see it." : ((await r.json()) as { error?: string }).error ?? "Failed");
  }
  return (
    <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
      <div className="md:col-span-2 text-[14.5px] leading-[1.6] text-ink-muted flex flex-col gap-1.5" style={{ maxWidth: 820 }}>
        <p className="m-0"><strong className="text-ink">Firm</strong>: a customer organization, such as one law firm. Every user belongs to exactly one firm, and a firm's PD admins only see that firm.</p>
        <p className="m-0"><strong className="text-ink">Cohort</strong>: a group of associates in one firm running one simulation together (for example, the fall class on the venture debt deal). An associate gets one session per cohort they are in, and picks between them under "Your matters".</p>
        <p className="m-0"><strong className="text-ink">User</strong>: one person's account in one firm, with one role. The same email can have an account in several firms; the person sees all of their matters either way.</p>
      </div>
      <div className="md:col-span-2 flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="display text-[22px] font-normal m-0">Cohorts</h2>
        {testRuns.count > 0 && <a className="text-sm" href={testRuns.shown ? "/admin/cohorts" : "/admin/cohorts?testRuns=1"}>{testRuns.shown ? "Hide" : "Show"} {testRuns.count} test-run firm{testRuns.count > 1 ? "s" : ""} (one per bot playthrough)</a>}
      </div>
      <div className="card table-card md:col-span-2">
        <table className="admin-table"><thead><tr><th>Firm</th><th>Cohort</th><th>Scenario</th><th>Assessor</th><th>Members</th></tr></thead><tbody>{cohorts.map((c) => <tr key={c.id}><td>{c.orgName}</td><td>{c.name}</td><td>{c.scenarioId}@{c.scenarioVersion}</td><td>{c.assessorShadowMode ? "shadow (human confirms)" : "live"}</td><td>{c.members}</td></tr>)}</tbody></table>
      </div>
      <h2 className="display text-[22px] font-normal m-0 md:col-span-2">Users <span className="text-ink-muted text-[16px]">({users.filter((x) => !x.removedAt).length} active{users.some((x) => x.removedAt) ? `, ${users.filter((x) => x.removedAt).length} removed` : ""})</span></h2>
      <div className="card table-card md:col-span-2">
        <table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Firm</th><th>Role</th><th>Cohorts</th><th>Last seen</th></tr></thead><tbody>{users.map((x) => <tr key={x.id} style={x.removedAt ? { opacity: 0.55 } : undefined}><td>{x.name}{x.removedAt ? " (removed)" : ""}</td><td>{x.email}{x.otherFirms > 0 ? <span className="text-ink-muted" title="This email also has an account in another firm"> · also in {x.otherFirms} other firm{x.otherFirms > 1 ? "s" : ""}</span> : null}</td><td>{x.orgName}</td><td>{x.role.replace("_", " ")}</td><td>{x.cohorts.length ? x.cohorts.join(", ") : <span className="text-ink-muted">none</span>}</td><td>{fmtDate(x.lastSeenAt)}</td></tr>)}</tbody></table>
      </div>
      <h2 className="display text-[22px] font-normal m-0 md:col-span-2">Add</h2>
      <form onSubmit={doInvite} className="card flex flex-col gap-3">
        <h2 className="display text-[20px] font-normal m-0">Invite {role === "pd_admin" ? "an associate" : "a user"}</h2>
        <label className="text-sm">Cohort<select className="text-input mt-1" value={invite.cohortId} onChange={(e) => setInvite({ ...invite, cohortId: e.target.value })}>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.orgName} · {c.name}</option>)}</select></label>
        <label className="text-sm">Name<input className="text-input mt-1" required value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} /></label>
        <label className="text-sm">Email<input className="text-input mt-1" type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></label>
        {role === "internal_admin" && <label className="text-sm">Role<select className="text-input mt-1" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}><option value="associate">associate</option><option value="pd_admin">pd_admin</option><option value="internal_admin">internal_admin</option><option value="internal_rater">internal_rater</option></select></label>}
        <button className="btn btn-primary self-end">Send invitation</button>
      </form>
      {role === "internal_admin" && (
        <form onSubmit={doCohort} className="card flex flex-col gap-3">
          <h2 className="display text-[20px] font-normal m-0">New cohort</h2>
          <label className="text-sm">Firm<select className="text-input mt-1" value={cohort.orgId} onChange={(e) => setCohort({ ...cohort, orgId: e.target.value })}><option value="">New firm…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          {!cohort.orgId && <><label className="text-sm">Firm name<input className="text-input mt-1" value={cohort.orgName} onChange={(e) => setCohort({ ...cohort, orgName: e.target.value })} /></label><label className="text-sm">Firm slug<input className="text-input mt-1" pattern="[a-z0-9-]+" value={cohort.orgSlug} onChange={(e) => setCohort({ ...cohort, orgSlug: e.target.value })} /></label></>}
          <label className="text-sm">Cohort name<input className="text-input mt-1" required value={cohort.name} onChange={(e) => setCohort({ ...cohort, name: e.target.value })} /></label>
          <label className="text-sm">Simulation<select className="text-input mt-1" value={cohort.scenarioId} onChange={(e) => setCohort({ ...cohort, scenarioId: e.target.value })}>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.id}@{s.version}{s.status === "draft" ? ", draft" : ""})</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cohort.assessorShadowMode} onChange={(e) => setCohort({ ...cohort, assessorShadowMode: e.target.checked })} />Assessor in shadow mode (recommended for a first cohort)</label>
          <button className="btn btn-primary self-end">Create cohort</button>
        </form>
      )}
      {msg && <p className="text-sm" style={{ gridColumn: "1 / -1" }}>{msg}</p>}
    </div>
  );
}
