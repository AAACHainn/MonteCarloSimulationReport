CREATE TABLE "AiRunStep" (
  "id" TEXT NOT NULL PRIMARY KEY, "runId" TEXT NOT NULL, "stepNo" INTEGER NOT NULL,
  "phase" TEXT NOT NULL, "status" TEXT NOT NULL, "adapterVersion" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL, "payload" TEXT NOT NULL DEFAULT '{}',
  "usage" TEXT NOT NULL DEFAULT '{"input":null,"output":null}', "durationMs" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AiRunStep_runId_stepNo_key" ON "AiRunStep"("runId", "stepNo");
CREATE TABLE "AiToolCall" (
  "id" TEXT NOT NULL PRIMARY KEY, "runId" TEXT NOT NULL, "stepNo" INTEGER NOT NULL,
  "toolCallId" TEXT NOT NULL, "toolIndex" INTEGER NOT NULL, "name" TEXT NOT NULL,
  "contractVersion" TEXT NOT NULL, "arguments" TEXT NOT NULL, "argumentsHash" TEXT NOT NULL,
  "scopeHash" TEXT NOT NULL, "status" TEXT NOT NULL, "result" TEXT NOT NULL DEFAULT '{}',
  "receipts" TEXT NOT NULL DEFAULT '[]', "durationMs" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AiToolCall_runId_toolCallId_key" ON "AiToolCall"("runId", "toolCallId");
CREATE INDEX "AiToolCall_runId_stepNo_toolIndex_idx" ON "AiToolCall"("runId", "stepNo", "toolIndex");
