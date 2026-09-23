import { appendEvent, recordActivity } from "@aporia/db";
import { apiUser } from "@/lib/auth";
import { sessionForUser } from "@/lib/session";

export async function POST(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const s = await sessionForUser(u);
  if (!s) return Response.json({ error: "no session" }, { status: 404 });
  const { documentId } = (await req.json()) as { documentId: string };
  if (!s.state.documentsReleased.includes(documentId)) return Response.json({ error: "not released" }, { status: 403 });
  if (!s.state.documentsOpened.includes(documentId)) await appendEvent(s.session.id, { type: "document_opened", payload: { documentId } }, "associate", s.pkg);
  await recordActivity(s.session.id, new Date());
  return Response.json({ ok: true });
}
