ALTER TABLE "PropPracticeAccount" ADD COLUMN "roundNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PropPracticePayout" ADD COLUMN "roundNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PropPracticeEvent" ADD COLUMN "roundNumber" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "PropPracticeRound" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "replaySessionId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "projectionId" TEXT NOT NULL,
  "snapshot" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "trainingGate" TEXT NOT NULL DEFAULT '{}',
  "startSequence" INTEGER NOT NULL,
  "endSequence" INTEGER,
  "resetRequestId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" DATETIME,
  CONSTRAINT "PropPracticeRound_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "PropPracticeAccount" ("replaySessionId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PropPracticeRound_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "ReplayProjection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PropPracticeRound_projectionId_key" ON "PropPracticeRound"("projectionId");
CREATE UNIQUE INDEX "PropPracticeRound_replaySessionId_number_key" ON "PropPracticeRound"("replaySessionId", "number");
CREATE UNIQUE INDEX "PropPracticeRound_replaySessionId_resetRequestId_key" ON "PropPracticeRound"("replaySessionId", "resetRequestId");
INSERT INTO "PropPracticeRound" ("id","replaySessionId","number","projectionId","snapshot","state","trainingGate","startSequence","endSequence","createdAt","endedAt")
SELECT 'round_' || a."replaySessionId", a."replaySessionId", 1, s."activeProjectionId", a."snapshot", a."state", s."trainingGate", p."startSequence",
  CASE WHEN json_extract(a."state", '$.result') IS NOT NULL THEN p."currentSequence" ELSE NULL END,
  s."createdAt", CASE WHEN json_extract(a."state", '$.result') IS NOT NULL THEN s."updatedAt" ELSE NULL END
FROM "PropPracticeAccount" a JOIN "ReplaySession" s ON s."id"=a."replaySessionId" JOIN "ReplayProgress" p ON p."replaySessionId"=s."id";
