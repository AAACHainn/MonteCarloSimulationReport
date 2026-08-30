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
    "name" TEXT NOT NULL,
    "description" TEXT,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "sourceIntervalSeconds" INTEGER,
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
    "intervalMs" INTEGER NOT NULL,
    "playbackRate" INTEGER NOT NULL DEFAULT 1,
    "displayIntervalSeconds" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReplayProgress_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "PaperTradingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperTradingSession_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "PaperOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "quantity" REAL NOT NULL,
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
    PRIMARY KEY ("datasetId", "startSequence"),
    CONSTRAINT "MarketBarBlock_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "totalErrors" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT NOT NULL DEFAULT '[]',
    "metadata" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketDatasetImport_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
  ["sourceIntervalSeconds", "INTEGER"],
  ["sessionMode", "TEXT NOT NULL DEFAULT 'TWENTY_FOUR_SEVEN'"],
  ["sessionOpenMinute", "INTEGER"],
  ["sessionCloseMinute", "INTEGER"],
  ["tradingWeekdays", "TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7'"],
];
const replayProgressColumns = [["playbackRate", "INTEGER NOT NULL DEFAULT 1"], ["displayIntervalSeconds", "INTEGER"]];
const paperSessionColumns = [["equitySampleStride", "INTEGER NOT NULL DEFAULT 1"]];

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
  `CREATE INDEX IF NOT EXISTS "PaperTradingSession_datasetId_idx" ON "PaperTradingSession"("datasetId")`,
  `CREATE INDEX IF NOT EXISTS "PaperOrder_sessionId_status_idx" ON "PaperOrder"("sessionId", "status")`,
  `CREATE INDEX IF NOT EXISTS "PaperOrder_sessionId_createdSequence_idx" ON "PaperOrder"("sessionId", "createdSequence")`,
  `CREATE INDEX IF NOT EXISTS "PaperFill_sessionId_sequence_idx" ON "PaperFill"("sessionId", "sequence")`,
  `CREATE INDEX IF NOT EXISTS "PaperFill_orderId_idx" ON "PaperFill"("orderId")`,
  `CREATE INDEX IF NOT EXISTS "PaperTrade_sessionId_status_idx" ON "PaperTrade"("sessionId", "status")`,
  `CREATE INDEX IF NOT EXISTS "PaperTrade_sessionId_openedSequence_idx" ON "PaperTrade"("sessionId", "openedSequence")`,
  `CREATE INDEX IF NOT EXISTS "MarketBarBlock_datasetId_startTime_endTime_idx" ON "MarketBarBlock"("datasetId", "startTime", "endTime")`,
  `CREATE INDEX IF NOT EXISTS "MarketDatasetImport_status_createdAt_idx" ON "MarketDatasetImport"("status", "createdAt")`,
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

  for (const [table, columns] of [["MarketDataset", marketDatasetColumns], ["ReplayProgress", replayProgressColumns], ["PaperTradingSession", paperSessionColumns]]) {
    const existing = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
    const names = new Set(existing.map((column) => column.name));
    for (const [name, type] of columns) {
      if (!names.has(name)) await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${type}`);
    }
  }

  for (const statement of indexStatements) {
    await prisma.$executeRawUnsafe(statement);
  }
  console.log("SQLite database initialized.");
} finally {
  await prisma.$disconnect();
}
