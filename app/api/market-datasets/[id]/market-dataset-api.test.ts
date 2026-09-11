import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  datasetFindUnique: vi.fn(),
  datasetUpdate: vi.fn(),
  barFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    marketDataset: { findUnique: mocks.datasetFindUnique, update: mocks.datasetUpdate },
    marketBar: { findMany: mocks.barFindMany },
  },
}));

import { PATCH } from "./route";

const context = { params: Promise.resolve({ id: "dataset" }) };

function request(body: unknown) {
  return new Request("http://localhost/api/market-datasets/dataset", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dataset(overrides: Record<string, unknown> = {}) {
  return {
    id: "dataset",
    name: "MGC",
    description: null,
    symbol: "MGC",
    timeframe: "1s",
    timezone: "UTC",
    sourceIntervalSeconds: 1,
    priceTickSize: 0.1,
    sessionMode: "TWENTY_FOUR_SEVEN",
    sessionOpenMinute: null,
    sessionCloseMinute: null,
    tradingWeekdays: "1,2,3,4,5,6,7",
    barCount: 2,
    progress: { displayIntervalSeconds: 1 },
    ...overrides,
  };
}

describe("market dataset settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.datasetFindUnique.mockResolvedValue(dataset());
    mocks.datasetUpdate.mockResolvedValue({});
    mocks.barFindMany.mockResolvedValue([
      { timestamp: new Date("2021-09-12T22:00:00.000Z") },
      { timestamp: new Date("2021-09-12T22:01:00.000Z") },
    ]);
  });

  it("corrects the source interval and resets an incompatible display interval", async () => {
    const response = await PATCH(request({ sourceIntervalSeconds: 60, priceTickSize: 0.25 }), context);

    expect(response.status).toBe(200);
    expect(mocks.barFindMany).toHaveBeenCalledWith({
      where: { datasetId: "dataset", sequence: { gte: 0, lt: 10_000 } },
      select: { timestamp: true },
    });
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({
      where: { id: "dataset" },
      data: {
        sourceIntervalSeconds: 60,
        timeframe: "1m",
        priceTickSize: 0.25,
        dataVersion: { increment: 1 },
        progress: { update: {
          displayIntervalSeconds: 60,
          lastSyncRequestId: null,
          lastSyncResponse: null,
        } },
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      sourceIntervalSeconds: 60,
      timeframe: "1m",
      displayIntervalSeconds: 60,
    });
  });

  it("rejects a source interval that does not align with every timestamp", async () => {
    mocks.barFindMany.mockResolvedValueOnce([
      { timestamp: new Date("2021-09-12T22:00:30.000Z") },
    ]);

    const response = await PATCH(request({ sourceIntervalSeconds: 60, priceTickSize: 0.1 }), context);

    expect(response.status).toBe(400);
    expect(mocks.datasetUpdate).not.toHaveBeenCalled();
  });

  it("keeps price-only edits compatible without rescanning bars", async () => {
    const response = await PATCH(request({ priceTickSize: 0.25 }), context);

    expect(response.status).toBe(200);
    expect(mocks.barFindMany).not.toHaveBeenCalled();
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({
      where: { id: "dataset" },
      data: {
        sourceIntervalSeconds: 1,
        timeframe: "1s",
        priceTickSize: 0.25,
        dataVersion: undefined,
        progress: undefined,
      },
    });
  });
});
