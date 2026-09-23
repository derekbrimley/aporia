import { appendEvent, getPool } from "@aporia/db";
import { getScenario } from "@aporia/scenario";

/** Releases a held email after human review, optionally with an edited body. Audit-logged. */
export async function releaseHeldEmail(heldId: string, adminUserId: string, editedBody?: string): Promise<void> {
  const pool = getPool();
  const row = (await pool.query<{ id: string; org_id: string; session_id: string; job_key: string; proposed_delivery: { type: string; payload: Record<string, unknown> }; job_payload: { kind: string } }>(
    `select h.id, h.org_id, h.session_id, h.job_key, h.proposed_delivery, h.job_payload from held_emails h where h.id = $1 and h.status = 'held'`, [heldId],
  )).rows[0];
  if (!row) throw new Error(`Held email ${heldId} not found or already reviewed`);
  const sess = (await pool.query<{ scenario_id: string; scenario_version: string }>(`select scenario_id, scenario_version from sessions where id = $1`, [row.session_id])).rows[0]!;
  const { pkg } = getScenario(sess.scenario_id, sess.scenario_version);
  const payload = { ...row.proposed_delivery.payload, ...(editedBody ? { body: editedBody } : {}) };
  await appendEvent(row.session_id, { type: "message_released", payload: { jobKey: row.job_key } }, `admin:${adminUserId}`, pkg, { idempotencyKey: `${row.session_id}:released:${row.job_key}` });
  await appendEvent(row.session_id, { type: "message_delivered", payload } as never, `admin:${adminUserId}`, pkg, { idempotencyKey: `${row.session_id}:deliver:${row.job_key}` });
  await appendEvent(row.session_id, { type: "job_completed", payload: { jobKey: row.job_key, kind: row.job_payload.kind } } as never, `admin:${adminUserId}`, pkg, { idempotencyKey: `${row.session_id}:done:${row.job_key}` });
  await pool.query(`update held_emails set status = 'released', reviewed_by = $2, reviewed_at = now() where id = $1`, [heldId, adminUserId]);
  await pool.query(`insert into audit_log (org_id, actor_user_id, action, target, details) values ($1, $2, 'held_email.release', $3, $4)`, [row.org_id, adminUserId, heldId, JSON.stringify({ edited: Boolean(editedBody) })]);
}

export async function discardHeldEmail(heldId: string, adminUserId: string): Promise<void> {
  const pool = getPool();
  const row = (await pool.query<{ org_id: string }>(`update held_emails set status = 'discarded', reviewed_by = $2, reviewed_at = now() where id = $1 and status = 'held' returning org_id`, [heldId, adminUserId])).rows[0];
  if (!row) throw new Error(`Held email ${heldId} not found or already reviewed`);
  await pool.query(`insert into audit_log (org_id, actor_user_id, action, target) values ($1, $2, 'held_email.discard', $3)`, [row.org_id, adminUserId, heldId]);
}
