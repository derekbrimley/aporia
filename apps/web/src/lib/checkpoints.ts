import { getPool, sessionCheckpoints } from "@rematter/db";
import type { Checkpoint } from "@rematter/engine";
import { getScenario } from "./scenario.js";

/** Test checkpoints the cohort's associates can load, or null when the cohort has none set. */
export async function cohortCheckpoints(cohort: { checkpointSourceSessionId: string | null; scenarioId: string; scenarioVersion: string }): Promise<Checkpoint[] | null> {
  if (!cohort.checkpointSourceSessionId) return null;
  const { pkg } = getScenario(cohort.scenarioId, cohort.scenarioVersion);
  return sessionCheckpoints(cohort.checkpointSourceSessionId, pkg);
}

/** Cohorts on the same scenario version as a session: the ones that can use it as a checkpoint source. */
export async function cohortsForSource(sessionId: string) {
  const r = await getPool().query<{ id: string; name: string; orgName: string; isSource: boolean }>(
    `select c.id, c.name, o.name as "orgName", c.checkpoint_source_session_id = s.id as "isSource"
       from sessions s join cohorts c on c.scenario_id = s.scenario_id and c.scenario_version = s.scenario_version join organizations o on o.id = c.org_id
      where s.id = $1 order by o.name, c.name`,
    [sessionId],
  );
  return r.rows.map((x) => ({ ...x, isSource: Boolean(x.isSource) }));
}
