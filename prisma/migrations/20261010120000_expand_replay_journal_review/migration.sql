-- Copy reviews before replacing the constrained column; keep entries and relations intact.
BEGIN TRANSACTION;
ALTER TABLE "ReplayJournalEntry"
ADD COLUMN "review_expanded" TEXT NOT NULL DEFAULT '' CHECK(length("review_expanded") <= 2000);

UPDATE "ReplayJournalEntry" SET "review_expanded" = "review";
ALTER TABLE "ReplayJournalEntry" DROP COLUMN "review";
ALTER TABLE "ReplayJournalEntry" RENAME COLUMN "review_expanded" TO "review";
COMMIT;
