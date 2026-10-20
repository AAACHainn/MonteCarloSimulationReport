-- Source semantics only: existing raw candles, summaries and trading records are unchanged.
ALTER TABLE "MarketDataset" ADD COLUMN "barEmissionMode" TEXT NOT NULL DEFAULT 'UNKNOWN';
