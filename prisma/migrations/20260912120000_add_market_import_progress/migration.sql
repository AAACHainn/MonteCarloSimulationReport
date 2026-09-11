ALTER TABLE "MarketDatasetImport" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'WAITING_UPLOAD';
ALTER TABLE "MarketDatasetImport" ADD COLUMN "stageProcessedBytes" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "MarketDatasetImport" ADD COLUMN "stageTotalBytes" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "MarketDatasetImport" ADD COLUMN "totalRows" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketDatasetImport" ADD COLUMN "stageStartedAt" DATETIME;
ALTER TABLE "MarketDatasetImport" ADD COLUMN "workerPid" INTEGER;
ALTER TABLE "MarketDatasetImport" ADD COLUMN "workerRssBytes" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "MarketDatasetImport" ADD COLUMN "peakWorkerRssBytes" BIGINT NOT NULL DEFAULT 0;
