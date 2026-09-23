import type pg from "pg";
import type { Effect, EngineEvent, SessionState } from "@aporia/engine";

interface Ctx { sessionId: string; orgId: string; seq: number }

/**
 * Maps one event (and the state after it) onto the projection tables with
 * idempotent upserts, so `rebuildProjections` can replay the same function.
 */
export async function applyProjection(client: pg.PoolClient | pg.Client, ctx: Ctx, event: EngineEvent, state: SessionState, effects: Effect[]): Promise<void> {
  const { sessionId, orgId } = ctx;
  await client.query(
    `update sessions set status = $2, current_milestone = $3, started_at = coalesce(started_at, $4), completed_at = coalesce($5, completed_at),
       last_activity_at = greatest(coalesce(last_activity_at, $6), $6) where id = $1`,
    [sessionId, state.status, state.currentMilestone, state.startedAt, state.completedAt, state.lastActivityAt ?? event.at],
  );

  if (event.type === "email_sent" || event.type === "message_delivered") {
    const p = event.payload;
    const thread = state.threads[p.threadId]!;
    await client.query(
      `insert into threads (id, org_id, session_id, thread_key, subject, participants, hidden, last_message_at, message_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set thread_key = coalesce(threads.thread_key, excluded.thread_key), participants = excluded.participants, hidden = excluded.hidden,
         last_message_at = excluded.last_message_at, message_count = excluded.message_count`,
      [p.threadId, orgId, sessionId, thread.key, thread.subject, JSON.stringify(thread.participants), thread.hidden, thread.lastMessageAt, thread.messageIds.length],
    );
    const m = state.messages[p.messageId]!;
    await client.query(
      `insert into messages (id, org_id, session_id, thread_id, seq, from_participant, to_participants, cc_participants, subject, body, attachments, kind, intent, beat_id, assignment_id, generation_id, delivered_at, read_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       on conflict (id) do update set intent = excluded.intent, assignment_id = excluded.assignment_id`,
      [
        m.id, orgId, sessionId, m.threadId, ctx.seq, m.from, JSON.stringify(m.to), JSON.stringify(m.cc), m.subject, m.body, JSON.stringify(m.attachments), m.kind,
        m.intent, m.beatId, m.assignmentId, event.type === "message_delivered" ? event.payload.generationId ?? null : null, m.at,
        m.from === "associate" ? m.at : null,
      ],
    );
  }
  if (event.type === "intent_classified") {
    await client.query(`update messages set intent = $2 where id = $1`, [event.payload.messageId, event.payload.intent]);
  }
  if (event.type === "assessment_recorded") {
    const p = event.payload;
    for (const [issueId, status] of Object.entries(p.issues)) {
      await client.query(
        `insert into issue_status (session_id, org_id, issue_id, status, recorded_at) values ($1, $2, $3, $4, $5)
         on conflict (session_id, issue_id) do update set status = excluded.status, recorded_at = excluded.recorded_at`,
        [sessionId, orgId, issueId, status, event.at],
      );
    }
    for (const [dpId, d] of Object.entries(state.decisions)) {
      await client.query(
        `insert into decisions (session_id, org_id, decision_point_id, position, rationale, message_id, recorded_at) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (session_id, decision_point_id) do update set position = excluded.position, rationale = excluded.rationale`,
        [sessionId, orgId, dpId, d.position, d.rationale, d.messageId, event.at],
      );
    }
    await client.query(`update messages set assignment_id = $2 where id = $1`, [p.messageId, p.assignmentId]);
  }
  for (const e of effects) {
    if (e.type === "consequence_seeded" || e.type === "consequence_fired") {
      await client.query(
        `insert into consequences (session_id, org_id, consequence_id, state, updated_at) values ($1, $2, $3, $4, $5)
         on conflict (session_id, consequence_id) do update set state = excluded.state, updated_at = excluded.updated_at`,
        [sessionId, orgId, e.consequenceId, state.consequences[e.consequenceId], event.at],
      );
    }
  }
}

export async function clearProjections(client: pg.PoolClient | pg.Client, sessionId: string): Promise<void> {
  for (const table of ["messages", "threads", "decisions", "issue_status", "consequences", "session_snapshots"]) {
    await client.query(`delete from ${table} where session_id = $1`, [sessionId]);
  }
}
