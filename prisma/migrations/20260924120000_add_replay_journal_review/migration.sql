ALTER TABLE "ReplayJournalEntry"
ADD COLUMN "review" TEXT NOT NULL DEFAULT '' CHECK(length("review") <= 300);
