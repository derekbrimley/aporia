import { z } from "zod";
import { getPool } from "@rematter/db";
import { apiUser, audit } from "@/lib/auth";

const Body = z.object({ cohortId: z.string().uuid(), sessionId: z.string().uuid().nullable() });

/** Sets (or clears) the source run a cohort's associates can load test checkpoints from. */
export async function POST(req: Request) {
  const u = await apiUser(["internal_admin"]);
  if (u instanceof Response) return u;
  const b = Body.parse(await req.json());
  if (b.sessionId) {
    const ok = await getPool().query(
      `select 1 from sessions s join cohorts c on c.id = $2 where s.id = $1 and s.scenario_id = c.scenario_id and s.scenario_version = c.scenario_version`,
      [b.sessionId, b.cohortId],
    );
    if (!ok.rowCount) return Response.json({ error: "That session isn't on the cohort's scenario version." }, { status: 400 });
  }
  const r = await getPool().query(`update cohorts set checkpoint_source_session_id = $2 where id = $1`, [b.cohortId, b.sessionId]);
  if (!r.rowCount) return Response.json({ error: "Cohort not found." }, { status: 404 });
  await audit(u, "cohort.checkpoint_source", b.cohortId, b);
  return Response.json({ ok: true });
}
