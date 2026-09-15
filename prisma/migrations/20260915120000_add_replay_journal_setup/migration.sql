ALTER TABLE "ReplayJournalEntry"
ADD COLUMN "setupOptionId" TEXT
REFERENCES "TradeOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ReplayJournalEntry_setupOptionId_idx"
ON "ReplayJournalEntry"("setupOptionId");
