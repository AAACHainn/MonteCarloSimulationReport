ALTER TABLE "MarketDataset" ADD COLUMN "historyVersion" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS "MarketDataConnection" (
 "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'databento', "encryptedKey" TEXT NOT NULL, "keySuffix" TEXT NOT NULL,
 "keyVersion" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'UNTESTED', "testedAt" DATETIME, "error" TEXT, "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "MarketDatasetSyncConfig" (
 "datasetId" TEXT NOT NULL PRIMARY KEY, "mode" TEXT NOT NULL DEFAULT 'OFF', "profile" TEXT NOT NULL, "schedule" TEXT NOT NULL,
 "perRunBudget" REAL NOT NULL DEFAULT 0, "dailyBudget" REAL NOT NULL DEFAULT 0, "checkedThrough" DATETIME,
 "verified" BOOLEAN NOT NULL DEFAULT false, "nextRunAt" DATETIME, "lastCheckedAt" DATETIME, "availableThrough" DATETIME,
 "pausedReason" TEXT, "leaseOwner" TEXT, "leaseUntil" DATETIME, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY ("datasetId") REFERENCES "MarketDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "MarketDataSyncRun" (
 "id" TEXT NOT NULL PRIMARY KEY, "datasetId" TEXT NOT NULL, "trigger" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED',
 "stage" TEXT NOT NULL DEFAULT 'CHECKING', "configSnapshot" TEXT NOT NULL, "requestStart" DATETIME, "requestEnd" DATETIME, "cursor" DATETIME,
 "addedBars" INTEGER NOT NULL DEFAULT 0, "estimatedCost" REAL NOT NULL DEFAULT 0, "charges" TEXT NOT NULL DEFAULT '[]',
 "mappings" TEXT NOT NULL DEFAULT '{}', "conflicts" TEXT NOT NULL DEFAULT '[]', "error" TEXT, "leaseOwner" TEXT, "leaseUntil" DATETIME,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY ("datasetId") REFERENCES "MarketDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "MarketDataSyncRun_status_createdAt_idx" ON "MarketDataSyncRun"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketDataSyncRun_datasetId_createdAt_idx" ON "MarketDataSyncRun"("datasetId", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketDataSyncRun_datasetId_updatedAt_idx" ON "MarketDataSyncRun"("datasetId", "updatedAt");
CREATE INDEX IF NOT EXISTS "MarketDatasetSyncConfig_mode_nextRunAt_idx" ON "MarketDatasetSyncConfig"("mode", "nextRunAt");
CREATE TABLE IF NOT EXISTS "MarketDatasetUpdateLease" ("datasetId" TEXT NOT NULL PRIMARY KEY, "owner" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL);
CREATE TABLE IF NOT EXISTS "MarketSyncSchedulerLease" ("id" TEXT NOT NULL PRIMARY KEY, "owner" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL, "heartbeat" DATETIME NOT NULL);
