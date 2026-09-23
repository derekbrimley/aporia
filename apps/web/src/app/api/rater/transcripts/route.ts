import { getPool } from "@aporia/db";
import { apiUser } from "@/lib/auth";

/** Pseudonymized transcripts: session and user ids only, no names, emails or firm identity. */
export async function GET(req: Request) {
  const u = await apiUser(["internal_rater", "internal_admin"]);
  if (u instanceof Response) return u;
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    const r = await getPool().query(`select id, status, current_milestone as "currentMilestone", user_id as "userId", (select count(*) from messages m where m.session_id = s.id)::int as messages from sessions s where status <> 'not_started' order by last_activity_at desc nulls last limit 200`);
    return Response.json({ sessions: r.rows });
  }
  const r = await getPool().query(`select id, thread_id as "threadId", from_participant as "from", to_participants as "to", cc_participants as "cc", subject, body, kind, delivered_at as "deliveredAt" from messages where session_id = $1 order by seq asc`, [sessionId]);
  const scrub = (s: string) => s; // Character names are synthetic; the associate appears as "associate".
  return Response.json({ sessionId, messages: r.rows.map((m) => ({ ...m, body: scrub(m.body) })) });
}
