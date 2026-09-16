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
    reasonTags: [{ id: "tag-1", name: "趋势延续" }],
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
        reasonTags: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      },
    }));
    expect(await response.json()).toMatchObject({
      items: [{
        setupOptionId: "setup-1",
        setupOption: { name: "Opening Range Breakout" },
        reasonTags: [{ id: "tag-1", name: "趋势延续" }],
      }],
    });
  });

  it("defaults history to the latest session and paginates only that session", async () => {
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

    const response = await GET(new Request(
      "http://localhost/api/market-datasets/dataset-1/paper-journal?scope=history&page=2&take=20",
    ), context);

    expect(response.status).toBe(200);
    expect(mocks.entryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { journalSessionId: "journal-latest" },
      skip: 20,
      take: 20,
    }));
    const data = await response.json();
    expect(data).toMatchObject({
      selectedSessionId: "journal-latest",
      pagination: { page: 2, pageSize: 20, totalItems: 35, totalPages: 2 },
    });
    expect(data.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "journal-latest", name: "午盘训练", entryCount: 35 }),
    ]));
  });
});
