-- CreateTable
CREATE TABLE "PropPracticeTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PropPracticeTemplateVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PropPracticeTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PropPracticeTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PropPracticeAccount" (
    "replaySessionId" TEXT NOT NULL PRIMARY KEY,
    "templateVersionId" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    CONSTRAINT "PropPracticeAccount_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "ReplaySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PropPracticeAccount_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "PropPracticeTemplateVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PropPracticePayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "replaySessionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "received" REAL NOT NULL,
    "share" REAL NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PropPracticePayout_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "PropPracticeAccount" ("replaySessionId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PropPracticeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "replaySessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PropPracticeEvent_replaySessionId_fkey" FOREIGN KEY ("replaySessionId") REFERENCES "PropPracticeAccount" ("replaySessionId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Additive migration: retain the existing table and all referencing records.
ALTER TABLE "ReplaySession" ADD COLUMN "accountCategory" TEXT NOT NULL DEFAULT 'STANDARD';

-- CreateIndex
CREATE UNIQUE INDEX "PropPracticeTemplateVersion_templateId_version_key" ON "PropPracticeTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PropPracticePayout_replaySessionId_requestId_key" ON "PropPracticePayout"("replaySessionId", "requestId");

-- CreateIndex
CREATE INDEX "PropPracticeEvent_replaySessionId_createdAt_idx" ON "PropPracticeEvent"("replaySessionId", "createdAt");
