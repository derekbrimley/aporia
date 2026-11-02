import { getPool } from "@rematter/db";
import { apiUser } from "@/lib/auth";
import { sessionForUser } from "@/lib/session";

export async function POST(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const s = await sessionForUser(u);
  if (!s) return Response.json({ error: "no session" }, { status: 404 });
  const { messageIds } = (await req.json()) as { messageIds: string[] };
  // Only this session's own messages; the first read wins.
  await getPool().query(
    `insert into message_reads (session_id, message_id, org_id)
     select session_id, id, org_id from messages where session_id = $1 and id = any($2::uuid[])
     on conflict (session_id, message_id) do nothing`,
    [s.session.id, messageIds],
  );
  return Response.json({ ok: true });
}
