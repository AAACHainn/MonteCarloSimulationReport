import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  datasetFindUnique: vi.fn(),
  paperSessionFindUnique: vi.fn(),
  entryFindMany: vi.fn(),
  journalSessionFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    marketDataset: { findUnique: mocks.datasetFindUnique },
    paperTradingSession: { findUnique: mocks.paperSessionFindUnique },
    replayJournalEntry: { findMany: mocks.entryFindMany },
    replayJournalSession: { findMany: mocks.journalSessionFindMany },
  },
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "dataset-1" }) };

function record() {
  return {
    id: "entry-1", no: 3, accountNo: 1, journalSessionId: "journal-1", lotId: "lot-1",
    direction: "LONG", quantity: 1, openedSequence: 0, openedAt: new Date("2026-09-01T00:00:00Z"),
    closedSequence: 1, closedAt: new Date("2026-09-01T00:01:00Z"), entryPrice: 100,
    entryOrderType: "LIMIT", exitPrice: 102, initialStopPrice: 99, abrValue: 2, abrLength: 8,
    displayIntervalSeconds: 300, displaySession: "ETH", displayUtcOffsetMinutes: 0,
    priceTickSize: 0.25, initialRisk: 1, actualRisk: 1, gainLoss: 2,
    setupOptionId: "setup-1", setupOption: { name: "Opening Range Breakout" },
    tradeReasons: [{ id: "reason-1", name: "趋势延续" }],
    journalSession: { archivedAt: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.datasetFindUnique.mockResolvedValue({ id: "dataset-1" });
  mocks.paperSessionFindUnique.mockResolvedValue({ journalSessionId: "journal-1" });
  mocks.entryFindMany.mockResolvedValue([record()]);
  mocks.journalSessionFindMany.mockResolvedValue([]);
});

describe("replay paper journal API", () => {
  it("loads and serializes the Setup and trade-reason relations", async () => {
    const response = await GET(new Request(
      "http://localhost/api/market-datasets/dataset-1/paper-journal?scope=current",
    ), context);
    expect(response.status).toBe(200);
    expect(mocks.entryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        journalSession: { select: { archivedAt: true } },
        setupOption: { select: { name: true } },
        tradeReasons: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      },
    }));
    expect(await response.json()).toMatchObject({
      items: [{
        setupOptionId: "setup-1",
        setupOption: { name: "Opening Range Breakout" },
        tradeReasons: [{ id: "reason-1", name: "趋势延续" }],
      }],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    });
  });

  it("loads the current session once and paginates its full record set in code", async () => {
    mocks.entryFindMany.mockResolvedValue(Array.from({ length: 35 }, (_, index) => ({
      ...record(),
      id: `entry-${index + 1}`,
      no: index + 1,
      accountNo: index + 1,
    })));

    const response = await GET(new Request(
      "http://localhost/api/market-datasets/dataset-1/paper-journal?scope=current&page=2&take=20",
    ), context);

    expect(response.status).toBe(200);
    expect(mocks.entryFindMany).toHaveBeenCalledWith({
      where: { journalSessionId: "journal-1" },
      include: {
        journalSession: { select: { archivedAt: true } },
        setupOption: { select: { name: true } },
        tradeReasons: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      },
      orderBy: [{ accountNo: "asc" }, { id: "asc" }],
    });
    const data = await response.json();
    expect(data.pagination).toEqual({ page: 2, pageSize: 20, totalItems: 35, totalPages: 2 });
    expect(data.items).toHaveLength(15);
    expect(data.items[0]).toMatchObject({ id: "entry-21", no: 21 });
  });

  it("loads the latest session once and paginates its full record set in code", async () => {
    mocks.journalSessionFindMany.mockResolvedValue([
      {
        id: "journal-latest",
        name: "午盘训练",
        replayGeneration: 7,
        initialCapital: 10_000,
        currency: "USD",
        archivedAt: null,
        createdAt: new Date("2026-09-16T12:00:00Z"),
        _count: { entries: 35 },
      },
      {
        id: "journal-old",
        name: "回放会话 6",
        replayGeneration: 6,
        initialCapital: 10_000,
        currency: "USD",
        archivedAt: new Date("2026-09-15T12:00:00Z"),
        createdAt: new Date("2026-09-15T10:00:00Z"),
        _count: { entries: 5 },
      },
    ]);
    mocks.entryFindMany.mockResolvedValue(Array.from({ length: 35 }, (_, index) => ({
      ...record(),
      id: `entry-${index + 1}`,
      no: index + 1,
      accountNo: index + 1,
      journalSessionId: "journal-latest",
    })));

    const response = await GET(new Request(
      "http://localhost/api/market-datasets/dataset-1/paper-journal?scope=history&page=2&take=20",
    ), context);

    expect(response.status).toBe(200);
    expect(mocks.entryFindMany).toHaveBeenCalledWith({
      where: { journalSessionId: "journal-latest" },
      include: {
        journalSession: { select: { archivedAt: true } },
        setupOption: { select: { name: true } },
        tradeReasons: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      },
      orderBy: [{ accountNo: "asc" }, { id: "asc" }],
    });
    const data = await response.json();
    expect(data).toMatchObject({
      selectedSessionId: "journal-latest",
      summary: {
        tradeCount: 35,
        winningTradeCount: 35,
        losingTradeCount: 0,
        breakEvenTradeCount: 0,
        winRate: 100,
        totalProfitPoints: 70,
        totalLossPoints: 0,
        actualProfitLossRatio: null,
      },
      pagination: { page: 2, pageSize: 20, totalItems: 35, totalPages: 2 },
    });
    expect(data.items).toHaveLength(15);
    expect(data.items[0]).toMatchObject({ id: "entry-21", no: 21 });
    expect(data.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "journal-latest", name: "午盘训练", entryCount: 35 }),
    ]));
  });

  it("filters calculated columns before statistics and code pagination", async () => {
    mocks.journalSessionFindMany.mockResolvedValue([{
      id: "journal-1", name: "回放会话 1", replayGeneration: 1, initialCapital: 10_000,
      currency: "USD", archivedAt: null, createdAt: new Date("2026-09-16T12:00:00Z"),
      _count: { entries: 3 },
    }]);
    mocks.entryFindMany.mockResolvedValue([
      { ...record(), id: "winner-1", gainLoss: 2, actualRisk: 1 },
      { ...record(), id: "loser", gainLoss: -1, actualRisk: 1 },
      { ...record(), id: "winner-2", gainLoss: 4, actualRisk: 2 },
    ]);

    const response = await GET(new Request(
      "http://localhost/api/market-datasets/dataset-1/paper-journal?scope=history&actualRiskRr=%5B2%2C2%5D",
    ), context);

    expect(response.status).toBe(200);
    expect(mocks.entryFindMany).toHaveBeenCalledTimes(1);
    const data = await response.json();
    expect(data.items.map((item: { id: string }) => item.id)).toEqual(["winner-1", "winner-2"]);
    expect(data.summary).toEqual({
      tradeCount: 2,
      winningTradeCount: 2,
      losingTradeCount: 0,
      breakEvenTradeCount: 0,
      winRate: 100,
      totalProfitPoints: 6,
      totalLossPoints: 0,
      actualProfitLossRatio: null,
    });
    expect(data.pagination).toMatchObject({ totalItems: 2, totalPages: 1 });
    expect(data.sessions[0].entryCount).toBe(3);
    expect(data.filterOptions).toEqual({
      setups: [{ value: "setup-1", label: "Opening Range Breakout" }],
      hasEntriesWithoutSetup: false,
      tradeReasons: [{ value: "reason-1", label: "趋势延续" }],
      hasEntriesWithoutTradeReason: false,
    });
  });

  it("filters Direction, Setup, trade reason, and Result before statistics", async () => {
    mocks.journalSessionFindMany.mockResolvedValue([{
      id: "journal-1", name: "回放会话 1", replayGeneration: 1, initialCapital: 10_000,
      currency: "USD", archivedAt: null, createdAt: new Date("2026-09-16T12:00:00Z"),
      _count: { entries: 3 },
    }]);
    mocks.entryFindMany.mockResolvedValue([
      { ...record(), id: "long-with-setup", gainLoss: 2 },
      { ...record(), id: "short-loss", direction: "SHORT", gainLoss: -1 },
      { ...record(), id: "long-without-setup", gainLoss: 4, setupOptionId: null, setupOption: null, tradeReasons: [] },
    ]);

    const response = await GET(new Request(
      "http://localhost/api/market-datasets/dataset-1/paper-journal?scope=history"
      + "&directions=LONG&setupOptionIds=__NO_SETUP__&tradeReasonIds=__NO_TRADE_REASON__&results=W",
    ), context);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.items.map((item: { id: string }) => item.id)).toEqual(["long-without-setup"]);
    expect(data.summary).toMatchObject({ tradeCount: 1, winRate: 100, totalProfitPoints: 4, totalLossPoints: 0 });
    expect(data.pagination).toMatchObject({ totalItems: 1, totalPages: 1 });
    expect(data.filterOptions).toEqual({
      setups: [{ value: "setup-1", label: "Opening Range Breakout" }],
      hasEntriesWithoutSetup: true,
      tradeReasons: [{ value: "reason-1", label: "趋势延续" }],
      hasEntriesWithoutTradeReason: true,
    });
  });

  it("rejects invalid filter expressions", async () => {
    mocks.journalSessionFindMany.mockResolvedValue([{
      id: "journal-1", name: "回放会话 1", replayGeneration: 1, initialCapital: 10_000,
      currency: "USD", archivedAt: null, createdAt: new Date("2026-09-16T12:00:00Z"),
      _count: { entries: 1 },
    }]);

    const response = await GET(new Request(
      "http://localhost/api/market-datasets/dataset-1/paper-journal?scope=history&abrRr=p%3E",
    ), context);

    expect(response.status).toBe(400);
    expect(mocks.entryFindMany).not.toHaveBeenCalled();
  });
});
