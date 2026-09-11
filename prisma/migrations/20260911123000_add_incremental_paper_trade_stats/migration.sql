ALTER TABLE "PaperTradingSession" ADD COLUMN "tradeStatsVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PaperTradingSession" ADD COLUMN "closedTradeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaperTradingSession" ADD COLUMN "winningTradeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaperTradingSession" ADD COLUMN "losingTradeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaperTradingSession" ADD COLUMN "grossWinningPnl" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PaperTradingSession" ADD COLUMN "grossLosingPnl" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PaperTradingSession" ADD COLUMN "currentWinStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaperTradingSession" ADD COLUMN "currentLossStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaperTradingSession" ADD COLUMN "maxConsecutiveWins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaperTradingSession" ADD COLUMN "maxConsecutiveLosses" INTEGER NOT NULL DEFAULT 0;

-- Existing sessions need one lazy backfill; sessions created after this migration start current.
UPDATE "PaperTradingSession" SET "tradeStatsVersion" = 0;
