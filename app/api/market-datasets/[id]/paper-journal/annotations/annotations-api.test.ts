import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  datasetFindUnique: vi.fn(),
  paperSessionFindUnique: vi.fn(),
  journalFindFirst: vi.fn(),
  journalFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    marketDataset: { findUnique: mocks.datasetFindUnique },
    paperTradingSession: { findUnique: mocks.paperSessionFindUnique },
    replayJournalEntry: {
      findFirst: mocks.journalFindFirst,
      findMany: mocks.journalFindMany,
    },
  },
}));

import { REPLAY_TRADE_ANNOTATION_LIMIT } from "@/lib/paper-trading/trade-annotations";
import { GET } from "./route";

const context = { params: Promise.resolve({ id: "dataset-1" }) };

function record(no: number) {
  return {
    id: `entry-${no}`,
    no,
    direction: no % 2 ? "LONG" : "SHORT",
    entryOrderType: no % 3 ? "LIMIT" : null,
    openedSequence: no,
    closedSequence: no + 1,
    entryPrice: 100,
    initialStopPrice: 95,
    actualRisk: 2,
    exitPrice: no % 2 ? 105 : 95,
    gainLoss: no % 2 ? 5 : -5,
    priceTickSize: 0.25,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.datasetFindUnique.mockResolvedValue({ id: "dataset-1" });
  mocks.paperSessionFindUnique.mockResolvedValue({ journalSessionId: "journal-current" });
  mocks.journalFindFirst.mockResolvedValue(null);
  mocks.journalFindMany.mockResolvedValue([]);
});

describe("replay trade annotation API", () => {
  it("requires a valid source range or journal number", async () => {
    const response = await GET(new Request("http://localhost/api/annotations"), context);
    expect(response.status).toBe(400);
    expect(mocks.datasetFindUnique).not.toHaveBeenCalled();
  });

  it("isolates range queries to the current journal session", async () => {
    mocks.journalFindMany.mockResolvedValue([record(4), record(3)]);
    const response = await GET(new Request(
      "http://localhost/api/annotations?fromSequence=10&toSequence=30",
    ), context);
    expect(response.status).toBe(200);
    expect(mocks.journalFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        journalSessionId: "journal-current",
        OR: [
          { openedSequence: { gte: 10, lte: 30 } },
          { closedSequence: { gte: 10, lte: 30 } },
        ],
      },
      orderBy: { no: "desc" },
      take: REPLAY_TRADE_ANNOTATION_LIMIT + 1,
    }));
    const body = await response.json();
    expect(body.items.map((item: { no: number }) => item.no)).toEqual([3, 4]);
    expect(body.truncated).toBe(false);
  });

  it("caps a dense window at one hundred newest trades", async () => {
    mocks.journalFindMany.mockResolvedValue(Array.from(
      { length: REPLAY_TRADE_ANNOTATION_LIMIT + 1 },
      (_, index) => record(REPLAY_TRADE_ANNOTATION_LIMIT + 1 - index),
    ));
    const response = await GET(new Request(
      "http://localhost/api/annotations?fromSequence=0&toSequence=500",
    ), context);
    const body = await response.json();
    expect(body.items).toHaveLength(REPLAY_TRADE_ANNOTATION_LIMIT);
    expect(body.items[0].no).toBe(2);
    expect(body.items.at(-1).no).toBe(101);
    expect(body.truncated).toBe(true);
  });

  it("loads one archived journal entry by dataset-wide number", async () => {
    mocks.journalFindFirst.mockResolvedValue(record(42));
    const response = await GET(new Request(
      "http://localhost/api/annotations?journalNo=42",
    ), context);
    expect(response.status).toBe(200);
    expect(mocks.journalFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { no: 42, journalSession: { datasetId: "dataset-1" } },
    }));
    expect(await response.json()).toMatchObject({
      items: [{ no: 42, entryOrderType: null, result: "L" }],
      truncated: false,
    });
  });
});
