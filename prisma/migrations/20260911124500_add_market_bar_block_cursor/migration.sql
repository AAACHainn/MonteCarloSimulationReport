ALTER TABLE "MarketDataset" ADD COLUMN "barBlockBuildCursor" INTEGER NOT NULL DEFAULT -1;

UPDATE "MarketDataset"
SET "barBlockBuildCursor" = COALESCE((
  SELECT MAX("endSequence")
  FROM "MarketBarBlock"
  WHERE "MarketBarBlock"."datasetId" = "MarketDataset"."id"
), -1);
