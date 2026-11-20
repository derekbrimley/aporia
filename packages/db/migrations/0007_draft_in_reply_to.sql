-- The message a reply draft answers (Reply or Reply all on a specific email), so a reopened draft keeps it.
ALTER TABLE "drafts" ADD COLUMN "in_reply_to" text;
