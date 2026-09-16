ALTER TABLE "ReplayJournalSession" ADD COLUMN "name" TEXT NOT NULL DEFAULT '回放会话';

UPDATE "ReplayJournalSession"
SET "name" = '回放会话 ' || "replayGeneration";
