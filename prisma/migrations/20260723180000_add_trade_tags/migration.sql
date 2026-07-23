CREATE TABLE "TradeTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "_TradeToTradeTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_TradeToTradeTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_TradeToTradeTag_B_fkey" FOREIGN KEY ("B") REFERENCES "TradeTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TradeTag_normalizedName_key" ON "TradeTag"("normalizedName");
CREATE INDEX "TradeTag_name_idx" ON "TradeTag"("name");
CREATE UNIQUE INDEX "_TradeToTradeTag_AB_unique" ON "_TradeToTradeTag"("A", "B");
CREATE INDEX "_TradeToTradeTag_B_index" ON "_TradeToTradeTag"("B");
