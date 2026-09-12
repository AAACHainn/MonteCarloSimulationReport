ALTER TABLE "MarketDataset" ADD COLUMN "nextReplayJournalNo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaperTradingSession" ADD COLUMN "journalSessionId" TEXT;

CREATE TABLE "ReplayJournalSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "datasetId" TEXT NOT NULL,
  "replayGeneration" INTEGER NOT NULL,
  "initialCapital" REAL NOT NULL,
  "currency" TEXT NOT NULL,
  "commissionBps" REAL NOT NULL,
  "slippageBps" REAL NOT NULL,
  "archivedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ReplayJournalSession_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PaperPositionLot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "entryFillId" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "openedSequence" INTEGER NOT NULL,
  "openedAt" DATETIME NOT NULL,
  "entryPrice" REAL NOT NULL,
  "initialStopPrice" REAL,
  "initialQuantity" REAL NOT NULL,
  "remainingQuantity" REAL NOT NULL,
  "initialRisk" REAL,
  "actualRisk" REAL NOT NULL DEFAULT 0,
  "abrValue" REAL,
  "abrLength" INTEGER NOT NULL,
  "displayIntervalSeconds" INTEGER NOT NULL,
  "displaySession" TEXT NOT NULL,
  "displayUtcOffsetMinutes" INTEGER NOT NULL,
  "priceTickSize" REAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PaperPositionLot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaperTradingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ReplayJournalEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "journalSessionId" TEXT NOT NULL,
  "no" INTEGER NOT NULL,
  "lotId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "quantity" REAL NOT NULL,
  "openedSequence" INTEGER NOT NULL,
  "openedAt" DATETIME NOT NULL,
  "closedSequence" INTEGER NOT NULL,
  "closedAt" DATETIME NOT NULL,
  "entryPrice" REAL NOT NULL,
  "exitPrice" REAL NOT NULL,
  "initialStopPrice" REAL,
  "abrValue" REAL,
  "abrLength" INTEGER NOT NULL,
  "displayIntervalSeconds" INTEGER NOT NULL,
  "displaySession" TEXT NOT NULL,
  "displayUtcOffsetMinutes" INTEGER NOT NULL,
  "priceTickSize" REAL NOT NULL,
  "initialRisk" REAL NOT NULL,
  "actualRisk" REAL NOT NULL,
  "gainLoss" REAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReplayJournalEntry_journalSessionId_fkey" FOREIGN KEY ("journalSessionId") REFERENCES "ReplayJournalSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PaperTradingSession_journalSessionId_key" ON "PaperTradingSession"("journalSessionId");
CREATE INDEX "ReplayJournalSession_datasetId_createdAt_idx" ON "ReplayJournalSession"("datasetId", "createdAt");
CREATE INDEX "ReplayJournalSession_datasetId_archivedAt_idx" ON "ReplayJournalSession"("datasetId", "archivedAt");
CREATE INDEX "PaperPositionLot_sessionId_openedSequence_idx" ON "PaperPositionLot"("sessionId", "openedSequence");
CREATE UNIQUE INDEX "ReplayJournalEntry_journalSessionId_id_key" ON "ReplayJournalEntry"("journalSessionId", "id");
CREATE INDEX "ReplayJournalEntry_journalSessionId_no_idx" ON "ReplayJournalEntry"("journalSessionId", "no");
CREATE INDEX "ReplayJournalEntry_journalSessionId_openedSequence_idx" ON "ReplayJournalEntry"("journalSessionId", "openedSequence");
