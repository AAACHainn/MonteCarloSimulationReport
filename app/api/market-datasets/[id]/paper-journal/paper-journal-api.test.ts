import { replayRouteBusinessScope } from "@/test-utils/replay-route-business-scope";
vi.mock("@/lib/replay-sessions/scope", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/replay-sessions/scope")>(), ...replayRouteBusinessScope,
  getReplayScope: mocks.getReplayScope,
}));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  datasetFindUnique: vi.fn(),
  paperSessionFindUnique: vi.fn(),
  entryFindMany: vi.fn(),
  journalSessionFindMany: vi.fn(),
  progressFindUnique: vi.fn(),
  marketBarFindUnique: vi.fn(),
  getReplayScope: vi.fn(),
  propRoundFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    marketDataset: { findUnique: mocks.datasetFindUnique },
    paperTradingSession: { findFirst: mocks.paperSessionFindUnique },
    replayJournalEntry: { findMany: mocks.entryFindMany },
    replayJournalSession: { findMany: mocks.journalSessionFindMany },
    replayProgress: { findUnique: mocks.progressFindUnique },
    marketBar: { findUnique: mocks.marketBarFindUnique },
    propPracticeRound: { findMany: mocks.propRoundFindMany },
  },
}));

import { GET } from "./route";
import { sumJournalDays } from "@/lib/paper-trading/journal-calendar";

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
  mocks.getReplayScope.mockReturnValue({ id: "replay-1" });
  mocks.datasetFindUnique.mockResolvedValue({ id: "dataset-1" });
  mocks.paperSessionFindUnique.mockResolvedValue({ journalSessionId: "journal-1" });
  mocks.entryFindMany.mockResolvedValue([record()]);
  mocks.journalSessionFindMany.mockResolvedValue([]);
});

