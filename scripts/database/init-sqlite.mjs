import { createDatabaseClient } from "../../lib/sqlite-client.mjs";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const prisma = createDatabaseClient({}, { allowCreate: true });

const createStatements = [
  `CREATE TABLE IF NOT EXISTS "ReplayReviewTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ReplayReviewTemplate_normalizedName_key" ON "ReplayReviewTemplate"("normalizedName")`,
  `CREATE INDEX IF NOT EXISTS "ReplayReviewTemplate_name_idx" ON "ReplayReviewTemplate"("name")`,
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
  `CREATE TABLE IF NOT EXISTS "TradeReason" (
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
  `CREATE TABLE IF NOT EXISTS "_ReplayJournalTradeReasons" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ReplayJournalTradeReasons_A_fkey" FOREIGN KEY ("A") REFERENCES "ReplayJournalEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ReplayJournalTradeReasons_B_fkey" FOREIGN KEY ("B") REFERENCES "TradeReason" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "activeAggregationId" TEXT,
    "sourceIntervalSeconds" INTEGER,
    "barEmissionMode" TEXT NOT NULL DEFAULT 'UNKNOWN',
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
  ["activeAggregationId", "TEXT"],
  ["sourceIntervalSeconds", "INTEGER"],
  ["barEmissionMode", "TEXT NOT NULL DEFAULT 'UNKNOWN'"],
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
  ["review", "TEXT NOT NULL DEFAULT '' CHECK(length(\"review\") <= 2000)"],
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
  `CREATE UNIQUE INDEX IF NOT EXISTS "TradeReason_normalizedName_key" ON "TradeReason"("normalizedName")`,
  `CREATE INDEX IF NOT EXISTS "TradeReason_name_idx" ON "TradeReason"("name")`,
  `CREATE INDEX IF NOT EXISTS "MarketDataset_createdAt_idx" ON "MarketDataset"("createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MarketBar_datasetId_timestamp_key" ON "MarketBar"("datasetId", "timestamp")`,
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
  `CREATE INDEX IF NOT EXISTS "ReplayJournalEntry_journalSessionId_no_idx" ON "ReplayJournalEntry"("journalSessionId", "no")`,
  `CREATE INDEX IF NOT EXISTS "ReplayJournalEntry_journalSessionId_openedSequence_idx" ON "ReplayJournalEntry"("journalSessionId", "openedSequence")`,
  `CREATE INDEX IF NOT EXISTS "ReplayJournalEntry_journalSessionId_closedSequence_idx" ON "ReplayJournalEntry"("journalSessionId", "closedSequence")`,
  `CREATE INDEX IF NOT EXISTS "ReplayJournalEntry_setupOptionId_idx" ON "ReplayJournalEntry"("setupOptionId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "_ReplayJournalTradeReasons_AB_unique" ON "_ReplayJournalTradeReasons"("A", "B")`,
  `CREATE INDEX IF NOT EXISTS "_ReplayJournalTradeReasons_B_index" ON "_ReplayJournalTradeReasons"("B")`,
  `CREATE INDEX IF NOT EXISTS "MarketDatasetImport_status_createdAt_idx" ON "MarketDatasetImport"("status", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "MarketDrawing_datasetId_createdAt_idx" ON "MarketDrawing"("datasetId", "createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "_TradeToTradeTag_AB_unique" ON "_TradeToTradeTag"("A", "B")`,
  `CREATE INDEX IF NOT EXISTS "_TradeToTradeTag_B_index" ON "_TradeToTradeTag"("B")`,
];

