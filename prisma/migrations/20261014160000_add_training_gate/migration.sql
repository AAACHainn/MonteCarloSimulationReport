ALTER TABLE "TradeOption" ADD COLUMN "checklist" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "TradeOption" ADD COLUMN "checklistVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ReplaySession" ADD COLUMN "trainingGate" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "PaperOrder" ADD COLUMN "discipline" TEXT;
ALTER TABLE "PaperPositionLot" ADD COLUMN "discipline" TEXT;
ALTER TABLE "PaperPositionLot" ADD COLUMN "entryNetPnl" REAL;
ALTER TABLE "ReplayJournalEntry" ADD COLUMN "discipline" TEXT;
