import { z } from "zod";
import { getPool, rollbackSession } from "@rematter/db";
import { apiUser, audit } from "@/lib/auth";
import { getScenario } from "@/lib/scenario";

const Body = z.object({ eventCount: z.number().int().min(0) });

/**
 * Rolls a tester's session back to one of its rollback points, or resets it (eventCount 0). Nothing is
 * deleted: the old run is archived and stays on the admin pages; the tester's inbox shows the new one.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser(["internal_admin"], { write: true });
  if (u instanceof Response) return u;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { eventCount }." }, { status: 400 });
  const { eventCount } = parsed.data;
  const s = (await getPool().query<{ scenario_id: string; scenario_version: string }>(`select scenario_id, scenario_version from sessions where id = $1`, [id])).rows[0];
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  const { pkg } = getScenario(s.scenario_id, s.scenario_version);
  try {
    const r = await rollbackSession({ sessionId: id, eventCount, adminUserId: u.id, pkg });
    await audit(u, eventCount === 0 ? "session.reset" : "session.rollback", id, {
      eventCount, newSessionId: r.sessionId, archived: r.archived, droppedEvents: r.droppedEvents, discardedHeld: r.discardedHeld,
      currentMilestone: r.state?.currentMilestone ?? null,
    });
    return Response.json({ ok: true, sessionId: r.sessionId, archived: r.archived, droppedEvents: r.droppedEvents, discardedHeld: r.discardedHeld });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
