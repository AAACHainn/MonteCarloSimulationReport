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

  for (const statement of indexStatements) {
    await prisma.$executeRawUnsafe(statement);
  }
  console.log("SQLite database initialized.");
} finally {
  await prisma.$disconnect();
}
