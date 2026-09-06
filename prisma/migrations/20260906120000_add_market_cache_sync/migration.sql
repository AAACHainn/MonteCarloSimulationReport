ALTER TABLE "MarketDataset" ADD COLUMN "dataVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MarketDataset" ADD COLUMN "replayGeneration" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ReplayProgress" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ReplayProgress" ADD COLUMN "syncVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReplayProgress" ADD COLUMN "lastSyncRequestId" TEXT;
ALTER TABLE "ReplayProgress" ADD COLUMN "lastSyncResponse" TEXT;
