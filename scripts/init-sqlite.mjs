import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const createStatements = [
  `CREATE TABLE IF NOT EXISTS "TradeDataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "date" DATETIME,
    "symbol" TEXT,
    "direction" TEXT,
    "pnl" REAL,
    "riskAmount" REAL,
    "rMultiple" REAL NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trade_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "TradeDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "SimulationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "samplePaths" TEXT NOT NULL,
    "percentileCurves" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SimulationRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "TradeDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "TradeJournal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "datasetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeJournal_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "TradeDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "TradeOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "TradeTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "_TradeToTradeTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_TradeToTradeTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_TradeToTradeTag_B_fkey" FOREIGN KEY ("B") REFERENCES "TradeTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "MarketDataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '回放会话',
    "description" TEXT,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
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
  )`,
  `CREATE TABLE IF NOT EXISTS "MarketBar" (
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
  )`,
  `CREATE TABLE IF NOT EXISTS "ReplayProgress" (
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
  )`,
  `CREATE TABLE IF NOT EXISTS "PaperTradingSession" (
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
  )`,
  `CREATE TABLE IF NOT EXISTS "ReplayJournalSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
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
  )`,
  `CREATE TABLE IF NOT EXISTS "PaperPositionLot" (
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
  )`,
  `CREATE TABLE IF NOT EXISTS "ReplayJournalEntry" (
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
    "setupOptionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReplayJournalEntry_journalSessionId_fkey" FOREIGN KEY ("journalSessionId") REFERENCES "ReplayJournalSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReplayJournalEntry_setupOptionId_fkey" FOREIGN KEY ("setupOptionId") REFERENCES "TradeOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "PaperOrder" (
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
  )`,
  `CREATE TABLE IF NOT EXISTS "PaperFill" (
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
  )`,
  `CREATE TABLE IF NOT EXISTS "PaperTrade" (
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
  )`,
  `CREATE TABLE IF NOT EXISTS "PaperEquityPoint" (
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "balance" REAL NOT NULL,
    "equity" REAL NOT NULL,
    "drawdown" REAL NOT NULL,
    PRIMARY KEY ("sessionId", "sequence"),
    CONSTRAINT "PaperEquityPoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaperTradingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "MarketBarBlock" (
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
  )`,
  `CREATE TABLE IF NOT EXISTS "MarketBarBlockBuildState" (
    "datasetId" TEXT NOT NULL,
    "blockSize" INTEGER NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT -1,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("datasetId", "blockSize"),
    CONSTRAINT "MarketBarBlockBuildState_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "MarketDatasetImport" (
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
  )`,
  `CREATE TABLE IF NOT EXISTS "MarketDrawing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "geometry" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketDrawing_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
];

const tradeColumns = [
  ["instrumentOptionId", "TEXT"],
  ["strategyOptionId", "TEXT"],
  ["entryPrice", "REAL"],
  ["stopLossPrice", "REAL"],
  ["targetPrice", "REAL"],
  ["exitPrice", "REAL"],
  ["strategyCode", "TEXT"],
  ["screenshotPath", "TEXT"],
];

const marketDatasetColumns = [
  ["status", "TEXT NOT NULL DEFAULT 'READY'"],
  ["dataVersion", "INTEGER NOT NULL DEFAULT 1"],
  ["replayGeneration", "INTEGER NOT NULL DEFAULT 0"],
  ["nextReplayJournalNo", "INTEGER NOT NULL DEFAULT 0"],
  ["barBlockBuildCursor", "INTEGER NOT NULL DEFAULT -1"],
  ["sourceIntervalSeconds", "INTEGER"],
  ["priceTickSize", "REAL NOT NULL DEFAULT 0.01"],
  ["sessionMode", "TEXT NOT NULL DEFAULT 'TWENTY_FOUR_SEVEN'"],
  ["sessionOpenMinute", "INTEGER"],
  ["sessionCloseMinute", "INTEGER"],
  ["tradingWeekdays", "TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7'"],
];
const replayProgressColumns = [
  ["playbackRate", "INTEGER NOT NULL DEFAULT 1"], ["displayIntervalSeconds", "INTEGER"],
  ["displaySession", "TEXT NOT NULL DEFAULT 'ETH'"],
  ["generation", "INTEGER NOT NULL DEFAULT 1"], ["syncVersion", "INTEGER NOT NULL DEFAULT 0"],
  ["lastSyncRequestId", "TEXT"], ["lastSyncResponse", "TEXT"],
];
const paperSessionColumns = [
  ["journalSessionId", "TEXT"],
  ["equitySampleStride", "INTEGER NOT NULL DEFAULT 1"],
  ["tradeStatsVersion", "INTEGER NOT NULL DEFAULT 1"],
  ["closedTradeCount", "INTEGER NOT NULL DEFAULT 0"],
  ["winningTradeCount", "INTEGER NOT NULL DEFAULT 0"],
  ["losingTradeCount", "INTEGER NOT NULL DEFAULT 0"],
  ["grossWinningPnl", "REAL NOT NULL DEFAULT 0"],
  ["grossLosingPnl", "REAL NOT NULL DEFAULT 0"],
  ["currentWinStreak", "INTEGER NOT NULL DEFAULT 0"],
  ["currentLossStreak", "INTEGER NOT NULL DEFAULT 0"],
  ["maxConsecutiveWins", "INTEGER NOT NULL DEFAULT 0"],
  ["maxConsecutiveLosses", "INTEGER NOT NULL DEFAULT 0"],
];
const paperOrderColumns = [["riskAmount", "REAL"]];
const paperPositionLotColumns = [["initialStopPrice", "REAL"], ["entryOrderType", "TEXT"]];
const replayJournalSessionColumns = [
  ["name", "TEXT NOT NULL DEFAULT '回放会话'"],
  ["nextEntryNo", "INTEGER NOT NULL DEFAULT 0"],
];
const replayJournalEntryColumns = [
  ["initialStopPrice", "REAL"],
  ["entryOrderType", "TEXT"],
  ["accountNo", "INTEGER NOT NULL DEFAULT 0"],
  ["setupOptionId", "TEXT REFERENCES \"TradeOption\"(\"id\") ON DELETE SET NULL ON UPDATE CASCADE"],
];
const marketDatasetImportColumns = [
  ["importedBars", "INTEGER NOT NULL DEFAULT 0"],
  ["stage", "TEXT NOT NULL DEFAULT 'WAITING_UPLOAD'"],
  ["stageProcessedBytes", "BIGINT NOT NULL DEFAULT 0"],
  ["stageTotalBytes", "BIGINT NOT NULL DEFAULT 0"],
  ["totalRows", "INTEGER NOT NULL DEFAULT 0"],
  ["stageStartedAt", "DATETIME"],
  ["workerPid", "INTEGER"],
  ["workerRssBytes", "BIGINT NOT NULL DEFAULT 0"],
  ["peakWorkerRssBytes", "BIGINT NOT NULL DEFAULT 0"],
];

const indexStatements = [
  `CREATE INDEX IF NOT EXISTS "Trade_datasetId_idx" ON "Trade"("datasetId")`,
  `CREATE INDEX IF NOT EXISTS "Trade_instrumentOptionId_idx" ON "Trade"("instrumentOptionId")`,
  `CREATE INDEX IF NOT EXISTS "Trade_strategyOptionId_idx" ON "Trade"("strategyOptionId")`,
  `CREATE INDEX IF NOT EXISTS "SimulationRun_datasetId_idx" ON "SimulationRun"("datasetId")`,
  `CREATE INDEX IF NOT EXISTS "SimulationRun_createdAt_idx" ON "SimulationRun"("createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TradeJournal_datasetId_key" ON "TradeJournal"("datasetId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TradeOption_type_name_key" ON "TradeOption"("type", "name")`,
  `CREATE INDEX IF NOT EXISTS "TradeOption_type_active_idx" ON "TradeOption"("type", "active")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TradeTag_normalizedName_key" ON "TradeTag"("normalizedName")`,
  `CREATE INDEX IF NOT EXISTS "TradeTag_name_idx" ON "TradeTag"("name")`,
  `CREATE INDEX IF NOT EXISTS "MarketDataset_createdAt_idx" ON "MarketDataset"("createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MarketBar_datasetId_timestamp_key" ON "MarketBar"("datasetId", "timestamp")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PaperTradingSession_datasetId_key" ON "PaperTradingSession"("datasetId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PaperTradingSession_journalSessionId_key" ON "PaperTradingSession"("journalSessionId")`,
  `CREATE INDEX IF NOT EXISTS "PaperTradingSession_datasetId_idx" ON "PaperTradingSession"("datasetId")`,
  `CREATE INDEX IF NOT EXISTS "PaperOrder_sessionId_status_idx" ON "PaperOrder"("sessionId", "status")`,
  `CREATE INDEX IF NOT EXISTS "PaperOrder_sessionId_createdSequence_idx" ON "PaperOrder"("sessionId", "createdSequence")`,
  `CREATE INDEX IF NOT EXISTS "PaperFill_sessionId_sequence_idx" ON "PaperFill"("sessionId", "sequence")`,
  `CREATE INDEX IF NOT EXISTS "PaperFill_orderId_idx" ON "PaperFill"("orderId")`,
  `CREATE INDEX IF NOT EXISTS "PaperTrade_sessionId_status_idx" ON "PaperTrade"("sessionId", "status")`,
  `CREATE INDEX IF NOT EXISTS "PaperTrade_sessionId_openedSequence_idx" ON "PaperTrade"("sessionId", "openedSequence")`,
  `CREATE INDEX IF NOT EXISTS "ReplayJournalSession_datasetId_createdAt_idx" ON "ReplayJournalSession"("datasetId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "ReplayJournalSession_datasetId_archivedAt_idx" ON "ReplayJournalSession"("datasetId", "archivedAt")`,
  `CREATE INDEX IF NOT EXISTS "PaperPositionLot_sessionId_openedSequence_idx" ON "PaperPositionLot"("sessionId", "openedSequence")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ReplayJournalEntry_journalSessionId_id_key" ON "ReplayJournalEntry"("journalSessionId", "id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ReplayJournalEntry_journalSessionId_accountNo_key" ON "ReplayJournalEntry"("journalSessionId", "accountNo")`,
  `CREATE INDEX IF NOT EXISTS "ReplayJournalEntry_journalSessionId_no_idx" ON "ReplayJournalEntry"("journalSessionId", "no")`,
  `CREATE INDEX IF NOT EXISTS "ReplayJournalEntry_journalSessionId_openedSequence_idx" ON "ReplayJournalEntry"("journalSessionId", "openedSequence")`,
  `CREATE INDEX IF NOT EXISTS "ReplayJournalEntry_journalSessionId_closedSequence_idx" ON "ReplayJournalEntry"("journalSessionId", "closedSequence")`,
  `CREATE INDEX IF NOT EXISTS "ReplayJournalEntry_setupOptionId_idx" ON "ReplayJournalEntry"("setupOptionId")`,
  `CREATE INDEX IF NOT EXISTS "MarketBarBlock_datasetId_blockSize_startTime_endTime_idx" ON "MarketBarBlock"("datasetId", "blockSize", "startTime", "endTime")`,
  `CREATE INDEX IF NOT EXISTS "MarketDatasetImport_status_createdAt_idx" ON "MarketDatasetImport"("status", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "MarketDrawing_datasetId_createdAt_idx" ON "MarketDrawing"("datasetId", "createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "_TradeToTradeTag_AB_unique" ON "_TradeToTradeTag"("A", "B")`,
  `CREATE INDEX IF NOT EXISTS "_TradeToTradeTag_B_index" ON "_TradeToTradeTag"("B")`,
];

try {
  for (const statement of createStatements) {
    await prisma.$executeRawUnsafe(statement);
  }

  const existingTradeColumns = await prisma.$queryRawUnsafe(`PRAGMA table_info("Trade")`);
  const existingTradeColumnNames = new Set(existingTradeColumns.map((column) => column.name));
  for (const [name, type] of tradeColumns) {
    if (!existingTradeColumnNames.has(name)) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Trade" ADD COLUMN "${name}" ${type}`);
    }
  }

  for (const [table, columns] of [
    ["MarketDataset", marketDatasetColumns],
    ["ReplayProgress", replayProgressColumns],
    ["PaperTradingSession", paperSessionColumns],
    ["PaperOrder", paperOrderColumns],
    ["PaperPositionLot", paperPositionLotColumns],
    ["ReplayJournalSession", replayJournalSessionColumns],
    ["ReplayJournalEntry", replayJournalEntryColumns],
    ["MarketDatasetImport", marketDatasetImportColumns],
  ]) {
    const existing = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
    const names = new Set(existing.map((column) => column.name));
    for (const [name, type] of columns) {
      if (!names.has(name)) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${type}`);
        if (table === "PaperTradingSession" && name === "tradeStatsVersion") {
          await prisma.$executeRawUnsafe(`UPDATE "PaperTradingSession" SET "tradeStatsVersion" = 0`);
        }
      }
    }
  }

  await prisma.$executeRawUnsafe(`
    UPDATE "PaperPositionLot"
    SET "entryOrderType" = (
      SELECT "PaperOrder"."type"
      FROM "PaperFill"
      INNER JOIN "PaperOrder" ON "PaperOrder"."id" = "PaperFill"."orderId"
      WHERE "PaperFill"."id" = "PaperPositionLot"."entryFillId"
      LIMIT 1
    )
    WHERE "entryOrderType" IS NULL
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE "ReplayJournalEntry"
    SET "entryOrderType" = (
      SELECT "PaperOrder"."type"
      FROM "PaperFill"
      INNER JOIN "PaperOrder" ON "PaperOrder"."id" = "PaperFill"."orderId"
      WHERE "ReplayJournalEntry"."lotId" = 'lot_' || "PaperFill"."id"
      LIMIT 1
    )
    WHERE "entryOrderType" IS NULL
  `);
  await prisma.$executeRawUnsafe(`
    WITH "ranked" AS (
      SELECT
        "id",
        ROW_NUMBER() OVER (PARTITION BY "journalSessionId" ORDER BY "no", "id") AS "accountNo"
      FROM "ReplayJournalEntry"
    )
    UPDATE "ReplayJournalEntry"
    SET "accountNo" = (
      SELECT "ranked"."accountNo"
      FROM "ranked"
      WHERE "ranked"."id" = "ReplayJournalEntry"."id"
    )
    WHERE "accountNo" = 0
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE "ReplayJournalSession"
    SET "name" = '回放会话 ' || "replayGeneration"
    WHERE "name" IS NULL OR TRIM("name") = ''
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE "ReplayJournalSession"
    SET "nextEntryNo" = (
      SELECT COALESCE(MAX("accountNo"), 0)
      FROM "ReplayJournalEntry"
      WHERE "ReplayJournalEntry"."journalSessionId" = "ReplayJournalSession"."id"
    )
    WHERE "nextEntryNo" < (
      SELECT COALESCE(MAX("accountNo"), 0)
      FROM "ReplayJournalEntry"
      WHERE "ReplayJournalEntry"."journalSessionId" = "ReplayJournalSession"."id"
    )
  `);

  const replayProgressTable = await prisma.$queryRawUnsafe(`PRAGMA table_info("ReplayProgress")`);
  if (replayProgressTable.some((column) => column.name === "intervalMs")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ReplayProgress" DROP COLUMN "intervalMs"`);
  }

  const marketBarBlockTable = await prisma.$queryRawUnsafe(`PRAGMA table_info("MarketBarBlock")`);
  if (!marketBarBlockTable.some((column) => column.name === "blockSize")) {
    await prisma.$executeRawUnsafe(`CREATE TABLE "new_MarketBarBlock" (
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
    )`);
    await prisma.$executeRawUnsafe(`INSERT INTO "new_MarketBarBlock" (
      "datasetId", "blockSize", "startSequence", "endSequence", "startTime", "endTime",
      "open", "high", "low", "close", "volume", "volumeCount", "barCount"
    ) SELECT "datasetId", 4096, "startSequence", "endSequence", "startTime", "endTime",
      "open", "high", "low", "close", "volume", "volumeCount", "barCount" FROM "MarketBarBlock"`);
    await prisma.$executeRawUnsafe(`DROP TABLE "MarketBarBlock"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "new_MarketBarBlock" RENAME TO "MarketBarBlock"`);
  }
  await prisma.$executeRawUnsafe(`INSERT OR IGNORE INTO "MarketBarBlockBuildState" ("datasetId", "blockSize", "cursor", "updatedAt")
    SELECT "id", 4096, "barBlockBuildCursor", CURRENT_TIMESTAMP FROM "MarketDataset" WHERE "barBlockBuildCursor" >= 0`);

  for (const statement of indexStatements) {
    await prisma.$executeRawUnsafe(statement);
  }
  console.log("SQLite database initialized.");
} finally {
  await prisma.$disconnect();
}
