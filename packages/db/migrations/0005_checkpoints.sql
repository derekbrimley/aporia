-- Test checkpoints: a cohort can point at a finished source session, and its associates can load
-- a fresh session from any milestone of that run. Loading archives the associate's old session
-- (the event log is append-only, so it can't be reset), so "one session per associate per cohort"
-- now only counts sessions that aren't archived.
ALTER TABLE "sessions" ADD COLUMN "archived_at" timestamp with time zone;
DROP INDEX "sessions_user_cohort_idx";
CREATE UNIQUE INDEX "sessions_user_cohort_idx" ON "sessions" USING btree ("user_id","cohort_id") WHERE "archived_at" IS NULL;

ALTER TABLE "cohorts" ADD COLUMN "checkpoint_source_session_id" uuid;
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_checkpoint_source_session_id_sessions_id_fk" FOREIGN KEY ("checkpoint_source_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
