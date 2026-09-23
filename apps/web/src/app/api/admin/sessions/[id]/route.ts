import { apiUser, audit } from "@/lib/auth";
import { replaySession, sessionDetail } from "@/lib/admin";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser(["internal_admin"]);
  if (u instanceof Response) return u;
  const { id } = await params;
  const d = await sessionDetail(id);
  if (!d) return Response.json({ error: "not found" }, { status: 404 });
  await audit(u, "session.view", id);
  return Response.json(d);
}
/** Event replay: drops and rebuilds projections from the log. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser(["internal_admin"]);
  if (u instanceof Response) return u;
  const { id } = await params;
  await audit(u, "session.replay", id);
  const state = await replaySession(id);
  return Response.json({ ok: true, status: state.status, currentMilestone: state.currentMilestone });
}
