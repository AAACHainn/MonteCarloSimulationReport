CREATE TABLE "PaperTradingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "initialCapital" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "commissionBps" REAL NOT NULL DEFAULT 0,
    "slippageBps" REAL NOT NULL DEFAULT 0,
    "lastProcessedSequence" INTEGER NOT NULL,
    "netQuantity" REAL NOT NULL DEFAULT 0,
    "averageEntryPrice" REAL,
    "realizedPnl" REAL NOT NULL DEFAULT 0,
    "totalFees" REAL NOT NULL DEFAULT 0,
    "totalSlippage" REAL NOT NULL DEFAULT 0,
    "peakEquity" REAL NOT NULL,
    "maxDrawdown" REAL NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperTradingSession_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "PaperOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "quantity" REAL NOT NULL,
    "price" REAL,
    "stopLoss" REAL,
    "takeProfit" REAL,
    "reduceOnly" BOOLEAN NOT NULL DEFAULT false,
    "isProtective" BOOLEAN NOT NULL DEFAULT false,
    "ocoGroupId" TEXT,
    "createdSequence" INTEGER NOT NULL,
    "activeFromSequence" INTEGER NOT NULL,
    "filledSequence" INTEGER,
    "filledAt" DATETIME,
    "filledPrice" REAL,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperOrder_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaperTradingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "PaperFill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "side" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "quantity" REAL NOT NULL,
    "fee" REAL NOT NULL,
    "slippageCost" REAL NOT NULL,
    "realizedPnl" REAL NOT NULL,
    "closedQuantity" REAL NOT NULL,
    "openedQuantity" REAL NOT NULL,
    "netQuantityAfter" REAL NOT NULL,
    "averagePriceAfter" REAL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaperFill_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaperTradingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaperFill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PaperOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "PaperTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedSequence" INTEGER NOT NULL,
    "openedAt" DATETIME NOT NULL,
    "closedSequence" INTEGER,
    "closedAt" DATETIME,
    "grossPnl" REAL NOT NULL DEFAULT 0,
    "fees" REAL NOT NULL DEFAULT 0,
    "plannedRisk" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperTrade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaperTradingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "PaperEquityPoint" (
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "balance" REAL NOT NULL,
    "equity" REAL NOT NULL,
    "drawdown" REAL NOT NULL,
    PRIMARY KEY ("sessionId", "sequence"),
    CONSTRAINT "PaperEquityPoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaperTradingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaperTradingSession_datasetId_key" ON "PaperTradingSession"("datasetId");
CREATE INDEX "PaperTradingSession_datasetId_idx" ON "PaperTradingSession"("datasetId");
CREATE INDEX "PaperOrder_sessionId_status_idx" ON "PaperOrder"("sessionId", "status");
CREATE INDEX "PaperOrder_sessionId_createdSequence_idx" ON "PaperOrder"("sessionId", "createdSequence");
CREATE INDEX "PaperFill_sessionId_sequence_idx" ON "PaperFill"("sessionId", "sequence");
CREATE INDEX "PaperFill_orderId_idx" ON "PaperFill"("orderId");
CREATE INDEX "PaperTrade_sessionId_status_idx" ON "PaperTrade"("sessionId", "status");
CREATE INDEX "PaperTrade_sessionId_openedSequence_idx" ON "PaperTrade"("sessionId", "openedSequence");
