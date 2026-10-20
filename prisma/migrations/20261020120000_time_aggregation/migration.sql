-- Derived summaries only. Raw MarketBar and replay/trading records are untouched.
DROP TABLE "MarketBarBlockBuildState";
DROP TABLE "MarketBarBlock";
ALTER TABLE "MarketDataset" DROP COLUMN "barBlockBuildCursor";
ALTER TABLE "MarketDataset" ADD COLUMN "activeAggregationId" TEXT;

-- CreateTable
CREATE TABLE "MarketAggregationGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "historyVersion" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT -1,
    "tailState" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'BUILDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketAggregationGeneration_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketAggregatedBar" (
    "generationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "intervalSeconds" INTEGER NOT NULL,
    "bucketStart" DATETIME NOT NULL,
    "bucketEnd" DATETIME NOT NULL,
    "firstSequence" INTEGER NOT NULL,
    "lastSequence" INTEGER NOT NULL,
    "firstTime" DATETIME NOT NULL,
    "lastTime" DATETIME NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL,
    "volumeCount" INTEGER NOT NULL,
    "sourceCount" INTEGER NOT NULL,
    "expectedCount" INTEGER NOT NULL,

    PRIMARY KEY ("generationId", "scope", "intervalSeconds", "bucketStart"),
    CONSTRAINT "MarketAggregatedBar_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "MarketAggregationGeneration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketAggregationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "activeDatasetId" TEXT,
    "generationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "targetSequence" INTEGER NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT -1,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "workerToken" TEXT,
    "leaseUntil" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketAggregationJob_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MarketAggregationJob_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "MarketAggregationGeneration" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MarketAggregationGeneration_datasetId_createdAt_idx" ON "MarketAggregationGeneration"("datasetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketAggregationJob_activeDatasetId_key" ON "MarketAggregationJob"("activeDatasetId");

-- CreateIndex
CREATE INDEX "MarketAggregationJob_datasetId_createdAt_idx" ON "MarketAggregationJob"("datasetId", "createdAt");
