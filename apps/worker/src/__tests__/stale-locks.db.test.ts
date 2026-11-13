import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeDb, databaseUrl, getPool, migrate } from "@rematter/db";
import { unlockStaleJobs } from "../runner.js";

/** A worker killed mid-job (a redeploy) leaves its job and the session's queue locked for hours. */
describe("stale job locks", () => {
  beforeAll(async () => {
    await migrate(databaseUrl());
  });
  afterAll(async () => {
    await closeDb();
  });

  // A task no worker handles, so a worker left running by another test file cannot pick up the job once it is unlocked.
  async function lockedJob(minutesAgo: number) {
    const queue = `session:${randomUUID()}`;
    const worker = `worker-dead-${randomUUID().slice(0, 8)}`;
    await getPool().query(`select graphile_worker.add_job('stale_lock_test_noop', '{}'::json, queue_name := $1)`, [queue]);
    const at = `now() - make_interval(mins => ${minutesAgo})`;
    await getPool().query(`update graphile_worker._private_jobs set locked_at = ${at}, locked_by = $2, attempts = 1 where job_queue_id = (select id from graphile_worker._private_job_queues where queue_name = $1)`, [queue, worker]);
    await getPool().query(`update graphile_worker._private_job_queues set locked_at = ${at}, locked_by = $2 where queue_name = $1`, [queue, worker]);
    return queue;
  }
  const state = async (queue: string) => (await getPool().query(`select j.locked_by as job, q.locked_by as queue from graphile_worker._private_jobs j join graphile_worker._private_job_queues q on q.id = j.job_queue_id where q.queue_name = $1`, [queue])).rows[0];

  it("releases jobs and queues held longer than the limit, and leaves recent locks alone", async () => {
    const stale = await lockedJob(30);
    const busy = await lockedJob(1);
    expect(await unlockStaleJobs()).toBeGreaterThanOrEqual(1);
    expect(await state(stale)).toEqual({ job: null, queue: null });
    expect((await state(busy)).job).not.toBeNull();
  });
});
