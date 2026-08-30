ALTER TABLE "MarketDataset" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'READY';
ALTER TABLE "MarketDataset" ADD COLUMN "sourceIntervalSeconds" INTEGER;
ALTER TABLE "MarketDataset" ADD COLUMN "sessionMode" TEXT NOT NULL DEFAULT 'TWENTY_FOUR_SEVEN';
ALTER TABLE "MarketDataset" ADD COLUMN "sessionOpenMinute" INTEGER;
ALTER TABLE "MarketDataset" ADD COLUMN "sessionCloseMinute" INTEGER;
ALTER TABLE "MarketDataset" ADD COLUMN "tradingWeekdays" TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7';

ALTER TABLE "ReplayProgress" ADD COLUMN "playbackRate" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ReplayProgress" ADD COLUMN "displayIntervalSeconds" INTEGER;
ALTER TABLE "PaperTradingSession" ADD COLUMN "equitySampleStride" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "MarketBarBlock" (
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
);

CREATE TABLE "MarketDatasetImport" (
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
);

CREATE INDEX "MarketBarBlock_datasetId_startTime_endTime_idx" ON "MarketBarBlock"("datasetId", "startTime", "endTime");
CREATE INDEX "MarketDatasetImport_status_createdAt_idx" ON "MarketDatasetImport"("status", "createdAt");
