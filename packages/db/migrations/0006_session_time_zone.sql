-- The associate's IANA time zone (from their browser) when the session started. Story dates and deal
-- dates follow their calendar instead of UTC. Null on older sessions, which keep counting in UTC.
ALTER TABLE "sessions" ADD COLUMN "time_zone" text;
