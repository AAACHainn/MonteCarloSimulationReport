import { describe, expect, it, vi } from "vitest";
import { MarketBarCache, marketChunkKey, selectFifoEvictions } from "./bar-cache";

describe("market bar cache metadata", () => {
  it("isolates dataset, version, symbol, interval and trading day", () => {
    const base = { datasetId: "a", dataVersion: 1, symbol: "BTC/USD", sourceIntervalSeconds: 1, tradingDay: "2026-09-06" };
    const keys = [
      marketChunkKey(base),
      marketChunkKey({ ...base, datasetId: "b" }),
      marketChunkKey({ ...base, dataVersion: 2 }),
      marketChunkKey({ ...base, symbol: "ETH/USD" }),
      marketChunkKey({ ...base, sourceIntervalSeconds: 60 }),
      marketChunkKey({ ...base, tradingDay: "2026-09-07" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("evicts by first write without treating reads as recency", () => {
    const records = [
      { key: "first", serializedBytes: 40, writtenAt: 1 },
      { key: "second", serializedBytes: 40, writtenAt: 2 },
      { key: "third", serializedBytes: 40, writtenAt: 3 },
    ];
    expect(selectFifoEvictions(records, 100)).toEqual(["first"]);
    expect(selectFifoEvictions(records, 80)).toEqual(["first", "second"]);
  });

  it("deduplicates overlapping loads and serves refreshes from memory", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      datasetId: "dataset",
      dataVersion: 2,
      symbol: "BTC",
      sourceIntervalSeconds: 1,
      requestStartDate: "2026-09-06",
      requestEndDate: "2026-09-06",
      coveredDates: ["2026-09-06"],
      chunks: [{
        tradingDay: "2026-09-06",
        rangeStart: "2026-09-06T00:00:00.000Z",
        rangeEnd: "2026-09-07T00:00:00.000Z",
        bars: [{ sequence: 1, timestamp: "2026-09-06T00:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: null }],
      }],
      nextStartDate: null,
    }), { status: 200 }));
    const cache = new MarketBarCache({
      id: "dataset", dataVersion: 2, symbol: "BTC", sourceIntervalSeconds: 1,
    }, fetcher as typeof fetch);
    const [first, overlapping] = await Promise.all([
      cache.loadRange("2026-09-06"),
      cache.loadRange("2026-09-06"),
    ]);
    const refresh = await cache.loadRange("2026-09-06");
    expect(await cache.getBarsAfter(1, 1, "2026-09-06")).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first.chunks[0].bars).toHaveLength(1);
    expect(overlapping.chunks[0].bars).toHaveLength(1);
    expect(refresh.cacheHit).toBe(true);
  });

  it("invokes the browser fetcher with the global receiver", async () => {
    const fetcher = vi.fn(function (this: unknown) {
      return Promise.resolve(new Response(JSON.stringify({
        datasetId: "receiver", dataVersion: 1, symbol: "MES", sourceIntervalSeconds: 1,
        requestStartDate: "2026-09-06", requestEndDate: "2026-09-06", coveredDates: ["2026-09-06"],
        chunks: [{
          tradingDay: "2026-09-06",
          rangeStart: "2026-09-06T00:00:00.000Z",
          rangeEnd: "2026-09-07T00:00:00.000Z",
          bars: [],
        }],
        nextStartDate: null,
      }), { status: 200 }));
    });
    const cache = new MarketBarCache({
      id: "receiver", dataVersion: 1, symbol: "MES", sourceIntervalSeconds: 1,
    }, fetcher as typeof fetch);

    await cache.loadRange("2026-09-06");

    expect(fetcher.mock.instances[0]).toBe(globalThis);
  });

  it("stores empty weekly dates as covered chunks", async () => {
    const dates = ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"];
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      datasetId: "weekly", dataVersion: 1, symbol: "ES", sourceIntervalSeconds: 300,
      requestStartDate: dates[0], requestEndDate: dates.at(-1), coveredDates: dates,
      chunks: dates.map((tradingDay) => ({
        tradingDay,
        rangeStart: `${tradingDay}T00:00:00.000Z`,
        rangeEnd: `${tradingDay}T23:59:59.999Z`,
        bars: [],
      })),
      nextStartDate: null,
    }), { status: 200 }));
    const cache = new MarketBarCache({
      id: "weekly", dataVersion: 1, symbol: "ES", sourceIntervalSeconds: 300,
    }, fetcher as typeof fetch);
    const result = await cache.loadRange(dates[0]);
    expect(result.chunks).toHaveLength(7);
    expect(result.chunks.every((chunk) => chunk.bars.length === 0)).toBe(true);
    await cache.loadRange(dates[0]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("requests only uncovered dates when weekly ranges overlap", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const startDate = url.searchParams.get("startDate")!;
      const dates = url.searchParams.get("dates")!.split(",");
      await Promise.resolve();
      return new Response(JSON.stringify({
        datasetId: "overlap", dataVersion: 1, symbol: "NQ", sourceIntervalSeconds: 300,
        requestStartDate: startDate, requestEndDate: dates.at(-1), coveredDates: dates,
        chunks: dates.map((tradingDay) => ({
          tradingDay,
          rangeStart: `${tradingDay}T00:00:00.000Z`,
          rangeEnd: `${tradingDay}T23:59:59.999Z`,
          bars: [],
        })),
        nextStartDate: null,
      }), { status: 200 });
    });
    const cache = new MarketBarCache({
      id: "overlap", dataVersion: 1, symbol: "NQ", sourceIntervalSeconds: 300,
    }, fetcher as typeof fetch);
    await Promise.all([
      cache.loadRange("2026-09-01"),
      cache.loadRange("2026-09-02"),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const requested = fetcher.mock.calls.map(([input]) => new URL(String(input), "http://localhost").searchParams.get("dates"));
    expect(requested).toContain("2026-09-01,2026-09-02,2026-09-03,2026-09-04,2026-09-05,2026-09-06,2026-09-07");
    expect(requested).toContain("2026-09-08");
  });

  it("returns only the contiguous prefix when cached chunks have a sequence gap", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const startDate = url.searchParams.get("startDate")!;
      const sequence = startDate === "2026-09-01" ? 0 : 2;
      const dates = Array.from({ length: 7 }, (_value, index) => {
        const day = Number(startDate.slice(-2)) + index;
        return `2026-09-${String(day).padStart(2, "0")}`;
      });
      return new Response(JSON.stringify({
        datasetId: "gapped", dataVersion: 1, symbol: "ES", sourceIntervalSeconds: 300,
        requestStartDate: startDate, requestEndDate: dates.at(-1), coveredDates: dates,
        chunks: dates.map((tradingDay, index) => ({
          tradingDay, rangeStart: `${tradingDay}T00:00:00.000Z`, rangeEnd: `${tradingDay}T23:59:59.999Z`,
          bars: index === 0 ? [{ sequence, timestamp: `${tradingDay}T00:00:00.000Z`, open: 1, high: 1, low: 1, close: 1, volume: null }] : [],
        })),
        nextStartDate: null,
      }));
    });
    const cache = new MarketBarCache({
      id: "gapped", dataVersion: 1, symbol: "ES", sourceIntervalSeconds: 300,
    }, fetcher as typeof fetch);
    await cache.loadRange("2026-09-01");
    await cache.loadRange("2026-09-08");

    expect(cache.readMemoryBarsAfter(-1, 10).map((bar) => bar.sequence)).toEqual([0]);
    expect(cache.readMemoryBarsAfter(1, 10).map((bar) => bar.sequence)).toEqual([2]);
  });
});
