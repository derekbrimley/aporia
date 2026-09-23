import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listSessions } from "@/lib/admin";
import { Shell } from "@/components/admin/Shell";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const u = await requireUser(["internal_admin"]);
  const sessions = (await listSessions()) as Record<string, string | number | boolean | null>[];
  return (
    <Shell user={u} title="Sessions">
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="admin-table">
          <thead><tr><th>Firm / cohort</th><th>Associate</th><th>Status</th><th>Milestone</th><th>Events</th><th>Held</th><th>Last activity</th><th></th></tr></thead>
          <tbody>{sessions.map((s) => <tr key={String(s.id)}><td>{String(s.org)}<div className="text-ink-muted text-[12.5px]">{String(s.cohort)} · {String(s.scenarioId)}@{String(s.scenarioVersion)}{s.testMode ? " · test" : ""}</div></td><td>{String(s.userName)}</td><td>{String(s.status)}</td><td>{String(s.currentMilestone ?? "—")}</td><td>{String(s.events)}</td><td>{Number(s.held) > 0 ? <span className="role-chip role-chip-accent">{String(s.held)}</span> : "0"}</td><td>{s.lastActivityAt ? new Date(String(s.lastActivityAt)).toLocaleString() : "—"}</td><td><Link className="btn btn-sm" href={`/admin/sessions/${s.id}`}>View</Link></td></tr>)}</tbody>
        </table>
      </div>
    </Shell>
  );
}
