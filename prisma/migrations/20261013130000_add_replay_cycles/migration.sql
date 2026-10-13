ALTER TABLE "PaperTradingSession" ADD COLUMN "activeCycleKey" TEXT;
ALTER TABLE "PaperFill" ADD COLUMN "cycleKey" TEXT;
ALTER TABLE "PaperOrder" ADD COLUMN "parentOrderId" TEXT;
ALTER TABLE "ReplayCorrectionJob" ADD COLUMN "requestId" TEXT;
CREATE INDEX IF NOT EXISTS "PaperFill_sessionId_cycleKey_idx" ON "PaperFill"("sessionId", "cycleKey");
CREATE UNIQUE INDEX IF NOT EXISTS "ReplayCorrectionJob_replaySessionId_requestId_key" ON "ReplayCorrectionJob"("replaySessionId", "requestId");
