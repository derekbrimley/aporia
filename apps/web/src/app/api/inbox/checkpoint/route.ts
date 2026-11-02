import { z } from "zod";
import { forkSessionAtCheckpoint } from "@rematter/db";
import { apiUser, audit } from "@/lib/auth";
import { cohortCheckpoints } from "@/lib/checkpoints";
import { getScenario } from "@/lib/scenario";
import { sessionForUser } from "@/lib/session";

const Body = z.object({ eventCount: z.number().int().min(1) });

/**
 * Test checkpoints: replaces the associate's session with a fresh one loaded from a milestone of the
 * cohort's source run. Only works in a cohort an admin has given a checkpoint source.
 */
export async function POST(req: Request) {
  const u = await apiUser(["associate"]);
  if (u instanceof Response) return u;
  const s = await sessionForUser(u);
  if (!s) return Response.json({ error: "no session" }, { status: 404 });
  const checkpoints = await cohortCheckpoints(s.cohort);
  if (!checkpoints) return Response.json({ error: "Checkpoints are not turned on for this cohort." }, { status: 403 });
  const { eventCount } = Body.parse(await req.json());
  const cp = checkpoints.find((c) => c.eventCount === eventCount);
  if (!cp) return Response.json({ error: "No such checkpoint." }, { status: 400 });
  const { pkg } = getScenario(s.cohort.scenarioId, s.cohort.scenarioVersion);
  const forked = await forkSessionAtCheckpoint({ sourceSessionId: s.cohort.checkpointSourceSessionId!, eventCount, orgId: u.orgId, userId: u.id, cohortId: s.cohort.id, firstName: u.firstName, pkg });
  await audit(u, "session.checkpoint_load", forked.sessionId, { from: s.session.id, source: s.cohort.checkpointSourceSessionId, checkpoint: cp });
  return Response.json({ ok: true, sessionId: forked.sessionId, currentMilestone: forked.state.currentMilestone });
}
