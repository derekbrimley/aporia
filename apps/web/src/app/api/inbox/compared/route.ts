import { appendEvent } from "@aporia/db";
import { apiUser } from "@/lib/auth";
import { sessionForUser } from "@/lib/session";

export async function POST(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const s = await sessionForUser(u);
  if (!s) return Response.json({ error: "no session" }, { status: 404 });
  const { documentIds } = (await req.json()) as { documentIds: [string, string] };
  await appendEvent(s.session.id, { type: "documents_compared", payload: { documentIds } }, "associate", s.pkg);
  return Response.json({ ok: true });
}