try {
  for (const statement of createStatements) {
    await prisma.$executeRawUnsafe(statement);
  }

  const legacyReasonTables = await prisma.$queryRawUnsafe(
    `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = '_ReplayJournalReasonTags'`,
  );
  if (legacyReasonTables.length > 0) {
    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "TradeReason" ("id", "name", "normalizedName", "createdAt", "updatedAt")
      SELECT DISTINCT "TradeTag"."id", "TradeTag"."name", "TradeTag"."normalizedName", "TradeTag"."createdAt", "TradeTag"."updatedAt"
      FROM "TradeTag"
      INNER JOIN "_ReplayJournalReasonTags"
        ON "_ReplayJournalReasonTags"."B" = "TradeTag"."id"
    `);
    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "_ReplayJournalTradeReasons" ("A", "B")
      SELECT "A", "B" FROM "_ReplayJournalReasonTags"
    `);
    await prisma.$executeRawUnsafe(`DROP TABLE "_ReplayJournalReasonTags"`);
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

  const [journalEntryTable] = await prisma.$queryRawUnsafe(
    `SELECT "sql" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'ReplayJournalEntry'`,
  );
  if (/CHECK\s*\(\s*length\s*\(\s*"review"\s*\)\s*<=\s*300\s*\)/i.test(journalEntryTable.sql)) {
    // Replace only the review column in one transaction, preserving entries and their relations.
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`ALTER TABLE "ReplayJournalEntry" ADD COLUMN "review_expanded" TEXT NOT NULL DEFAULT '' CHECK(length("review_expanded") <= 2000)`),
      prisma.$executeRawUnsafe(`UPDATE "ReplayJournalEntry" SET "review_expanded" = "review"`),
      prisma.$executeRawUnsafe(`ALTER TABLE "ReplayJournalEntry" DROP COLUMN "review"`),
      prisma.$executeRawUnsafe(`ALTER TABLE "ReplayJournalEntry" RENAME COLUMN "review_expanded" TO "review"`),
    ]);
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

  // Replace disposable summaries without scanning or rewriting raw prices.
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "MarketBarBlockBuildState"');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "MarketBarBlock"');
  const aggregationDatasetColumns = await prisma.$queryRawUnsafe('PRAGMA table_info("MarketDataset")');
  if (aggregationDatasetColumns.some((column) => column.name === "barBlockBuildCursor")) {
    await prisma.$executeRawUnsafe('ALTER TABLE "MarketDataset" DROP COLUMN "barBlockBuildCursor"');
  }
  const aggregationMigration = readFileSync(new URL("../../prisma/migrations/20261020120000_time_aggregation/migration.sql", import.meta.url), "utf8");
  for (const statement of aggregationMigration.split(";").map((s) => s.replace(/--[^\n]*/g, "").trim()).filter(Boolean)) {
    if (statement.startsWith("CREATE")) await prisma.$executeRawUnsafe(statement.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ").replace("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ").replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS "));
  }

  for (const statement of indexStatements) {
    await prisma.$executeRawUnsafe(statement);
  }
  console.log("SQLite database initialized.");
  const syncMigration = readFileSync(new URL("../../prisma/migrations/20261013090000_add_market_sync/migration.sql", import.meta.url), "utf8");
  const syncColumns = await prisma.$queryRawUnsafe('PRAGMA table_info("MarketDataset")');
  for (const statement of syncMigration.split(";").map((s) => s.trim()).filter(Boolean)) {
    if (statement.startsWith('ALTER TABLE "MarketDataset"') && syncColumns.some((column) => column.name === "historyVersion")) continue;
    await prisma.$executeRawUnsafe(statement);
  }
  const progressColumns = await prisma.$queryRawUnsafe('PRAGMA table_info("ReplayProgress")');
  if (!progressColumns.some((column) => column.name === "id")) {
    const replayMigration = readFileSync(new URL("../../prisma/migrations/20261013120000_add_replay_sessions/migration.sql", import.meta.url), "utf8");
    // SQL comments are removed before splitting; quoted strings in this migration
    // contain no semicolons. Run table redefinitions outside a Prisma transaction
    // so SQLite's foreign_keys pragma can actually take effect.
    const statements = replayMigration.replace(/^\s*--.*$/gm, "").split(";").map((s) => s.trim()).filter((statement) => statement && !statement.startsWith("PRAGMA"));
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys=OFF");
    try { await prisma.$transaction(statements.map((statement) => prisma.$executeRawUnsafe(statement)), { timeout: 120_000 }); }
    finally { await prisma.$executeRawUnsafe("PRAGMA foreign_keys=ON"); }
  }
  const cycleMigration = readFileSync(new URL("../../prisma/migrations/20261013130000_add_replay_cycles/migration.sql", import.meta.url), "utf8");
  const cycleColumns = await prisma.$queryRawUnsafe('PRAGMA table_info("PaperTradingSession")');
  if (!cycleColumns.some((column) => column.name === "activeCycleKey")) {
    await prisma.$transaction(cycleMigration.split(";").map((s) => s.trim()).filter(Boolean).map((statement) => prisma.$executeRawUnsafe(statement)));
  }
  const identityMigration = readFileSync(new URL("../../prisma/migrations/20261013140000_version_replay_record_ids/migration.sql", import.meta.url), "utf8");
  await prisma.$transaction(identityMigration.replace(/^\s*--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean).map((statement) => prisma.$executeRawUnsafe(statement)));
  const [reviewConstraint] = await prisma.$queryRawUnsafe(`SELECT sql FROM sqlite_master WHERE type='table' AND name='ReplayJournalEntry'`);
  if (!/CHECK\s*\(\s*length\s*\(\s*"review"\s*\)\s*<=\s*2000\s*\)/i.test(reviewConstraint.sql)) {
    const reviewMigration = readFileSync(new URL("../../prisma/migrations/20261013150000_preserve_replay_review_constraint/migration.sql", import.meta.url), "utf8");
    await prisma.$transaction(reviewMigration.replace(/^\s*--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean).map((statement) => prisma.$executeRawUnsafe(statement)));
  }
  const resultColumns = await prisma.$queryRawUnsafe('PRAGMA table_info("ReplayProjection")');
  if (resultColumns.some((column) => column.name === "generation")) {
    const resultMigration = readFileSync(new URL("../../prisma/migrations/20261014120000_keep_current_replay_result/migration.sql", import.meta.url), "utf8");
    await prisma.$transaction(resultMigration.replace(/^\s*--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean).map((statement) => prisma.$executeRawUnsafe(statement)), { timeout: 120_000 });
  }
  const gateMigration = readFileSync(new URL("../../prisma/migrations/20261014160000_add_training_gate/migration.sql", import.meta.url), "utf8");
  for (const statement of gateMigration.split(";").map((s) => s.trim()).filter(Boolean)) {
    const [, table, column] = statement.match(/ALTER TABLE "([^"\n]+)" ADD COLUMN "([^"\n]+)"/);
    const columns = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
    if (!columns.some((item) => item.name === column)) await prisma.$executeRawUnsafe(statement);
  }
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ReplayProjectionCommand_commandId_idx" ON "ReplayProjectionCommand"("commandId")');
  const aiMigration = ["20261015180000_add_ai_assistant", "20261016090000_add_ai_tool_execution", "20261016100000_add_ai_chart_variants"]
    .map((name) => readFileSync(new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8")).join("\n");
  for (const statement of aiMigration.replace(/^\s*--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) {
    if (statement.startsWith('ALTER TABLE "AiAsset"')) {
      const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("AiAsset")');
      if (columns.some((c) => c.name === "contentHash")) continue;
    }
    await prisma.$executeRawUnsafe(statement.replace(/^CREATE TABLE /, "CREATE TABLE IF NOT EXISTS ").replace(/^CREATE UNIQUE INDEX /, "CREATE UNIQUE INDEX IF NOT EXISTS ").replace(/^CREATE INDEX /, "CREATE INDEX IF NOT EXISTS "));
  }
  const propMigration = readFileSync(new URL("../../prisma/migrations/20261023120000_prop_practice/migration.sql", import.meta.url), "utf8");
  for (const statement of propMigration.replace(/^\s*--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean)) {
    if (statement.startsWith('ALTER TABLE "ReplaySession"')) {
      const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("ReplaySession")');
      if (columns.some(c => c.name === "accountCategory")) continue;
    }
    await prisma.$executeRawUnsafe(statement.replace(/^CREATE TABLE /, "CREATE TABLE IF NOT EXISTS ").replace(/^CREATE UNIQUE INDEX /, "CREATE UNIQUE INDEX IF NOT EXISTS ").replace(/^CREATE INDEX /, "CREATE INDEX IF NOT EXISTS "));
  }
  const roundColumns = await prisma.$queryRawUnsafe('PRAGMA table_info("PropPracticeAccount")');
  if (!roundColumns.some(c => c.name === "roundNumber")) {
    const rounds = readFileSync(new URL("../../prisma/migrations/20261024090000_prop_practice_rounds/migration.sql", import.meta.url), "utf8");
    await prisma.$transaction(rounds.split(";").map(s => s.trim()).filter(Boolean).map(s => prisma.$executeRawUnsafe(s)), { timeout: 120_000 });
  }
  const usersMigration = readFileSync(new URL("../../prisma/migrations/20261025120000_user_profiles/migration.sql", import.meta.url), "utf8");
  for (const statement of usersMigration.split(";").map(s => s.trim()).filter(Boolean)) {
    const column = statement.match(/^ALTER TABLE "ReplaySession" ADD COLUMN "([^"]+)"/);
    if (column) {
      const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("ReplaySession")');
      if (columns.some(c => c.name === column[1])) continue;
    }
    await prisma.$executeRawUnsafe(statement.replace(/^CREATE TABLE /, "CREATE TABLE IF NOT EXISTS ").replace(/^CREATE UNIQUE INDEX /, "CREATE UNIQUE INDEX IF NOT EXISTS ").replace(/^CREATE INDEX /, "CREATE INDEX IF NOT EXISTS "));
  }
  const walletMigration = readFileSync(new URL("../../prisma/migrations/20261026140000_user_wallet/migration.sql", import.meta.url), "utf8");
  for (const statement of walletMigration.replace(/^\s*--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement.replace(/^CREATE TABLE /, "CREATE TABLE IF NOT EXISTS ").replace(/^CREATE UNIQUE INDEX /, "CREATE UNIQUE INDEX IF NOT EXISTS ").replace(/^CREATE INDEX /, "CREATE INDEX IF NOT EXISTS "));
  }
  const cashColumns = await prisma.$queryRawUnsafe('PRAGMA table_info("PaperTradingSession")');
  if (!cashColumns.some(c => c.name === "cashAdjustment")) {
    await prisma.$executeRawUnsafe(readFileSync(new URL("../../prisma/migrations/20261026170000_user_wallet_transfers/migration.sql", import.meta.url), "utf8"));
  }
} finally {
  await prisma.$disconnect();
}
