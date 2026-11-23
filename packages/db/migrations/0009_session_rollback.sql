-- Session rollback (admin): a session can be cut back to an earlier point. The event log is append-only,
-- so a rollback archives the session and replays the kept prefix into a new one, as a test checkpoint
-- load does. These columns record where a session was copied from, so the admin page can link the two.
ALTER TABLE "sessions" ADD COLUMN "forked_from_session_id" uuid;
ALTER TABLE "sessions" ADD COLUMN "forked_from_event_count" integer;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_forked_from_session_id_sessions_id_fk" FOREIGN KEY ("forked_from_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;

-- A rolled-back session plays the same scripted beats again under the same job keys (`beat:B-M4-kickoff`),
-- so a held email's job key is only unique within its session. Globally unique, the new run's hold would
-- be silently dropped (`on conflict do nothing`) and the story would wait on it forever.
ALTER TABLE "held_emails" DROP CONSTRAINT "held_emails_job_key_unique";
CREATE UNIQUE INDEX "held_emails_session_job_key_idx" ON "held_emails" USING btree ("session_id","job_key");
