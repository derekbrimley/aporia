-- Read receipts are the associate's own actions, not something the event log can rebuild, so they
-- live outside the projection tables. Rebuilding projections (admin replay) deletes and recreates
-- `messages`, which used to reset every email to unread.
CREATE TABLE "message_reads" (
	"session_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reads_session_id_message_id_pk" PRIMARY KEY("session_id","message_id")
);
ALTER TABLE "message_reads" ADD CONSTRAINT "message_reads_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "message_reads" ADD CONSTRAINT "message_reads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

INSERT INTO "message_reads" (session_id, message_id, org_id, read_at)
SELECT session_id, id, org_id, read_at FROM "messages" WHERE read_at IS NOT NULL AND from_participant <> 'associate';
