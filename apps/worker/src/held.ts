import type pg from "pg";
import type { Job } from "@rematter/engine";
import { appendEvent, getPool } from "@rematter/db";
import { getScenario } from "@rematter/scenario";

interface HeldRow { id: string; org_id: string; session_id: string; job_key: string; proposed_delivery: { type: string; payload: Record<string, unknown> }; job_payload: Job }

/**
 * Locks a held email that is still awaiting review, inside the caller's transaction. Two admins
 * acting at once (or a double click) can't both review it: the second finds nothing.
 */
async function lockHeld(client: pg.PoolClient, heldId: string): Promise<HeldRow> {
  const row = (await client.query<HeldRow>(
    `select id, org_id, session_id, job_key, proposed_delivery, job_payload from held_emails where id = $1 and status = 'held' for update`, [heldId],
  )).rows[0];
  if (!row) throw new Error(`Held email ${heldId} not found or already reviewed`);
  return row;
}

async function sessionPkg(client: pg.PoolClient, sessionId: string) {
  const sess = (await client.query<{ scenario_id: string; scenario_version: string }>(`select scenario_id, scenario_version from sessions where id = $1`, [sessionId])).rows[0]!;
  return getScenario(sess.scenario_id, sess.scenario_version).pkg;
}

async function inTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Releases a held email after human review, optionally with an edited body. Audit-logged. One transaction. */
export async function releaseHeldEmail(heldId: string, adminUserId: string, editedBody?: string): Promise<void> {
  await inTransaction(async (client) => {
    const row = await lockHeld(client, heldId);
    const pkg = await sessionPkg(client, row.session_id);
    const payload = { ...row.proposed_delivery.payload, ...(editedBody ? { body: editedBody } : {}) };
    const actor = `admin:${adminUserId}`;
    await appendEvent(row.session_id, { type: "message_released", payload: { jobKey: row.job_key } }, actor, pkg, { idempotencyKey: `${row.session_id}:released:${row.job_key}`, client });
    await appendEvent(row.session_id, { type: "message_delivered", payload } as never, actor, pkg, { idempotencyKey: `${row.session_id}:deliver:${row.job_key}`, client });
    await appendEvent(row.session_id, { type: "job_completed", payload: { jobKey: row.job_key, kind: row.job_payload.kind } }, actor, pkg, { idempotencyKey: `${row.session_id}:done:${row.job_key}`, client });
    await client.query(`update held_emails set status = 'released', reviewed_by = $2, reviewed_at = now() where id = $1`, [heldId, adminUserId]);
    await client.query(`insert into audit_log (org_id, actor_user_id, action, target, details) values ($1, $2, 'held_email.release', $3, $4)`, [row.org_id, adminUserId, heldId, JSON.stringify({ edited: Boolean(editedBody) })]);
  });
}

/**
 * Discards a held email. The engine is told, so it stops waiting on it: a scripted beat is
 * written again (it may open the next assignment), anything else stays unsent.
 */
export async function discardHeldEmail(heldId: string, adminUserId: string): Promise<void> {
  await inTransaction(async (client) => {
    const row = await lockHeld(client, heldId);
    const pkg = await sessionPkg(client, row.session_id);
    await appendEvent(row.session_id, { type: "message_discarded", payload: { jobKey: row.job_key, job: row.job_payload } }, `admin:${adminUserId}`, pkg, { idempotencyKey: `${row.session_id}:discarded:${row.job_key}`, client });
    await client.query(`update held_emails set status = 'discarded', reviewed_by = $2, reviewed_at = now() where id = $1`, [heldId, adminUserId]);
    await client.query(`insert into audit_log (org_id, actor_user_id, action, target, details) values ($1, $2, 'held_email.discard', $3, $4)`, [row.org_id, adminUserId, heldId, JSON.stringify({ regenerated: row.job_payload.kind === "beat" })]);
  });
}
