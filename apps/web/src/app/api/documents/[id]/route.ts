import { apiUser } from "@/lib/auth";
import { sessionForUser } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser(["associate", "internal_admin"]);
  if (u instanceof Response) return u;
  const { id } = await params;
  const s = await sessionForUser(u);
  if (!s) return Response.json({ error: "no session" }, { status: 404 });
  if (u.role === "associate" && !s.state.documentsReleased.includes(id)) return Response.json({ error: "not released" }, { status: 403 });
  const doc = s.documents.get(id);
  if (!doc) return Response.json({ error: "unknown document" }, { status: 404 });
  const entry = s.pkg.documents.find((d) => d.id === id)!;
  return Response.json({ id: doc.id, title: doc.title, shortTitle: entry.short_title, html: doc.html, anchors: doc.anchors, from: entry.from });
}
