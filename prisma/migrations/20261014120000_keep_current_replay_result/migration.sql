-- Keep the accepted result for every independent session, including archives.
-- An in-flight correction may also retain one temporary preview result.
CREATE INDEX "ReplayProjectionCommand_commandId_idx" ON "ReplayProjectionCommand"("commandId");
DELETE FROM "ReplayProjection"
WHERE "id" NOT IN (SELECT "activeProjectionId" FROM "ReplaySession" WHERE "activeProjectionId" IS NOT NULL)
  AND "id" NOT IN (
    SELECT j."targetProjectionId" FROM "ReplayCorrectionJob" j
    JOIN "ReplaySession" s ON s."pendingCorrectionId" = j."id" AND s."id" = j."replaySessionId"
    WHERE j."status" IN ('QUEUED', 'RUNNING', 'READY') AND j."targetProjectionId" IS NOT NULL
  );

DELETE FROM "ReplayCommand"
WHERE NOT EXISTS (SELECT 1 FROM "ReplayProjectionCommand" pc WHERE pc."commandId" = "ReplayCommand"."id");

UPDATE "ReplayCorrectionJob" SET "targetProjectionId" = NULL
WHERE "targetProjectionId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ReplayProjection" p WHERE p."id" = "ReplayCorrectionJob"."targetProjectionId");

DROP INDEX "ReplayProjection_replaySessionId_generation_idx";
ALTER TABLE "ReplayProjection" DROP COLUMN "generation";
ALTER TABLE "ReplayProjection" DROP COLUMN "parentId";
CREATE UNIQUE INDEX "ReplayProjection_replaySessionId_status_key" ON "ReplayProjection"("replaySessionId", "status");