describe("replay paper journal API", () => {
  it("includes closes after the display session ends in both calendars covering a cross-month week", async () => {
    const september = new Date("2026-09-01T14:00:00Z");
    const closeInBreak = new Date("2026-10-04T21:30:00Z");
    const nextTradingDay = new Date("2026-10-04T22:00:00Z");
    mocks.datasetFindUnique.mockResolvedValue({ id: "dataset-1", symbol: "ES", startTime: september });
    mocks.journalSessionFindMany.mockResolvedValue([{ id: "journal-1", currency: "USD" }]);
    mocks.progressFindUnique.mockResolvedValue({ startSequence: 4, currentSequence: 5 });
    mocks.marketBarFindUnique.mockImplementation(({ where }) => ({
      timestamp: where.datasetId_sequence.sequence === 4 ? september : nextTradingDay,
    }));
    mocks.entryFindMany.mockImplementation(({ where }) =>
      [{ ...record(), closedAt: closeInBreak }, { ...record(), no: 4, closedAt: nextTradingDay }]
        .filter(entry => entry.closedAt >= where.closedAt.gte && entry.closedAt < where.closedAt.lt));

    for (const month of ["2026-09", "2026-10"]) {
      const response = await GET(new Request(`http://localhost/api/market-datasets/dataset-1/paper-journal?view=calendar&month=${month}`), context);
      expect((await response.json()).days).toContainEqual(expect.objectContaining({
        date: "2026-10-04", firstTradeNo: 3, count: 1,
      }));
    }
  });

  it("limits an archived prop calendar to the same projection as the log unless all rounds are selected", async () => {
    const september = new Date("2026-09-01T14:00:00Z");
    const october = new Date("2026-10-01T14:00:00Z");
    const baseScope = { id: "replay-1", accountCategory: "PROP_PRACTICE", status: "ARCHIVED", projectionId: "final-round" };
    mocks.datasetFindUnique.mockResolvedValue({ id: "dataset-1", symbol: "ES", startTime: september });
    mocks.progressFindUnique.mockResolvedValue({ startSequence: 4, currentSequence: 8 });
    mocks.marketBarFindUnique.mockImplementation(({ where }) => ({
      timestamp: where.datasetId_sequence.sequence === 4 ? september : october,
    }));
    const finalRound = { startSequence: 6, endSequence: 8, projection: { currentSequence: 8 } };
    const url = "http://localhost/api/market-datasets/dataset-1/paper-journal?view=calendar&month=2026-09";

    mocks.getReplayScope.mockReturnValue(baseScope);
    mocks.propRoundFindMany.mockResolvedValueOnce([finalRound]);
    const current = await GET(new Request(url), context);
    expect(mocks.propRoundFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { replaySessionId: "replay-1", projectionId: "final-round" },
    }));
    expect(await current.json()).toMatchObject({ month: "2026-10", monthRange: { first: "2026-10", last: "2026-10" } });

    const projections = ["first-round", "final-round"];
    mocks.getReplayScope.mockReturnValue({ ...baseScope, propRoundNumber: 0, journalProjectionIds: projections });
    mocks.propRoundFindMany.mockResolvedValueOnce([{ startSequence: 4, endSequence: 5, projection: { currentSequence: 5 } }, finalRound]);
    const all = await GET(new Request(url), context);
    expect(mocks.propRoundFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { replaySessionId: "replay-1", projectionId: { in: projections } },
    }));
    expect(await all.json()).toMatchObject({ month: "2026-09", monthRange: { first: "2026-09", last: "2026-10" } });
  });

  it("includes cross-month trades and links each day to its earliest matching close", async () => {
    const first = new Date("2026-08-31T14:00:00Z");
    const second = new Date("2026-09-01T14:00:00Z");
    mocks.datasetFindUnique.mockResolvedValue({ id: "dataset-1", symbol: "ES", startTime: first });
    mocks.journalSessionFindMany.mockResolvedValue([{ id: "journal-1", currency: "USD" }]);
    mocks.progressFindUnique.mockResolvedValue({ startSequence: 4, currentSequence: 5 });
    mocks.marketBarFindUnique.mockImplementation(({ where }) => ({
      timestamp: where.datasetId_sequence.sequence === 4 ? first : second,
    }));
    mocks.entryFindMany.mockResolvedValue([
      { ...record(), no: 2, closedAt: first, direction: "SHORT" },
      { ...record(), closedAt: first, quantity: 3 },
      { ...record(), no: 1, closedAt: new Date(first.getTime() + 60_000), quantity: 1 },
      { ...record(), no: 4, closedAt: second, gainLoss: -2 },
      { ...record(), no: 5, closedAt: second, gainLoss: 0 },
    ]);
    const response = await GET(new Request("http://localhost/api/market-datasets/dataset-1/paper-journal?view=calendar&directions=LONG"), context);
    expect(response.status).toBe(200);
    const calendar = await response.json();
    expect(calendar.month).toBe("2026-09");
    expect(calendar.monthRange).toEqual({ first: "2026-08", last: "2026-09" });
    expect(calendar.journalSessionId).toBe("journal-1");
    expect(mocks.entryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ closedAt: "asc" }, { no: "asc" }],
    }));
    expect(calendar.days.slice(0, 3)).toEqual([
      { date: "2026-08-31", firstTradeNo: 3, count: 2, profit: 8, loss: 0, results: { W: 2, L: 0, BE: 0 } },
      { date: "2026-09-01", firstTradeNo: 4, count: 2, profit: 0, loss: -2, results: { W: 0, L: 1, BE: 1 } },
      { date: "2026-09-02", firstTradeNo: null, count: 0, profit: 0, loss: 0, results: { W: 0, L: 0, BE: 0 } },
    ]);
    expect(sumJournalDays(calendar.days.slice(0, 7))).toEqual({
      count: 4, profit: 8, loss: -2, results: { W: 2, L: 1, BE: 1 },
    });
    const future = await GET(new Request("http://localhost/api/market-datasets/dataset-1/paper-journal?view=calendar&month=2026-10"), context);
    expect((await future.json()).month).toBe("2026-09");
  });
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

  it.each(["YES", "NO"])("filters checklist use (%s) before statistics and pagination", async (selection) => {
    const discipline = JSON.stringify({
      strategyId: "setup-1", strategyName: "顺势交易", checklistVersion: 1,
      checklist: [{ id: "risk", text: "确认风险金额" }], confirmedAt: "2026-10-14T00:00:00.000Z",
    });
    mocks.journalSessionFindMany.mockResolvedValue([{
      id: "journal-1", name: "回放会话 1", replayGeneration: 1, initialCapital: 10_000,
      currency: "USD", archivedAt: null, createdAt: new Date("2026-09-16T12:00:00Z"),
      _count: { entries: 45 },
    }]);
    mocks.entryFindMany.mockResolvedValue(Array.from({ length: 45 }, (_, index) => ({
      ...record(), id: `entry-${index + 1}`, no: index + 1, accountNo: index + 1,
      discipline: index % 2 === 0 ? discipline : null,
      gainLoss: index % 2 === 0 ? 2 : -1,
    })));

    const response = await GET(new Request(
      `http://localhost/api/market-datasets/dataset-1/paper-journal?scope=history&checklistUsed=${selection}&page=2&take=10`,
    ), context);

    expect(response.status).toBe(200);
    const data = await response.json();
    const used = selection === "YES";
    const totalItems = used ? 23 : 22;
    expect(data.items).toHaveLength(10);
    expect(data.items[0].no).toBe(used ? 21 : 22);
    expect(data.items.every((item: { discipline: unknown }) => Boolean(item.discipline) === used)).toBe(true);
    expect(data.pagination).toEqual({ page: 2, pageSize: 10, totalItems, totalPages: 3 });
    expect(data.summary).toMatchObject({
      tradeCount: totalItems, winningTradeCount: used ? 23 : 0, losingTradeCount: used ? 0 : 22,
      totalProfitPoints: used ? 46 : 0, totalLossPoints: used ? 0 : 22,
    });
    expect(data.sessions[0].entryCount).toBe(45);
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
