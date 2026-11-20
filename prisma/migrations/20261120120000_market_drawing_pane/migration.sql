ALTER TABLE "MarketDrawing" ADD COLUMN "pane" INTEGER NOT NULL DEFAULT 1 CHECK ("pane" IN (1, 2, 3, 4, 5));
CREATE INDEX "MarketDrawing_datasetId_replaySessionId_pane_createdAt_idx" ON "MarketDrawing"("datasetId", "replaySessionId", "pane", "createdAt");
