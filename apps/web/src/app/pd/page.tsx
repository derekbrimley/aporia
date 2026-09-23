import { requireUser } from "@/lib/auth";
import { roster } from "@/lib/pd";
import { Shell } from "@/components/admin/Shell";

export const dynamic = "force-dynamic";

/** PD director view: status, current milestone, last active, total active time. No scores, issue status or rationales. */
export default async function PdPage() {
  const u = await requireUser(["pd_admin", "internal_admin"]);
  const rows = await roster(u.orgId);
  const label: Record<string, string> = { invited: "Invited", not_started: "Not started", in_progress: "In progress", completed: "Completed" };
  return (
    <Shell user={u} title="Cohort progress">
      <p className="text-ink-muted text-sm mb-4 max-w-[720px]">This view shows progress only. Associates' emails, work product and reasoning are private to them, which is what lets them write honestly.</p>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="admin-table">
          <thead><tr><th>Cohort</th><th>Associate</th><th>Status</th><th>Current milestone</th><th>Last active</th><th>Active time</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.cohortId + r.userId}><td>{r.cohortName}</td><td>{r.name}<div className="text-ink-muted text-[12.5px]">{r.email}</div></td><td>{label[r.status] ?? r.status}</td><td>{r.status === "in_progress" ? r.currentMilestone : "—"}</td><td>{r.lastActiveAt ? new Date(r.lastActiveAt).toLocaleDateString() : "—"}</td><td>{r.activeMinutes ? `${Math.floor(r.activeMinutes / 60)}h ${r.activeMinutes % 60}m` : "—"}</td></tr>)}
            {!rows.length && <tr><td colSpan={6} className="text-ink-muted">No associates yet. Invite them from Cohorts and users.</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
