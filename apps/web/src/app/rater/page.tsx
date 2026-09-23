import { getPool } from "@aporia/db";
import { requireUser } from "@/lib/auth";
import { Shell } from "@/components/admin/Shell";

export const dynamic = "force-dynamic";

/** Internal rater view: pseudonymized transcripts (ids only; no names, emails or firm identity). */
export default async function RaterPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const u = await requireUser(["internal_rater", "internal_admin"]);
  const { session } = await searchParams;
  if (!session) {
    const rows = (await getPool().query(`select id, status, current_milestone as m, user_id as uid, (select count(*) from messages x where x.session_id = s.id)::int as n from sessions s where status <> 'not_started' order by last_activity_at desc nulls last limit 200`)).rows;
    return <Shell user={u} title="Transcripts"><div className="card" style={{ padding: 0, overflow: "hidden" }}><table className="admin-table"><thead><tr><th>Session</th><th>Participant</th><th>Status</th><th>Milestone</th><th>Messages</th><th></th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{r.id.slice(0, 8)}</td><td>{r.uid.slice(0, 8)}</td><td>{r.status}</td><td>{r.m}</td><td>{r.n}</td><td><a className="btn btn-sm" href={`/rater?session=${r.id}`}>Read</a></td></tr>)}</tbody></table></div></Shell>;
  }
  const msgs = (await getPool().query(`select id, from_participant as f, to_participants as t, cc_participants as c, subject, body, kind, delivered_at as at from messages where session_id = $1 order by seq asc`, [session])).rows;
  return <Shell user={u} title={`Transcript ${session.slice(0, 8)}`}><div className="flex flex-col gap-3">{msgs.map((m) => <article key={m.id} className="card" style={{ padding: 16 }}><div className="text-[13px] text-ink-muted">{m.f} → {(m.t as string[]).join(", ")}{(m.c as string[]).length ? ` · cc ${(m.c as string[]).join(", ")}` : ""} · {m.kind} · {new Date(m.at).toLocaleString()}</div><div className="display text-[16px] mt-1">{m.subject}</div><div className="email-body mt-2 text-[14px]">{m.body}</div></article>)}</div></Shell>;
}
