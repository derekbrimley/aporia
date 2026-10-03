-- Drafts remember the message they forward, so a forward survives a reload.
ALTER TABLE "drafts" ADD COLUMN "forwarded_message_id" text;
