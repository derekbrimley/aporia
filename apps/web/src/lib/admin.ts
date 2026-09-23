import { getPool, listEvents, getSessionState, rebuildProjections } from "@aporia/db";
import { getScenario } from "./scenario.js";

export async function listSessions() {
  const r = await getPool().query(
    `select s.id, s.status, s.current_milestone as "currentMilestone", s.started_at as "startedAt", s.last_activity_at as "lastActivityAt", s.completed_at as "completedAt", s.test_mode as "testMode",
            o.name as org, c.name as cohort, u.name as "userName", u.email as "userEmail", s.scenario_id as "scenarioId", s.scenario_version as "scenarioVersion",
            (select count(*) from events e where e.session_id = s.id)::int as events,
            (select count(*) from held_emails h where h.session_id = s.id and h.status = 'held')::int as held
       from sessions s join organizations o on o.id = s.org_id join cohorts c on c.id = s.cohort_id join users u on u.id = s.user_id
      order by s.last_activity_at desc nulls last limit 200`,
  );
  return r.rows;
}

export async function sessionDetail(sessionId: string) {
  const s = (await getPool().query<{ scenario_id: string; scenario_version: string; org_id: string }>(`select scenario_id, scenario_version, org_id from sessions where id = $1`, [sessionId])).rows[0];
  if (!s) return null;
  const { pkg } = getScenario(s.scenario_id, s.scenario_version);
  const [state, events, generations] = await Promise.all([
    getSessionState(sessionId, pkg),
    listEvents(sessionId),
    getPool().query(`select id, job_key as "jobKey", role, model, provider, prompt_version as "promptVersion", input_refs as "inputRefs", system_prompt as "systemPrompt", user_prompt as "userPrompt", output, parsed_output as "parsedOutput", input_tokens as "inputTokens", output_tokens as "outputTokens", cache_read_tokens as "cacheReadTokens", latency_ms as "latencyMs", attempt, checker_result as "checkerResult", created_at as "createdAt" from generations where session_id = $1 order by created_at asc`, [sessionId]),
  ]);
  return { state, events, generations: generations.rows, pkg: { id: pkg.meta.id, version: pkg.meta.version, characters: pkg.characters.map((c) => ({ id: c.id, name: c.name, role_label: c.role_label })) } };
}

export async function replaySession(sessionId: string) {
  const s = (await getPool().query<{ scenario_id: string; scenario_version: string }>(`select scenario_id, scenario_version from sessions where id = $1`, [sessionId])).rows[0];
  if (!s) throw new Error("not found");
  return rebuildProjections(sessionId, getScenario(s.scenario_id, s.scenario_version).pkg);
}

export async function listHeld() {
  const r = await getPool().query(`select h.id, h.session_id as "sessionId", h.job_key as "jobKey", h.proposed_delivery as "proposedDelivery", h.violations, h.status, h.created_at as "createdAt", u.name as "userName" from held_emails h join sessions s on s.id = h.session_id join users u on u.id = s.user_id where h.status = 'held' order by h.created_at asc`);
  return r.rows;
}

export async function listFlags(status?: string) {
  const r = await getPool().query(`select f.id, f.session_id as "sessionId", f.target_type as "targetType", f.target_id as "targetId", f.note, f.status, f.created_at as "createdAt", u.name as "userName" from flags f join users u on u.id = f.user_id where ($1::text is null or f.status = $1) order by f.created_at desc limit 500`, [status ?? null]);
  return r.rows;
}

/** Sample of character emails for rating, with what the judge said if it has rated them. */
export async function ratingSample(limit = 30) {
  const r = await getPool().query(
    `select m.id, m.session_id as "sessionId", m.from_participant as "from", m.kind, m.subject, m.body, m.delivered_at as "deliveredAt",
            (select json_agg(json_build_object('raterType', r.rater_type, 'acceptable', r.acceptable, 'realism', r.realism, 'legalAccuracy', r.legal_accuracy, 'socraticQuality', r.socratic_quality, 'voiceConsistency', r.voice_consistency)) from ratings r where r.message_id = m.id) as ratings
       from messages m where m.from_participant <> 'associate' and m.kind in ('reply','reflection','beat','interruption','recap','debrief')
        and not exists (select 1 from ratings r where r.message_id = m.id and r.rater_type = 'human')
      order by random() limit $1`, [limit]);
  return r.rows;
}
