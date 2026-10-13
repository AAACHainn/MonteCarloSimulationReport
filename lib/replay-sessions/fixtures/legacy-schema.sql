-- CreateTable
CREATE TABLE "TradeDataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "date" DATETIME,
    "symbol" TEXT,
    "direction" TEXT,
    "pnl" REAL,
    "riskAmount" REAL,
    "rMultiple" REAL NOT NULL,
    "note" TEXT,
    "instrumentOptionId" TEXT,
    "strategyOptionId" TEXT,
    "entryPrice" REAL,
    "stopLossPrice" REAL,
    "targetPrice" REAL,
    "exitPrice" REAL,
    "strategyCode" TEXT,
    "screenshotPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trade_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "TradeDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Trade_instrumentOptionId_fkey" FOREIGN KEY ("instrumentOptionId") REFERENCES "TradeOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Trade_strategyOptionId_fkey" FOREIGN KEY ("strategyOptionId") REFERENCES "TradeOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "samplePaths" TEXT NOT NULL,
    "percentileCurves" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SimulationRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "TradeDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeJournal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "datasetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeJournal_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "TradeDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TradeTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TradeReason" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketDataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
    "historyVersion" INTEGER NOT NULL DEFAULT 1,
    "replayGeneration" INTEGER NOT NULL DEFAULT 0,
    "nextReplayJournalNo" INTEGER NOT NULL DEFAULT 0,
    "barBlockBuildCursor" INTEGER NOT NULL DEFAULT -1,
    "sourceIntervalSeconds" INTEGER,
    "priceTickSize" REAL NOT NULL DEFAULT 0.01,
    "sessionMode" TEXT NOT NULL DEFAULT 'TWENTY_FOUR_SEVEN',
    "sessionOpenMinute" INTEGER,
    "sessionCloseMinute" INTEGER,
    "tradingWeekdays" TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
    "barCount" INTEGER NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketDataConnection" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'databento',
    "encryptedKey" TEXT NOT NULL,
    "keySuffix" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'UNTESTED',
    "testedAt" DATETIME,
    "error" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketDatasetSyncConfig" (
    "datasetId" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'OFF',
    "profile" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "perRunBudget" REAL NOT NULL DEFAULT 0,
    "dailyBudget" REAL NOT NULL DEFAULT 0,
    "checkedThrough" DATETIME,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" DATETIME,
    "lastCheckedAt" DATETIME,
    "availableThrough" DATETIME,
    "pausedReason" TEXT,
    "leaseOwner" TEXT,
    "leaseUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketDatasetSyncConfig_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketDataSyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT NOT NULL DEFAULT 'CHECKING',
    "configSnapshot" TEXT NOT NULL,
    "requestStart" DATETIME,
    "requestEnd" DATETIME,
    "cursor" DATETIME,
    "addedBars" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" REAL NOT NULL DEFAULT 0,
    "charges" TEXT NOT NULL DEFAULT '[]',
    "mappings" TEXT NOT NULL DEFAULT '{}',
    "conflicts" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "leaseOwner" TEXT,
    "leaseUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketDataSyncRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketDatasetUpdateLease" (
    "datasetId" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketSyncSchedulerLease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "heartbeat" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketDrawing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "geometry" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketDrawing_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketBarBlock" (
    "datasetId" TEXT NOT NULL,
    "blockSize" INTEGER NOT NULL DEFAULT 4096,
    "startSequence" INTEGER NOT NULL,
    "endSequence" INTEGER NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL,
    "volumeCount" INTEGER NOT NULL,
    "barCount" INTEGER NOT NULL,

    PRIMARY KEY ("datasetId", "blockSize", "startSequence"),
    CONSTRAINT "MarketBarBlock_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketBarBlockBuildState" (
    "datasetId" TEXT NOT NULL,
    "blockSize" INTEGER NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT -1,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("datasetId", "blockSize"),
    CONSTRAINT "MarketBarBlockBuildState_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketDatasetImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "fileName" TEXT NOT NULL,
    "storedPath" TEXT,
    "compressedBytes" BIGINT NOT NULL DEFAULT 0,
    "expandedBytes" BIGINT NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "importedBars" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT NOT NULL DEFAULT 'WAITING_UPLOAD',
    "stageProcessedBytes" BIGINT NOT NULL DEFAULT 0,
    "stageTotalBytes" BIGINT NOT NULL DEFAULT 0,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "stageStartedAt" DATETIME,
    "workerPid" INTEGER,
    "workerRssBytes" BIGINT NOT NULL DEFAULT 0,
    "peakWorkerRssBytes" BIGINT NOT NULL DEFAULT 0,
    "totalErrors" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT NOT NULL DEFAULT '[]',
    "metadata" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketDatasetImport_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketBar" (
    "datasetId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL,

    PRIMARY KEY ("datasetId", "sequence"),
    CONSTRAINT "MarketBar_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReplayProgress" (
    "datasetId" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "ReplayProgress_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaperTradingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
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
    CONSTRAINT "PaperTradingSession_journalSessionId_fkey" FOREIGN KEY ("journalSessionId") REFERENCES "ReplayJournalSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReplayJournalSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
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
    CONSTRAINT "ReplayJournalSession_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaperPositionLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "entryFillId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "openedSequence" INTEGER NOT NULL,
    "openedAt" DATETIME NOT NULL,
    "entryPrice" REAL NOT NULL,
    "entryOrderType" TEXT,
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

-- CreateTable
CREATE TABLE "ReplayReviewTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReplayJournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalSessionId" TEXT NOT NULL,
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
    "review" TEXT NOT NULL DEFAULT '',
    "setupOptionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReplayJournalEntry_journalSessionId_fkey" FOREIGN KEY ("journalSessionId") REFERENCES "ReplayJournalSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReplayJournalEntry_setupOptionId_fkey" FOREIGN KEY ("setupOptionId") REFERENCES "TradeOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaperOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "quantity" REAL NOT NULL,
    "riskAmount" REAL,
    "price" REAL,
    "stopLoss" REAL,
    "takeProfit" REAL,
    "reduceOnly" BOOLEAN NOT NULL DEFAULT false,
    "isProtective" BOOLEAN NOT NULL DEFAULT false,
    "ocoGroupId" TEXT,
    "createdSequence" INTEGER NOT NULL,
    "activeFromSequence" INTEGER NOT NULL,
    "filledSequence" INTEGER,
    "filledAt" DATETIME,
    "filledPrice" REAL,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperOrder_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaperTradingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaperFill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "side" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "quantity" REAL NOT NULL,
    "fee" REAL NOT NULL,
    "slippageCost" REAL NOT NULL,
    "realizedPnl" REAL NOT NULL,
    "closedQuantity" REAL NOT NULL,
    "openedQuantity" REAL NOT NULL,
    "netQuantityAfter" REAL NOT NULL,
    "averagePriceAfter" REAL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaperFill_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaperTradingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaperFill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PaperOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedSequence" INTEGER NOT NULL,
    "openedAt" DATETIME NOT NULL,
    "closedSequence" INTEGER,
    "closedAt" DATETIME,
    "grossPnl" REAL NOT NULL DEFAULT 0,
    "fees" REAL NOT NULL DEFAULT 0,
    "plannedRisk" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperTrade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaperTradingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaperEquityPoint" (
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "balance" REAL NOT NULL,
    "equity" REAL NOT NULL,
    "drawdown" REAL NOT NULL,

    PRIMARY KEY ("sessionId", "sequence"),
    CONSTRAINT "PaperEquityPoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaperTradingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_TradeToTradeTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_TradeToTradeTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_TradeToTradeTag_B_fkey" FOREIGN KEY ("B") REFERENCES "TradeTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ReplayJournalTradeReasons" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ReplayJournalTradeReasons_A_fkey" FOREIGN KEY ("A") REFERENCES "ReplayJournalEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ReplayJournalTradeReasons_B_fkey" FOREIGN KEY ("B") REFERENCES "TradeReason" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Trade_datasetId_idx" ON "Trade"("datasetId");

-- CreateIndex
CREATE INDEX "Trade_instrumentOptionId_idx" ON "Trade"("instrumentOptionId");

-- CreateIndex
CREATE INDEX "Trade_strategyOptionId_idx" ON "Trade"("strategyOptionId");

-- CreateIndex
CREATE INDEX "SimulationRun_datasetId_idx" ON "SimulationRun"("datasetId");

-- CreateIndex
CREATE INDEX "SimulationRun_createdAt_idx" ON "SimulationRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeJournal_datasetId_key" ON "TradeJournal"("datasetId");

-- CreateIndex
CREATE INDEX "TradeOption_type_active_idx" ON "TradeOption"("type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOption_type_name_key" ON "TradeOption"("type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TradeTag_normalizedName_key" ON "TradeTag"("normalizedName");

-- CreateIndex
CREATE INDEX "TradeTag_name_idx" ON "TradeTag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TradeReason_normalizedName_key" ON "TradeReason"("normalizedName");

-- CreateIndex
CREATE INDEX "TradeReason_name_idx" ON "TradeReason"("name");

-- CreateIndex
CREATE INDEX "MarketDataset_createdAt_idx" ON "MarketDataset"("createdAt");

-- CreateIndex
CREATE INDEX "MarketDatasetSyncConfig_mode_nextRunAt_idx" ON "MarketDatasetSyncConfig"("mode", "nextRunAt");

-- CreateIndex
CREATE INDEX "MarketDataSyncRun_status_createdAt_idx" ON "MarketDataSyncRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketDataSyncRun_datasetId_createdAt_idx" ON "MarketDataSyncRun"("datasetId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketDataSyncRun_datasetId_updatedAt_idx" ON "MarketDataSyncRun"("datasetId", "updatedAt");

-- CreateIndex
CREATE INDEX "MarketDrawing_datasetId_createdAt_idx" ON "MarketDrawing"("datasetId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketBarBlock_datasetId_blockSize_startTime_endTime_idx" ON "MarketBarBlock"("datasetId", "blockSize", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "MarketDatasetImport_status_createdAt_idx" ON "MarketDatasetImport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketBar_datasetId_timestamp_key" ON "MarketBar"("datasetId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "PaperTradingSession_datasetId_key" ON "PaperTradingSession"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperTradingSession_journalSessionId_key" ON "PaperTradingSession"("journalSessionId");

-- CreateIndex
CREATE INDEX "PaperTradingSession_datasetId_idx" ON "PaperTradingSession"("datasetId");

-- CreateIndex
CREATE INDEX "ReplayJournalSession_datasetId_createdAt_idx" ON "ReplayJournalSession"("datasetId", "createdAt");

-- CreateIndex
CREATE INDEX "ReplayJournalSession_datasetId_archivedAt_idx" ON "ReplayJournalSession"("datasetId", "archivedAt");

-- CreateIndex
CREATE INDEX "PaperPositionLot_sessionId_openedSequence_idx" ON "PaperPositionLot"("sessionId", "openedSequence");

-- CreateIndex
CREATE UNIQUE INDEX "ReplayReviewTemplate_normalizedName_key" ON "ReplayReviewTemplate"("normalizedName");

-- CreateIndex
CREATE INDEX "ReplayReviewTemplate_name_idx" ON "ReplayReviewTemplate"("name");

-- CreateIndex
CREATE INDEX "ReplayJournalEntry_journalSessionId_no_idx" ON "ReplayJournalEntry"("journalSessionId", "no");

-- CreateIndex
CREATE INDEX "ReplayJournalEntry_journalSessionId_openedSequence_idx" ON "ReplayJournalEntry"("journalSessionId", "openedSequence");

-- CreateIndex
CREATE INDEX "ReplayJournalEntry_journalSessionId_closedSequence_idx" ON "ReplayJournalEntry"("journalSessionId", "closedSequence");

-- CreateIndex
CREATE INDEX "ReplayJournalEntry_setupOptionId_idx" ON "ReplayJournalEntry"("setupOptionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplayJournalEntry_journalSessionId_id_key" ON "ReplayJournalEntry"("journalSessionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReplayJournalEntry_journalSessionId_accountNo_key" ON "ReplayJournalEntry"("journalSessionId", "accountNo");

-- CreateIndex
CREATE INDEX "PaperOrder_sessionId_status_idx" ON "PaperOrder"("sessionId", "status");

-- CreateIndex
CREATE INDEX "PaperOrder_sessionId_createdSequence_idx" ON "PaperOrder"("sessionId", "createdSequence");

-- CreateIndex
CREATE INDEX "PaperFill_sessionId_sequence_idx" ON "PaperFill"("sessionId", "sequence");

-- CreateIndex
CREATE INDEX "PaperFill_orderId_idx" ON "PaperFill"("orderId");

-- CreateIndex
CREATE INDEX "PaperTrade_sessionId_status_idx" ON "PaperTrade"("sessionId", "status");

-- CreateIndex
CREATE INDEX "PaperTrade_sessionId_openedSequence_idx" ON "PaperTrade"("sessionId", "openedSequence");

-- CreateIndex
CREATE UNIQUE INDEX "_TradeToTradeTag_AB_unique" ON "_TradeToTradeTag"("A", "B");

-- CreateIndex
CREATE INDEX "_TradeToTradeTag_B_index" ON "_TradeToTradeTag"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ReplayJournalTradeReasons_AB_unique" ON "_ReplayJournalTradeReasons"("A", "B");

-- CreateIndex
CREATE INDEX "_ReplayJournalTradeReasons_B_index" ON "_ReplayJournalTradeReasons"("B");

