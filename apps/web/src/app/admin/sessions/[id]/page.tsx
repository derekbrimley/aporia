import { getPool } from "@rematter/db";
import { requireUser, audit } from "@/lib/auth";
import { sessionDetail } from "@/lib/admin";
import { cohortsForSource } from "@/lib/checkpoints";
import { Shell } from "@/components/admin/Shell";
import { SessionViewer } from "@/components/admin/SessionViewer";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser(["internal_admin"]);
  const { id } = await params;
  const d = await sessionDetail(id);
  if (!d) return <Shell user={u} title="Session not found"><p>No session with that id.</p></Shell>;
  await audit(u, "session.view", id);
  const cohorts = await cohortsForSource(id);
  const owner = (
    await getPool().query<{ name: string; email: string; role: string; removed_at: Date | null; archived_at: Date | null }>(
      `select u.name, u.email, u.role, u.removed_at, s.archived_at from sessions s join users u on u.id = s.user_id where s.id = $1`,
      [id],
    )
  ).rows[0];
  const canViewAs = owner && owner.role === "associate" && !owner.removed_at;
  return (
    <Shell user={u} title={`Session ${id.slice(0, 8)}`}>
      {owner && (
        <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 text-sm mb-4" style={{ padding: 18 }}>
          <div>
            <div className="text-ink-muted text-[12px] uppercase">Tester</div>
            {owner.name} · {owner.email}
          </div>
          {canViewAs && (
            <form action={`/api/admin/sessions/${id}/view-as`} method="post" className="ml-auto flex items-center gap-3">
              <span className="text-ink-muted text-[13px]">
                {owner.archived_at
                  ? "This run was replaced; their inbox shows their current run in this matter."
                  : "Opens their inbox as they see it. Read-only, for 2 hours."}
              </span>
              <button className="btn btn-sm btn-primary">Log in as {owner.name.split(" ")[0]}</button>
            </form>
          )}
        </div>
      )}
      <SessionViewer id={id} detail={JSON.parse(JSON.stringify(d))} cohorts={cohorts} />
    </Shell>
  );
}
