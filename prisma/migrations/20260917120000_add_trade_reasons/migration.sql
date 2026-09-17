CREATE TABLE "TradeReason" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "TradeReason_normalizedName_key"
ON "TradeReason"("normalizedName");

CREATE INDEX "TradeReason_name_idx"
ON "TradeReason"("name");

CREATE TABLE "_ReplayJournalTradeReasons" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_ReplayJournalTradeReasons_A_fkey" FOREIGN KEY ("A") REFERENCES "ReplayJournalEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_ReplayJournalTradeReasons_B_fkey" FOREIGN KEY ("B") REFERENCES "TradeReason" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "_ReplayJournalTradeReasons_AB_unique"
ON "_ReplayJournalTradeReasons"("A", "B");

CREATE INDEX "_ReplayJournalTradeReasons_B_index"
ON "_ReplayJournalTradeReasons"("B");

-- Preserve reasons already selected in replay journals while separating them
-- from the global trade-tag catalogue.
INSERT INTO "TradeReason" ("id", "name", "normalizedName", "createdAt", "updatedAt")
SELECT DISTINCT "TradeTag"."id", "TradeTag"."name", "TradeTag"."normalizedName", "TradeTag"."createdAt", "TradeTag"."updatedAt"
FROM "TradeTag"
INNER JOIN "_ReplayJournalReasonTags"
  ON "_ReplayJournalReasonTags"."B" = "TradeTag"."id";

INSERT INTO "_ReplayJournalTradeReasons" ("A", "B")
SELECT "A", "B" FROM "_ReplayJournalReasonTags";

DROP TABLE "_ReplayJournalReasonTags";
