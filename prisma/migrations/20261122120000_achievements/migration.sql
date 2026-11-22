-- AlterTable
ALTER TABLE "PaperTrade" ADD COLUMN "exitReasonMask" INTEGER;
ALTER TABLE "UserGrowthFact" ADD COLUMN "achievementCaptureVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AchievementFact" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "growthFactId" TEXT NOT NULL,
    "exitReasonMask" INTEGER
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "achievementKey" TEXT NOT NULL,
    "tierKey" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "attainedAt" DATETIME,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "historical" BOOLEAN NOT NULL,
    "growthFactId" TEXT
);

-- CreateTable
CREATE TABLE "UserAchievementState" (
    "userId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "generation" TEXT NOT NULL DEFAULT 'live',
    "fingerprint" TEXT NOT NULL,
    "lastAppliedSeq" INTEGER NOT NULL DEFAULT 0,
    "historyChecked" BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY ("userId", "metricKey")
);

-- CreateTable
CREATE TABLE "UserAchievementProgress" (
    "userId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "generation" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "best" INTEGER NOT NULL DEFAULT 0,
    "coverageGaps" INTEGER NOT NULL DEFAULT 0,
    "milestones" TEXT NOT NULL DEFAULT '{}',

    PRIMARY KEY ("userId", "metricKey", "generation", "scopeKey")
);

-- CreateTable
CREATE TABLE "UserAchievementShowcase" (
    "userId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "achievementKey" TEXT NOT NULL,

    PRIMARY KEY ("userId", "slot")
);

-- CreateTable
CREATE TABLE "AchievementSyncState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "enabledAt" DATETIME,
    "lastAppliedSeq" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" DATETIME,
    "ownerToken" TEXT,
    "leaseUntil" DATETIME,
    "batchToken" TEXT,
    "liveFailures" INTEGER NOT NULL DEFAULT 0,
    "liveError" TEXT,
    "retryAt" DATETIME
);

-- CreateTable
CREATE TABLE "AchievementJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "metrics" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "phase" TEXT NOT NULL DEFAULT 'DISCOVER',
    "userWatermark" TEXT NOT NULL,
    "liveWatermark" INTEGER NOT NULL,
    "userCursor" TEXT NOT NULL DEFAULT '',
    "users" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "expectedAwards" INTEGER NOT NULL DEFAULT 0,
    "coverageGaps" INTEGER NOT NULL DEFAULT 0,
    "published" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "retryAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AchievementJobItem" (
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT NOT NULL DEFAULT 'TOTALS',
    "factCursor" TEXT NOT NULL DEFAULT '',
    "liveCursor" INTEGER NOT NULL DEFAULT 0,
    "retired" TEXT NOT NULL DEFAULT '{}',

    PRIMARY KEY ("jobId", "userId")
);

-- Index old and live evidence without changing the original fact rowids.
CREATE INDEX "UserGrowthFact_userId_achievementCaptureVersion_settledAt_id_idx" ON "UserGrowthFact"("userId", "achievementCaptureVersion", "settledAt", "id");
CREATE INDEX "UserGrowthFact_userId_achievementCaptureVersion_type_occurredAt_id_idx" ON "UserGrowthFact"("userId", "achievementCaptureVersion", "type", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AchievementFact_growthFactId_key" ON "AchievementFact"("growthFactId");

-- CreateIndex
CREATE INDEX "AchievementFact_userId_seq_idx" ON "AchievementFact"("userId", "seq");

-- CreateIndex
CREATE INDEX "UserAchievement_userId_seq_idx" ON "UserAchievement"("userId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_userId_achievementKey_tierKey_key" ON "UserAchievement"("userId", "achievementKey", "tierKey");

-- CreateIndex
CREATE INDEX "UserAchievementProgress_userId_metricKey_generation_current_idx" ON "UserAchievementProgress"("userId", "metricKey", "generation", "current");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievementShowcase_userId_achievementKey_key" ON "UserAchievementShowcase"("userId", "achievementKey");

-- CreateIndex
CREATE INDEX "AchievementJob_status_retryAt_idx" ON "AchievementJob"("status", "retryAt");

-- CreateIndex
CREATE INDEX "AchievementJob_createdAt_id_idx" ON "AchievementJob"("createdAt", "id");

-- CreateIndex
CREATE INDEX "AchievementJobItem_jobId_status_userId_idx" ON "AchievementJobItem"("jobId", "status", "userId");


INSERT INTO "AchievementSyncState" ("id") VALUES (1);
