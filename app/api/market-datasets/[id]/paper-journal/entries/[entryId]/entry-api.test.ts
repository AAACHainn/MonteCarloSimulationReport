import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entryFindFirst: vi.fn(),
  entryUpdate: vi.fn(),
  optionFindFirst: vi.fn(),
  reasonCount: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    replayJournalEntry: {
      findFirst: mocks.entryFindFirst,
      update: mocks.entryUpdate,
    },
    tradeOption: { findFirst: mocks.optionFindFirst },
    tradeReason: { count: mocks.reasonCount },
  },
}));

import { PATCH } from "./route";

const context = { params: Promise.resolve({ id: "dataset-1", entryId: "entry-1" }) };

function request(setupOptionId: string | null) {
  return new Request("http://localhost/api/entries/entry-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setupOptionId }),
  });
}

function record(setupOptionId: string | null, setupName: string | null) {
  return {
    id: "entry-1", no: 3, accountNo: 1, journalSessionId: "journal-1", lotId: "lot-1",
    direction: "LONG", quantity: 1, openedSequence: 0, openedAt: new Date("2026-09-01T00:00:00Z"),
    closedSequence: 1, closedAt: new Date("2026-09-01T00:01:00Z"), entryPrice: 100,
    entryOrderType: "LIMIT", exitPrice: 102, initialStopPrice: 99, abrValue: 2, abrLength: 8,
    displayIntervalSeconds: 300, displaySession: "ETH", displayUtcOffsetMinutes: 0,
    priceTickSize: 0.25, initialRisk: 1, actualRisk: 1, gainLoss: 2,
    review: "等待回踩确认后入场",
    setupOptionId, setupOption: setupName ? { name: setupName } : null,
    tradeReasons: [{ id: "reason-1", name: "趋势延续" }],
    journalSession: { archivedAt: new Date("2026-09-02T00:00:00Z") },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.entryFindFirst.mockResolvedValue({ id: "entry-1" });
  mocks.optionFindFirst.mockResolvedValue({ id: "setup-1" });
  mocks.reasonCount.mockResolvedValue(2);
  mocks.entryUpdate.mockResolvedValue(record("setup-1", "Opening Range Breakout"));
});

describe("replay journal Setup API", () => {
  it("assigns an active strategy to an archived or current journal entry", async () => {
    const response = await PATCH(request("setup-1"), context);
    expect(response.status).toBe(200);
    expect(mocks.entryFindFirst).toHaveBeenCalledWith({
      where: { id: "entry-1", journalSession: { datasetId: "dataset-1" } },
      select: { id: true },
    });
    expect(mocks.optionFindFirst).toHaveBeenCalledWith({
      where: { id: "setup-1", type: "STRATEGY", active: true },
      select: { id: true },
    });
    expect(mocks.entryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "entry-1" },
      data: { setupOptionId: "setup-1" },
    }));
    expect(await response.json()).toMatchObject({
      setupOptionId: "setup-1",
      setupOption: { name: "Opening Range Breakout" },
    });
  });

  it("clears an existing Setup without looking up an option", async () => {
    mocks.entryUpdate.mockResolvedValue(record(null, null));
    const response = await PATCH(request(null), context);
    expect(response.status).toBe(200);
    expect(mocks.optionFindFirst).not.toHaveBeenCalled();
    expect(mocks.entryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { setupOptionId: null },
    }));
    expect(await response.json()).toMatchObject({ setupOptionId: null, setupOption: null });
  });

  it("assigns multiple base-data trade reasons", async () => {
    const response = await PATCH(new Request("http://localhost/api/entries/entry-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradeReasonIds: ["reason-1", "reason-2"] }),
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.reasonCount).toHaveBeenCalledWith({ where: { id: { in: ["reason-1", "reason-2"] } } });
    expect(mocks.entryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { tradeReasons: { set: [{ id: "reason-1" }, { id: "reason-2" }] } },
      include: expect.objectContaining({
        tradeReasons: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      }),
    }));
  });

  it("rejects a missing trade reason", async () => {
    mocks.reasonCount.mockResolvedValue(1);
    const response = await PATCH(new Request("http://localhost/api/entries/entry-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradeReasonIds: ["reason-1", "missing"] }),
    }), context);
    expect(response.status).toBe(400);
    expect(mocks.entryUpdate).not.toHaveBeenCalled();
  });

  it("rejects an instrument, inactive strategy, or missing strategy", async () => {
    mocks.optionFindFirst.mockResolvedValue(null);
    const response = await PATCH(request("unavailable-option"), context);
    expect(response.status).toBe(400);
    expect(mocks.entryUpdate).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload before reading the database", async () => {
    const response = await PATCH(request(""), context);
    expect(response.status).toBe(400);
    expect(mocks.entryFindFirst).not.toHaveBeenCalled();
  });

  it("saves a review with at most 300 characters", async () => {
    const review = "复".repeat(300);
    mocks.entryUpdate.mockResolvedValue({ ...record("setup-1", "Opening Range Breakout"), review });
    const response = await PATCH(new Request("http://localhost/api/entries/entry-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.entryUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { review } }));
    expect(await response.json()).toMatchObject({ review });
  });

  it("rejects a review longer than 300 characters", async () => {
    const response = await PATCH(new Request("http://localhost/api/entries/entry-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review: "复".repeat(301) }),
    }), context);

    expect(response.status).toBe(400);
    expect(mocks.entryFindFirst).not.toHaveBeenCalled();
    expect(mocks.entryUpdate).not.toHaveBeenCalled();
  });

  it("does not update an entry outside the requested dataset", async () => {
    mocks.entryFindFirst.mockResolvedValue(null);
    const response = await PATCH(request("setup-1"), context);
    expect(response.status).toBe(404);
    expect(mocks.optionFindFirst).not.toHaveBeenCalled();
    expect(mocks.entryUpdate).not.toHaveBeenCalled();
  });
});
