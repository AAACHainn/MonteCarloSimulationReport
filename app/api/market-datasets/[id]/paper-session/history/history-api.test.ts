import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  tradeFindMany: vi.fn(),
  journalFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    paperTradingSession: { findUnique: mocks.sessionFindUnique },
    paperTrade: { findMany: mocks.tradeFindMany },
    replayJournalEntry: { findMany: mocks.journalFindMany },
  },
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "dataset-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionFindUnique.mockResolvedValue({ id: "session-1", journalSessionId: "journal-1", initialCapital: 100_000 });
  mocks.tradeFindMany.mockResolvedValue([
    { grossPnl: 1_200, fees: 20 },
    { grossPnl: -500, fees: 10 },
    { grossPnl: 750, fees: 15 },
  ]);
});

describe("paper training equity history", () => {
  it("uses FIFO journal entries for training statistics and the curve", async () => {
    mocks.journalFindMany.mockResolvedValue([
      { gainLoss: 9, priceTickSize: 0.25, quantity: 2 },
      { gainLoss: -3.75, priceTickSize: 0.25, quantity: 4 },
      { gainLoss: 8.25, priceTickSize: 0.25, quantity: 0.5 },
    ]);
    const response = await GET(new Request("http://localhost/api/history?type=journal-stats"), context);

    expect(mocks.journalFindMany).toHaveBeenCalledWith({
      where: { journalSessionId: "journal-1" },
      orderBy: [{ accountNo: "asc" }, { id: "asc" }],
      select: { gainLoss: true, priceTickSize: true, quantity: true },
    });
    expect(mocks.tradeFindMany).not.toHaveBeenCalled();
    const stats = await response.json();
    expect(stats.winRate).toBeCloseTo(200 / 3);
    expect(stats).toMatchObject({
      tradeCount: 3,
      winningTradeCount: 2,
      losingTradeCount: 1,
      totalProfitPoints: 17.25,
      totalLossPoints: 3.75,
      actualProfitLossRatio: 4.6,
      averageWin: 11.0625,
      averageLoss: -15,
      pnlCurve: [
        { tradeNumber: 0, cumulativePnl: 0 },
        { tradeNumber: 1, cumulativePnl: 18 },
        { tradeNumber: 2, cumulativePnl: 3 },
        { tradeNumber: 3, cumulativePnl: 7.125 },
      ],
      averageWinPoints: 8.625,
      averageLossPoints: -3.75,
      maxConsecutiveWins: 1,
      maxConsecutiveLosses: 1,
      points: [
        { tradeNumber: 0, cumulativePoints: 0 },
        { tradeNumber: 1, cumulativePoints: 9 },
        { tradeNumber: 2, cumulativePoints: 5.25 },
        { tradeNumber: 3, cumulativePoints: 13.5 },
      ],
    });
  });
  it("returns realized equity indexed by completed trade number", async () => {
    const response = await GET(new Request("http://localhost/api/history?type=equity"), context);

    expect(response.status).toBe(200);
    expect(mocks.tradeFindMany).toHaveBeenCalledWith({
      where: { sessionId: "session-1", status: "CLOSED" },
      orderBy: [{ closedSequence: "asc" }, { closedAt: "asc" }, { id: "asc" }],
      select: { grossPnl: true, fees: true },
    });
    expect(await response.json()).toEqual({
      items: [
        { tradeNumber: 0, equity: 100_000 },
        { tradeNumber: 1, equity: 101_180 },
        { tradeNumber: 2, equity: 100_670 },
        { tradeNumber: 3, equity: 101_405 },
      ],
    });
  });

  it("returns no curve before the first completed trade", async () => {
    mocks.tradeFindMany.mockResolvedValue([]);
    const response = await GET(new Request("http://localhost/api/history?type=equity"), context);
    expect(await response.json()).toEqual({ items: [] });
  });
});
