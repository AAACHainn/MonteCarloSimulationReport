-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Trade" (
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
    "screenshotPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trade_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "TradeDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Trade_instrumentOptionId_fkey" FOREIGN KEY ("instrumentOptionId") REFERENCES "TradeOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Trade_strategyOptionId_fkey" FOREIGN KEY ("strategyOptionId") REFERENCES "TradeOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Trade" ("createdAt", "datasetId", "date", "direction", "id", "note", "pnl", "rMultiple", "riskAmount", "symbol", "updatedAt")
SELECT "createdAt", "datasetId", "date", "direction", "id", "note", "pnl", "rMultiple", "riskAmount", "symbol", "updatedAt" FROM "Trade";

DROP TABLE "Trade";
ALTER TABLE "new_Trade" RENAME TO "Trade";

CREATE TABLE "TradeJournal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "datasetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeJournal_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "TradeDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TradeOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "Trade_datasetId_idx" ON "Trade"("datasetId");
CREATE INDEX "Trade_instrumentOptionId_idx" ON "Trade"("instrumentOptionId");
CREATE INDEX "Trade_strategyOptionId_idx" ON "Trade"("strategyOptionId");
CREATE UNIQUE INDEX "TradeJournal_datasetId_key" ON "TradeJournal"("datasetId");
CREATE UNIQUE INDEX "TradeOption_type_name_key" ON "TradeOption"("type", "name");
CREATE INDEX "TradeOption_type_active_idx" ON "TradeOption"("type", "active");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
