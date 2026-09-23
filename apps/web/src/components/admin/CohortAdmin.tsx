"use client";
import { useState } from "react";

export function CohortAdmin({ role, cohorts, orgs }: { role: string; cohorts: { id: string; name: string; orgId: string; orgName: string; scenarioId: string; scenarioVersion: string; assessorShadowMode: boolean; members: number }[]; orgs: { id: string; name: string; slug: string }[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [invite, setInvite] = useState({ cohortId: cohorts[0]?.id ?? "", email: "", name: "", role: "associate" });
  const [cohort, setCohort] = useState({ orgId: orgs[0]?.id ?? "", orgName: "", orgSlug: "", name: "", assessorShadowMode: true });
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
    <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <div className="card" style={{ padding: 0, overflow: "hidden", gridColumn: "1 / -1" }}>
        <table className="admin-table"><thead><tr><th>Firm</th><th>Cohort</th><th>Scenario</th><th>Assessor</th><th>Members</th></tr></thead><tbody>{cohorts.map((c) => <tr key={c.id}><td>{c.orgName}</td><td>{c.name}</td><td>{c.scenarioId}@{c.scenarioVersion}</td><td>{c.assessorShadowMode ? "shadow (human confirms)" : "live"}</td><td>{c.members}</td></tr>)}</tbody></table>
      </div>
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
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cohort.assessorShadowMode} onChange={(e) => setCohort({ ...cohort, assessorShadowMode: e.target.checked })} />Assessor in shadow mode (recommended for a first cohort)</label>
          <button className="btn btn-primary self-end">Create cohort</button>
        </form>
      )}
      {msg && <p className="text-sm" style={{ gridColumn: "1 / -1" }}>{msg}</p>}
    </div>
  );
}
