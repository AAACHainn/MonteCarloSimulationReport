CREATE TABLE "_ReplayJournalReasonTags" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_ReplayJournalReasonTags_A_fkey" FOREIGN KEY ("A") REFERENCES "ReplayJournalEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_ReplayJournalReasonTags_B_fkey" FOREIGN KEY ("B") REFERENCES "TradeTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "_ReplayJournalReasonTags_AB_unique"
ON "_ReplayJournalReasonTags"("A", "B");

CREATE INDEX "_ReplayJournalReasonTags_B_index"
ON "_ReplayJournalReasonTags"("B");
