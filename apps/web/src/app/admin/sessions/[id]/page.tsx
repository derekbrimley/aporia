import { getPool } from "@rematter/db";
import { stuckBeats } from "@rematter/engine";
import { getScenario } from "@/lib/scenario";
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
  const scenario = (await getPool().query<{ scenario_id: string; scenario_version: string }>(`select scenario_id, scenario_version from sessions where id = $1`, [id])).rows[0];
  const beatTitles = new Map(scenario ? getScenario(scenario.scenario_id, scenario.scenario_version).pkg.beats.map((b) => [b.id, b.title]) : []);
  const stuck = stuckBeats(d.state);
  return (
    <Shell user={u} title={`Session ${id.slice(0, 8)}`}>
      {owner && (
        <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 text-sm mb-4" style={{ padding: 18 }}>
          <div>
            <div className="text-ink-muted text-[12px] uppercase">Tester</div>
            {owner.name} · {owner.email}
          </div>
          <div className="flex items-center gap-2">
            <a className="btn btn-sm" href={`/api/admin/sessions/${id}/export`} download title="Transcript, JSON and one CSV per table">
              Download export
            </a>
            <a className="btn btn-sm" href={`/api/admin/sessions/${id}/export?format=transcript`} target="_blank" rel="noreferrer">
              Transcript
            </a>
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
      {stuck.length > 0 && (
        <div className="card text-sm mb-4 bg-plum-50" style={{ padding: 18 }}>
          <div className="text-plum-600 text-[12px] uppercase">Stuck scripted email</div>
          <p className="mt-1">
            Every try at {stuck.length === 1 ? "this email" : "these emails"} failed, so the story is waiting on {stuck.length === 1 ? "it" : "them"}:{" "}
            {stuck.map((b) => `${beatTitles.get(b) ?? b} (${b})`).join(", ")}.
            {" "}{stuck.length === 1 ? "It goes" : "They go"} out again the next time the tester sends an email. Check the worker logs for why the tries failed.
          </p>
        </div>
      )}
      <SessionViewer id={id} detail={JSON.parse(JSON.stringify(d))} cohorts={cohorts} />
    </Shell>
  );
}
