CREATE TABLE "AiChartVariant" (
  "id" TEXT NOT NULL PRIMARY KEY, "contextId" TEXT NOT NULL, "value" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AiChartVariant_contextId_idx" ON "AiChartVariant"("contextId");
ALTER TABLE "AiAsset" ADD COLUMN "contentHash" TEXT;
