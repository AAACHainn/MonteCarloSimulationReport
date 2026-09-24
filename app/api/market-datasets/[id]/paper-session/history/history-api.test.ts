import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  tradeFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    paperTradingSession: { findUnique: mocks.sessionFindUnique },
    paperTrade: { findMany: mocks.tradeFindMany },
  },
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "dataset-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionFindUnique.mockResolvedValue({ id: "session-1", initialCapital: 100_000 });
  mocks.tradeFindMany.mockResolvedValue([
    { grossPnl: 1_200, fees: 20 },
    { grossPnl: -500, fees: 10 },
    { grossPnl: 750, fees: 15 },
  ]);
});

describe("paper training equity history", () => {
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
