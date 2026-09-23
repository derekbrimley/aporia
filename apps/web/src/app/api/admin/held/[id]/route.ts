import { discardHeldEmail, releaseHeldEmail } from "@aporia/worker";
import { apiUser } from "@/lib/auth";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser(["internal_admin"]);
  if (u instanceof Response) return u;
  const { id } = await params;
  const { action, body } = (await req.json()) as { action: "release" | "discard"; body?: string };
  if (action === "release") await releaseHeldEmail(id, u.id, body);
  else await discardHeldEmail(id, u.id);
  return Response.json({ ok: true });
}
