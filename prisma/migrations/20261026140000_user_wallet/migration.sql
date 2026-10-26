CREATE TABLE "UserWallet" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "balanceMinor" BIGINT NOT NULL DEFAULT 1000000 CHECK ("balanceMinor" >= 0),
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "UserWalletEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "balanceAfterMinor" BIGINT NOT NULL,
  "sessionId" TEXT,
  "sessionName" TEXT NOT NULL DEFAULT '',
  "roundNumber" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserWalletEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserWalletEntry_sourceKey_key" ON "UserWalletEntry"("sourceKey");
CREATE INDEX "UserWalletEntry_userId_createdAt_id_idx" ON "UserWalletEntry"("userId", "createdAt", "id");
CREATE TABLE "UserWalletAllocation" (
  "projectionId" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "sessionName" TEXT NOT NULL,
  "depositedMinor" BIGINT NOT NULL,
  "withdrawnMinor" BIGINT NOT NULL DEFAULT 0,
  "settledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserWalletAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "UserWalletAllocation_userId_settledAt_createdAt_idx" ON "UserWalletAllocation"("userId", "settledAt", "createdAt");
CREATE INDEX "UserWalletAllocation_sessionId_idx" ON "UserWalletAllocation"("sessionId");
-- Existing profiles receive one opening balance. Source timestamps make copy rehearsal
-- and formal application deterministic; new profiles initialize in the application.
INSERT OR IGNORE INTO "UserWallet" ("userId", "updatedAt") SELECT "id", "createdAt" FROM "UserProfile";
INSERT OR IGNORE INTO "UserWalletEntry" ("id", "userId", "sourceKey", "type", "amountMinor", "balanceAfterMinor", "createdAt")
  SELECT 'wallet-initial:' || w."userId", w."userId", 'INITIAL:' || w."userId", 'INITIAL', 1000000, 1000000, u."createdAt"
  FROM "UserWallet" w JOIN "UserProfile" u ON u."id" = w."userId";
