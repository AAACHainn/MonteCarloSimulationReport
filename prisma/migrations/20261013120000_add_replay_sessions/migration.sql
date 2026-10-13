-- CreateTable
CREATE TABLE "ReplaySession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'TRAINING',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "activeProjectionId" TEXT,
    "pendingCorrectionId" TEXT,
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "riskPreferences" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReplaySession_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReplaySession_activeProjectionId_fkey" FOREIGN KEY ("activeProjectionId") REFERENCES "ReplayProjection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReplayProjection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "replaySessionId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BUILDING',
    "historyVersion" INTEGER NOT NULL,
    "parentId" TEXT,
    "currentSequence" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReplayProjection_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "ReplaySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReplayCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "replaySessionId" TEXT NOT NULL,
    "sourceSequence" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReplayCommand_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "ReplaySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReplayProjectionCommand" (
    "projectionId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,

    PRIMARY KEY ("projectionId", "commandId"),
    CONSTRAINT "ReplayProjectionCommand_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "ReplayProjection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReplayProjectionCommand_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "ReplayCommand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReplayContextRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectionId" TEXT NOT NULL,
    "fromSequence" INTEGER NOT NULL,
    "toSequence" INTEGER NOT NULL,
    "context" TEXT NOT NULL,
    CONSTRAINT "ReplayContextRun_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "ReplayProjection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReplayCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectionId" TEXT NOT NULL,
    "sourceSequence" INTEGER NOT NULL,
    "commandOrdinal" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReplayCheckpoint_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "ReplayProjection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReplayCorrectionJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "replaySessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "baseProjectionId" TEXT NOT NULL,
    "targetProjectionId" TEXT,
    "targetSequence" INTEGER NOT NULL,
    "cycleKey" TEXT,
    "expectedVersion" INTEGER NOT NULL,
    "historyVersion" INTEGER NOT NULL,
    "processedSourceBars" INTEGER NOT NULL DEFAULT 0,
    "totalSourceBars" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "workerPid" INTEGER,
    "heartbeatAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReplayCorrectionJob_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "ReplaySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MarketDrawing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "replaySessionId" TEXT,
    "type" TEXT NOT NULL,
    "geometry" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketDrawing_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MarketDrawing_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "ReplaySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MarketDrawing" ("createdAt", "datasetId", "geometry", "id", "style", "type", "updatedAt") SELECT "createdAt", "datasetId", "geometry", "id", "style", "type", "updatedAt" FROM "MarketDrawing";
DROP TABLE "MarketDrawing";
ALTER TABLE "new_MarketDrawing" RENAME TO "MarketDrawing";
CREATE INDEX "MarketDrawing_datasetId_createdAt_idx" ON "MarketDrawing"("datasetId", "createdAt");
CREATE INDEX "MarketDrawing_replaySessionId_createdAt_idx" ON "MarketDrawing"("replaySessionId", "createdAt");
CREATE TABLE "new_ReplayProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "replaySessionId" TEXT,
    "startSequence" INTEGER NOT NULL,
    "currentSequence" INTEGER NOT NULL,
    "playbackRate" INTEGER NOT NULL DEFAULT 1,
    "displayIntervalSeconds" INTEGER,
    "displaySession" TEXT NOT NULL DEFAULT 'ETH',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "syncVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSyncRequestId" TEXT,
    "lastSyncResponse" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReplayProgress_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReplayProgress_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "ReplaySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReplayProgress" ("id", "createdAt", "currentSequence", "datasetId", "displayIntervalSeconds", "displaySession", "generation", "lastSyncRequestId", "lastSyncResponse", "playbackRate", "startSequence", "syncVersion", "updatedAt") SELECT 'legacy-progress:' || "datasetId", "createdAt", "currentSequence", "datasetId", "displayIntervalSeconds", "displaySession", "generation", "lastSyncRequestId", "lastSyncResponse", "playbackRate", "startSequence", "syncVersion", "updatedAt" FROM "ReplayProgress";
DROP TABLE "ReplayProgress";
ALTER TABLE "new_ReplayProgress" RENAME TO "ReplayProgress";
CREATE UNIQUE INDEX "ReplayProgress_replaySessionId_key" ON "ReplayProgress"("replaySessionId");
CREATE INDEX "ReplayProgress_datasetId_idx" ON "ReplayProgress"("datasetId");
CREATE TABLE "new_PaperTradingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "projectionId" TEXT,
    "journalSessionId" TEXT,
    "initialCapital" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "commissionBps" REAL NOT NULL DEFAULT 0,
    "slippageBps" REAL NOT NULL DEFAULT 0,
    "lastProcessedSequence" INTEGER NOT NULL,
    "netQuantity" REAL NOT NULL DEFAULT 0,
    "averageEntryPrice" REAL,
    "realizedPnl" REAL NOT NULL DEFAULT 0,
    "totalFees" REAL NOT NULL DEFAULT 0,
    "totalSlippage" REAL NOT NULL DEFAULT 0,
    "peakEquity" REAL NOT NULL,
    "maxDrawdown" REAL NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "equitySampleStride" INTEGER NOT NULL DEFAULT 1,
    "tradeStatsVersion" INTEGER NOT NULL DEFAULT 1,
    "closedTradeCount" INTEGER NOT NULL DEFAULT 0,
    "winningTradeCount" INTEGER NOT NULL DEFAULT 0,
    "losingTradeCount" INTEGER NOT NULL DEFAULT 0,
    "grossWinningPnl" REAL NOT NULL DEFAULT 0,
    "grossLosingPnl" REAL NOT NULL DEFAULT 0,
    "currentWinStreak" INTEGER NOT NULL DEFAULT 0,
    "currentLossStreak" INTEGER NOT NULL DEFAULT 0,
    "maxConsecutiveWins" INTEGER NOT NULL DEFAULT 0,
    "maxConsecutiveLosses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperTradingSession_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaperTradingSession_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "ReplayProjection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaperTradingSession_journalSessionId_fkey" FOREIGN KEY ("journalSessionId") REFERENCES "ReplayJournalSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PaperTradingSession" ("averageEntryPrice", "closedTradeCount", "commissionBps", "createdAt", "currency", "currentLossStreak", "currentWinStreak", "datasetId", "equitySampleStride", "grossLosingPnl", "grossWinningPnl", "id", "initialCapital", "journalSessionId", "lastProcessedSequence", "losingTradeCount", "maxConsecutiveLosses", "maxConsecutiveWins", "maxDrawdown", "netQuantity", "peakEquity", "realizedPnl", "slippageBps", "totalFees", "totalSlippage", "tradeStatsVersion", "updatedAt", "version", "winningTradeCount") SELECT "averageEntryPrice", "closedTradeCount", "commissionBps", "createdAt", "currency", "currentLossStreak", "currentWinStreak", "datasetId", "equitySampleStride", "grossLosingPnl", "grossWinningPnl", "id", "initialCapital", "journalSessionId", "lastProcessedSequence", "losingTradeCount", "maxConsecutiveLosses", "maxConsecutiveWins", "maxDrawdown", "netQuantity", "peakEquity", "realizedPnl", "slippageBps", "totalFees", "totalSlippage", "tradeStatsVersion", "updatedAt", "version", "winningTradeCount" FROM "PaperTradingSession";
DROP TABLE "PaperTradingSession";
ALTER TABLE "new_PaperTradingSession" RENAME TO "PaperTradingSession";
CREATE UNIQUE INDEX "PaperTradingSession_projectionId_key" ON "PaperTradingSession"("projectionId");
CREATE INDEX "PaperTradingSession_datasetId_idx" ON "PaperTradingSession"("datasetId");
CREATE TABLE "new_ReplayJournalSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "replaySessionId" TEXT,
    "name" TEXT NOT NULL DEFAULT '回放会话',
    "replayGeneration" INTEGER NOT NULL,
    "initialCapital" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "commissionBps" REAL NOT NULL,
    "slippageBps" REAL NOT NULL,
    "nextEntryNo" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReplayJournalSession_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReplayJournalSession_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "ReplaySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReplayJournalSession" ("archivedAt", "commissionBps", "createdAt", "currency", "datasetId", "id", "initialCapital", "name", "nextEntryNo", "replayGeneration", "slippageBps", "updatedAt") SELECT "archivedAt", "commissionBps", "createdAt", "currency", "datasetId", "id", "initialCapital", "name", "nextEntryNo", "replayGeneration", "slippageBps", "updatedAt" FROM "ReplayJournalSession";
DROP TABLE "ReplayJournalSession";
ALTER TABLE "new_ReplayJournalSession" RENAME TO "ReplayJournalSession";
CREATE UNIQUE INDEX "ReplayJournalSession_replaySessionId_key" ON "ReplayJournalSession"("replaySessionId");
CREATE INDEX "ReplayJournalSession_datasetId_createdAt_idx" ON "ReplayJournalSession"("datasetId", "createdAt");
CREATE INDEX "ReplayJournalSession_datasetId_archivedAt_idx" ON "ReplayJournalSession"("datasetId", "archivedAt");
CREATE TABLE "new_ReplayJournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalSessionId" TEXT NOT NULL,
    "projectionId" TEXT,
    "logicalKey" TEXT,
    "cycleKey" TEXT,
    "no" INTEGER NOT NULL,
    "accountNo" INTEGER NOT NULL DEFAULT 0,
    "lotId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "openedSequence" INTEGER NOT NULL,
    "openedAt" DATETIME NOT NULL,
    "closedSequence" INTEGER NOT NULL,
    "closedAt" DATETIME NOT NULL,
    "entryPrice" REAL NOT NULL,
    "entryOrderType" TEXT,
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
    "review" TEXT NOT NULL DEFAULT '' CHECK(length("review") <= 2000),
    "setupOptionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReplayJournalEntry_journalSessionId_fkey" FOREIGN KEY ("journalSessionId") REFERENCES "ReplayJournalSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReplayJournalEntry_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "ReplayProjection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReplayJournalEntry_setupOptionId_fkey" FOREIGN KEY ("setupOptionId") REFERENCES "TradeOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ReplayJournalEntry" ("abrLength", "abrValue", "accountNo", "actualRisk", "closedAt", "closedSequence", "createdAt", "direction", "displayIntervalSeconds", "displaySession", "displayUtcOffsetMinutes", "entryOrderType", "entryPrice", "exitPrice", "gainLoss", "id", "initialRisk", "initialStopPrice", "journalSessionId", "lotId", "no", "openedAt", "openedSequence", "priceTickSize", "quantity", "review", "setupOptionId") SELECT "abrLength", "abrValue", "accountNo", "actualRisk", "closedAt", "closedSequence", "createdAt", "direction", "displayIntervalSeconds", "displaySession", "displayUtcOffsetMinutes", "entryOrderType", "entryPrice", "exitPrice", "gainLoss", "id", "initialRisk", "initialStopPrice", "journalSessionId", "lotId", "no", "openedAt", "openedSequence", "priceTickSize", "quantity", "review", "setupOptionId" FROM "ReplayJournalEntry";
DROP TABLE "ReplayJournalEntry";
ALTER TABLE "new_ReplayJournalEntry" RENAME TO "ReplayJournalEntry";
CREATE INDEX "ReplayJournalEntry_projectionId_closedSequence_idx" ON "ReplayJournalEntry"("projectionId", "closedSequence");
CREATE INDEX "ReplayJournalEntry_projectionId_cycleKey_idx" ON "ReplayJournalEntry"("projectionId", "cycleKey");
CREATE INDEX "ReplayJournalEntry_journalSessionId_no_idx" ON "ReplayJournalEntry"("journalSessionId", "no");
CREATE INDEX "ReplayJournalEntry_journalSessionId_openedSequence_idx" ON "ReplayJournalEntry"("journalSessionId", "openedSequence");
CREATE INDEX "ReplayJournalEntry_journalSessionId_closedSequence_idx" ON "ReplayJournalEntry"("journalSessionId", "closedSequence");
CREATE INDEX "ReplayJournalEntry_setupOptionId_idx" ON "ReplayJournalEntry"("setupOptionId");
CREATE UNIQUE INDEX "ReplayJournalEntry_journalSessionId_id_key" ON "ReplayJournalEntry"("journalSessionId", "id");
CREATE UNIQUE INDEX "ReplayJournalEntry_journalSessionId_projectionId_accountNo_key" ON "ReplayJournalEntry"("journalSessionId", "projectionId", "accountNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ReplaySession_activeProjectionId_key" ON "ReplaySession"("activeProjectionId");

-- CreateIndex
CREATE INDEX "ReplaySession_datasetId_status_createdAt_idx" ON "ReplaySession"("datasetId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ReplayProjection_replaySessionId_generation_idx" ON "ReplayProjection"("replaySessionId", "generation");

-- CreateIndex
CREATE INDEX "ReplayCommand_replaySessionId_sourceSequence_ordinal_idx" ON "ReplayCommand"("replaySessionId", "sourceSequence", "ordinal");

-- CreateIndex
CREATE INDEX "ReplayContextRun_projectionId_fromSequence_toSequence_idx" ON "ReplayContextRun"("projectionId", "fromSequence", "toSequence");

-- CreateIndex
CREATE INDEX "ReplayCheckpoint_projectionId_sourceSequence_commandOrdinal_idx" ON "ReplayCheckpoint"("projectionId", "sourceSequence", "commandOrdinal");

-- CreateIndex
CREATE INDEX "ReplayCorrectionJob_replaySessionId_createdAt_idx" ON "ReplayCorrectionJob"("replaySessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ReplayCorrectionJob_status_heartbeatAt_idx" ON "ReplayCorrectionJob"("status", "heartbeatAt");

-- Preserve every existing journal as its own training session. Archived journals
-- have no surviving account, so no historical account state is fabricated.
INSERT INTO "ReplaySession" ("id", "datasetId", "name", "mode", "status", "legacy", "createdAt", "updatedAt")
SELECT 'legacy-journal:' || j."id", j."datasetId", j."name", 'TRAINING',
  CASE WHEN EXISTS (SELECT 1 FROM "PaperTradingSession" a WHERE a."journalSessionId" = j."id") THEN 'ACTIVE' ELSE 'ARCHIVED' END,
  true, j."createdAt", j."updatedAt" FROM "ReplayJournalSession" j;
UPDATE "ReplayJournalSession" SET "replaySessionId" = 'legacy-journal:' || "id";

INSERT INTO "ReplaySession" ("id", "datasetId", "name", "mode", "status", "legacy", "createdAt", "updatedAt")
SELECT 'legacy-current:' || d."id", d."id", '原有回放', 'TRAINING', 'ACTIVE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "MarketDataset" d WHERE
  (EXISTS (SELECT 1 FROM "ReplayProgress" p WHERE p."datasetId" = d."id")
   OR EXISTS (SELECT 1 FROM "PaperTradingSession" a WHERE a."datasetId" = d."id"))
  AND NOT EXISTS (SELECT 1 FROM "PaperTradingSession" a WHERE a."datasetId" = d."id" AND a."journalSessionId" IS NOT NULL);

UPDATE "ReplayProgress" SET "replaySessionId" = COALESCE(
  (SELECT j."replaySessionId" FROM "PaperTradingSession" a JOIN "ReplayJournalSession" j ON j."id" = a."journalSessionId"
   WHERE a."datasetId" = "ReplayProgress"."datasetId"), 'legacy-current:' || "datasetId");
UPDATE "ReplayProgress" SET "currentSequence" = COALESCE(
  (SELECT a."lastProcessedSequence" FROM "PaperTradingSession" a WHERE a."datasetId" = "ReplayProgress"."datasetId"), "currentSequence"),
  "lastSyncRequestId" = NULL, "lastSyncResponse" = NULL;

-- Drawings without a current replay are retained in a separate archive.
INSERT INTO "ReplaySession" ("id", "datasetId", "name", "mode", "status", "legacy", "createdAt", "updatedAt")
SELECT 'legacy-drawings:' || d."id", d."id", '原有画线', 'TRAINING', 'ARCHIVED', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "MarketDataset" d WHERE EXISTS (SELECT 1 FROM "MarketDrawing" m WHERE m."datasetId" = d."id")
  AND NOT EXISTS (SELECT 1 FROM "ReplaySession" r WHERE r."datasetId" = d."id" AND r."status" = 'ACTIVE');

INSERT INTO "ReplayProjection" ("id", "replaySessionId", "generation", "status", "historyVersion", "currentSequence")
SELECT 'legacy-projection:' || r."id", r."id", COALESCE(p."generation", j."replayGeneration", 1), 'CURRENT', d."historyVersion",
  COALESCE(p."currentSequence", (SELECT MAX(e."closedSequence") FROM "ReplayJournalEntry" e WHERE e."journalSessionId" = j."id"), -1)
FROM "ReplaySession" r JOIN "MarketDataset" d ON d."id" = r."datasetId"
LEFT JOIN "ReplayProgress" p ON p."replaySessionId" = r."id"
LEFT JOIN "ReplayJournalSession" j ON j."replaySessionId" = r."id";
UPDATE "ReplaySession" SET "activeProjectionId" = 'legacy-projection:' || "id";
UPDATE "PaperTradingSession" SET "projectionId" = 'legacy-projection:' || COALESCE(
  (SELECT j."replaySessionId" FROM "ReplayJournalSession" j WHERE j."id" = "PaperTradingSession"."journalSessionId"),
  'legacy-current:' || "datasetId");
UPDATE "ReplayJournalEntry" SET "projectionId" =
  (SELECT 'legacy-projection:' || j."replaySessionId" FROM "ReplayJournalSession" j WHERE j."id" = "ReplayJournalEntry"."journalSessionId"),
  "logicalKey" = "id";
UPDATE "MarketDrawing" SET "replaySessionId" = COALESCE(
  (SELECT r."id" FROM "ReplaySession" r WHERE r."datasetId" = "MarketDrawing"."datasetId" AND r."status" = 'ACTIVE'),
  'legacy-drawings:' || "datasetId");

