PRAGMA foreign_keys=OFF;

CREATE TABLE "new_MarketBarBlock" (
    "datasetId" TEXT NOT NULL,
    "blockSize" INTEGER NOT NULL DEFAULT 4096,
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
    PRIMARY KEY ("datasetId", "blockSize", "startSequence"),
    CONSTRAINT "MarketBarBlock_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_MarketBarBlock" (
    "datasetId", "blockSize", "startSequence", "endSequence", "startTime", "endTime",
    "open", "high", "low", "close", "volume", "volumeCount", "barCount"
)
SELECT
    "datasetId", 4096, "startSequence", "endSequence", "startTime", "endTime",
    "open", "high", "low", "close", "volume", "volumeCount", "barCount"
FROM "MarketBarBlock";

DROP TABLE "MarketBarBlock";
ALTER TABLE "new_MarketBarBlock" RENAME TO "MarketBarBlock";

CREATE INDEX "MarketBarBlock_datasetId_blockSize_startTime_endTime_idx"
ON "MarketBarBlock"("datasetId", "blockSize", "startTime", "endTime");

CREATE TABLE "MarketBarBlockBuildState" (
    "datasetId" TEXT NOT NULL,
    "blockSize" INTEGER NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT -1,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("datasetId", "blockSize"),
    CONSTRAINT "MarketBarBlockBuildState_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "MarketBarBlockBuildState" ("datasetId", "blockSize", "cursor", "updatedAt")
SELECT "id", 4096, "barBlockBuildCursor", CURRENT_TIMESTAMP
FROM "MarketDataset"
WHERE "barBlockBuildCursor" >= 0;

PRAGMA foreign_keys=ON;
