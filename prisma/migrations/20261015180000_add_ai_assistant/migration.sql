-- CreateTable
CREATE TABLE "AiSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "activeRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "runId" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "content" TEXT NOT NULL,
    "result" TEXT,
    "contextId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiContext" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AiAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "contextId" TEXT,
    "chartHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "contextId" TEXT,
    "task" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "snapshot" TEXT NOT NULL,
    "checkpoint" TEXT NOT NULL DEFAULT '[]',
    "calls" INTEGER NOT NULL DEFAULT 0,
    "usage" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "heartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "replaySessionId" TEXT NOT NULL,
    "projectionId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AiReviewRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "replaySessionId" TEXT NOT NULL,
    "logicalKey" TEXT NOT NULL,
    "projectionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AiConversation_activeRunId_key" ON "AiConversation"("activeRunId");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_id_idx" ON "AiMessage"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AiRun_conversationId_createdAt_idx" ON "AiRun"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_status_heartbeatAt_idx" ON "AiRun"("status", "heartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalysis_runId_key" ON "AiAnalysis"("runId");

-- CreateIndex
CREATE INDEX "AiAnalysis_replaySessionId_createdAt_idx" ON "AiAnalysis"("replaySessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AiReviewRevision_replaySessionId_logicalKey_createdAt_idx" ON "AiReviewRevision"("replaySessionId", "logicalKey", "createdAt");
