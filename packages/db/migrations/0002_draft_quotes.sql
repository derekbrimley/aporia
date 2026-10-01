-- Drafts keep the document quotes the associate pulled in, so they survive a reload.
ALTER TABLE "drafts" ADD COLUMN "quotes" jsonb DEFAULT '[]'::jsonb NOT NULL;
