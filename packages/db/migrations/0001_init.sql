CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE "cohort_members" (
	"cohort_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cohort_members_cohort_id_user_id_pk" PRIMARY KEY("cohort_id","user_id")
);

CREATE TABLE "cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scenario_id" text NOT NULL,
	"scenario_version" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"tester_flags_enabled" boolean DEFAULT true NOT NULL,
	"assessor_shadow_mode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "consequences" (
	"session_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"consequence_id" text NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "consequences_session_id_consequence_id_pk" PRIMARY KEY("session_id","consequence_id")
);

CREATE TABLE "decisions" (
	"session_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"decision_point_id" text NOT NULL,
	"position" text NOT NULL,
	"rationale" text,
	"message_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decisions_session_id_decision_point_id_pk" PRIMARY KEY("session_id","decision_point_id")
);

CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"thread_id" uuid,
	"to" jsonb NOT NULL,
	"cc" jsonb NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"attachments" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor" text NOT NULL,
	"idempotency_key" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"job_key" text,
	"role" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_refs" jsonb NOT NULL,
	"system_prompt" text NOT NULL,
	"user_prompt" text NOT NULL,
	"output" text NOT NULL,
	"parsed_output" jsonb,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"checker_result" jsonb,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "held_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"job_key" text NOT NULL,
	"job_payload" jsonb NOT NULL,
	"proposed_delivery" jsonb NOT NULL,
	"violations" jsonb NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "held_emails_job_key_unique" UNIQUE("job_key")
);

CREATE TABLE "issue_status" (
	"session_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"issue_id" text NOT NULL,
	"status" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "issue_status_session_id_issue_id_pk" PRIMARY KEY("session_id","issue_id")
);

CREATE TABLE "magic_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "magic_links_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"from_participant" text NOT NULL,
	"to_participants" jsonb NOT NULL,
	"cc_participants" jsonb NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"attachments" jsonb NOT NULL,
	"kind" text NOT NULL,
	"intent" text,
	"beat_id" text,
	"assignment_id" text,
	"generation_id" uuid,
	"delivered_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone
);

CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"data_retention_days" integer DEFAULT 365 NOT NULL,
	"llm_provider" text DEFAULT 'anthropic' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);

CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"rater_type" text NOT NULL,
	"rater_id" text NOT NULL,
	"realism" integer NOT NULL,
	"legal_accuracy" integer NOT NULL,
	"socratic_quality" integer NOT NULL,
	"voice_consistency" integer NOT NULL,
	"acceptable" boolean NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "session_snapshots" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"event_seq" integer NOT NULL,
	"engine_version" text NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"cohort_id" uuid NOT NULL,
	"scenario_id" text NOT NULL,
	"scenario_version" text NOT NULL,
	"engine_version" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"current_milestone" text,
	"test_mode" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"thread_key" text,
	"subject" text NOT NULL,
	"participants" jsonb NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"first_name" text NOT NULL,
	"role" text NOT NULL,
	"auth_subject" text,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"removed_at" timestamp with time zone
);

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "cohort_members" ADD CONSTRAINT "cohort_members_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "cohort_members" ADD CONSTRAINT "cohort_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "cohort_members" ADD CONSTRAINT "cohort_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "consequences" ADD CONSTRAINT "consequences_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "consequences" ADD CONSTRAINT "consequences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "flags" ADD CONSTRAINT "flags_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "flags" ADD CONSTRAINT "flags_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "flags" ADD CONSTRAINT "flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "generations" ADD CONSTRAINT "generations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "generations" ADD CONSTRAINT "generations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "held_emails" ADD CONSTRAINT "held_emails_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "held_emails" ADD CONSTRAINT "held_emails_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "issue_status" ADD CONSTRAINT "issue_status_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "issue_status" ADD CONSTRAINT "issue_status_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "session_snapshots" ADD CONSTRAINT "session_snapshots_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "session_snapshots" ADD CONSTRAINT "session_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "threads" ADD CONSTRAINT "threads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "threads" ADD CONSTRAINT "threads_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "drafts_session_idx" ON "drafts" USING btree ("session_id");
CREATE UNIQUE INDEX "events_session_seq_idx" ON "events" USING btree ("session_id","seq");
CREATE UNIQUE INDEX "events_idempotency_idx" ON "events" USING btree ("idempotency_key");
CREATE INDEX "events_session_type_idx" ON "events" USING btree ("session_id","type");
CREATE INDEX "generations_session_idx" ON "generations" USING btree ("session_id","created_at");
CREATE INDEX "messages_session_idx" ON "messages" USING btree ("session_id","delivered_at");
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","seq");
CREATE UNIQUE INDEX "sessions_user_cohort_idx" ON "sessions" USING btree ("user_id","cohort_id");
CREATE INDEX "threads_session_idx" ON "threads" USING btree ("session_id","last_message_at");
CREATE UNIQUE INDEX "users_org_email_idx" ON "users" USING btree ("org_id","email");

-- Events are append-only: nothing updates or deletes an event. Corrections are new events.
-- Deleting an organization still cascades (the trigger allows deletes that come from an org cascade).
CREATE OR REPLACE FUNCTION events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
      RAISE EXCEPTION 'events table is append-only';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'events table is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_no_update BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION events_append_only();

CREATE TRIGGER events_no_delete BEFORE DELETE ON events FOR EACH ROW EXECUTE FUNCTION events_append_only();
