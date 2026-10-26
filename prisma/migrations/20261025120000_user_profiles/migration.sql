CREATE TABLE "UserProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "nickname" TEXT NOT NULL,
  "avatar" TEXT NOT NULL DEFAULT 'DEFAULT',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "UserProfile_nickname_key" ON "UserProfile"("nickname");
ALTER TABLE "ReplaySession" ADD COLUMN "userId" TEXT REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplaySession" ADD COLUMN "growthEligible" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "ReplaySession_userId_createdAt_idx" ON "ReplaySession"("userId", "createdAt");
CREATE TABLE "UserGrowth" (
  "userId" TEXT NOT NULL PRIMARY KEY REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "totalXp" INTEGER NOT NULL DEFAULT 0,
  "completedCycles" INTEGER NOT NULL DEFAULT 0,
  "completedReviews" INTEGER NOT NULL DEFAULT 0,
  "passedEvaluations" INTEGER NOT NULL DEFAULT 0,
  "successfulPayouts" INTEGER NOT NULL DEFAULT 0,
  "receivedUsdtMinor" BIGINT NOT NULL DEFAULT 0,
  "realm" TEXT NOT NULL DEFAULT 'MORTAL',
  "layer" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "UserGrowthFact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "type" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "firstPayoutKey" TEXT,
  "sessionId" TEXT NOT NULL,
  "roundNumber" INTEGER,
  "sourceSummary" TEXT NOT NULL,
  "occurredAt" DATETIME NOT NULL,
  "settledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "xpDelta" INTEGER NOT NULL DEFAULT 0,
  "cyclesDelta" INTEGER NOT NULL DEFAULT 0,
  "reviewsDelta" INTEGER NOT NULL DEFAULT 0,
  "evaluationsDelta" INTEGER NOT NULL DEFAULT 0,
  "payoutsDelta" INTEGER NOT NULL DEFAULT 0,
  "receivedUsdtMinorDelta" BIGINT NOT NULL DEFAULT 0,
  "ruleVersion" TEXT NOT NULL
);
CREATE UNIQUE INDEX "UserGrowthFact_sourceKey_key" ON "UserGrowthFact"("sourceKey");
CREATE UNIQUE INDEX "UserGrowthFact_firstPayoutKey_key" ON "UserGrowthFact"("firstPayoutKey");
CREATE INDEX "UserGrowthFact_userId_settledAt_id_idx" ON "UserGrowthFact"("userId", "settledAt", "id");
CREATE TABLE "UserRealmRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fromRealm" TEXT NOT NULL,
  "toRealm" TEXT NOT NULL,
  "metricsSnapshot" TEXT NOT NULL,
  "ruleVersion" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "attainedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "UserRealmRecord_idempotencyKey_key" ON "UserRealmRecord"("idempotencyKey");
CREATE UNIQUE INDEX "UserRealmRecord_userId_toRealm_key" ON "UserRealmRecord"("userId", "toRealm");
