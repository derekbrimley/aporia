import { getPool } from "@aporia/db";
import { apiUser } from "@/lib/auth";
import { sessionForUser } from "@/lib/session";

export async function POST(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const s = await sessionForUser(u);
  if (!s) return Response.json({ error: "no session" }, { status: 404 });
  const { messageIds } = (await req.json()) as { messageIds: string[] };
  await getPool().query(`update messages set read_at = coalesce(read_at, now()) where session_id = $1 and id = any($2::uuid[])`, [s.session.id, messageIds]);
  return Response.json({ ok: true });
}
