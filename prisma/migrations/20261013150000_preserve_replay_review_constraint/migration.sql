-- Retain the existing database constraint when repairing a schema generated
-- without custom CHECK declarations. No journal or reason-link rows are removed.
ALTER TABLE "ReplayJournalEntry" ADD COLUMN "review_checked" TEXT NOT NULL DEFAULT '' CHECK(length("review_checked") <= 2000);
UPDATE "ReplayJournalEntry" SET "review_checked"="review";
ALTER TABLE "ReplayJournalEntry" DROP COLUMN "review";
ALTER TABLE "ReplayJournalEntry" RENAME COLUMN "review_checked" TO "review";
