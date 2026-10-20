import { describe, expect, it } from "vitest";
import { aggregateTimeChunk, aggregationLayers, type AggregationDataset, type AggregationInput } from "./time-aggregation";
import { AggregationCalendar, getAggregationBucket, getAdjacentAggregationBucketStart } from "./aggregation";
import type { TradingSessionConfig } from "./types";

const dataset: AggregationDataset = { symbol: "ES", timeframe: "1m", sourceIntervalSeconds: 60, timezone: "UTC", sessionMode: "TWENTY_FOUR_SEVEN", sessionOpenMinute: null, sessionCloseMinute: null, tradingWeekdays: "1,2,3,4,5,6,7" };
function bars(start: string, count: number, step = 60000): AggregationInput[] {
  return Array.from({ length: count }, (_, sequence) => ({ sequence, timestamp: new Date(Date.parse(start) + sequence * step), open: sequence, high: sequence + 2, low: sequence - 1, close: sequence + 1, volume: sequence % 3 ? 1 : null }));
}
describe("time aggregation persistence rules", () => {
  it("has separate ETH/RTH hours and only ETH four-hour summaries", () => {
    expect(aggregationLayers(dataset).map((layer) => `${layer.scope}:${layer.seconds}`)).toEqual(["BASE:300", "BASE:900", "ETH:3600", "ETH:14400", "RTH:3600"]);
    expect(aggregationLayers({ ...dataset, sourceIntervalSeconds: 1 }).filter((layer) => layer.scope === "BASE").map((layer) => layer.seconds)).toEqual([60, 300, 900]);
    expect(aggregationLayers({ ...dataset, symbol: "BTC", sourceIntervalSeconds: 300 }).map((layer) => layer.scope)).not.toContain("RTH");
  });
  it("never persists shortened RTH hours or shortened ETH four-hour tails", () => {
    const result = aggregateTimeChunk(dataset, bars("2026-10-19T22:00:00Z", 23 * 60));
    const eth4h = result.completed.filter((bar) => bar.scope === "ETH" && bar.intervalSeconds === 14400);
    const rth1h = result.completed.filter((bar) => bar.scope === "RTH");
    expect(eth4h).toHaveLength(5); expect(rth1h).toHaveLength(6);
    expect(rth1h[0].bucketStart).toBe("2026-10-20T13:30:00.000Z");
    expect(result.completed.every((bar) => Date.parse(bar.bucketEnd) - Date.parse(bar.bucketStart) === bar.intervalSeconds * 1000)).toBe(true);
  });
  it("is invariant under checkpoint boundaries and retains missing/null-volume information", () => {
    const input = bars("2026-10-20T00:00:00Z", 120).filter((bar) => bar.sequence !== 2).map((bar, sequence) => ({ ...bar, sequence, volume: null }));
    const all = aggregateTimeChunk(dataset, input);
    const first = aggregateTimeChunk(dataset, input.slice(0, 37));
    const second = aggregateTimeChunk(dataset, input.slice(37), JSON.parse(JSON.stringify(first.tail)));
    expect([...first.completed, ...second.completed]).toEqual(all.completed);
    expect(second.tail).toEqual(all.tail);
    expect(all.completed.find((bar) => bar.scope === "BASE" && bar.intervalSeconds === 300)).toMatchObject({ sourceCount: 4, expectedCount: 5, volume: null });
  });
  it("applies the exchange timezone across DST rather than a fixed UTC offset", () => {
    const before = aggregateTimeChunk(dataset, bars("2026-10-30T13:30:00Z", 60)).completed.find((bar) => bar.scope === "RTH");
    const after = aggregateTimeChunk(dataset, bars("2026-11-02T14:30:00Z", 60)).completed.find((bar) => bar.scope === "RTH");
    expect(before?.bucketStart).toBe("2026-10-30T13:30:00.000Z");
    expect(after?.bucketStart).toBe("2026-11-02T14:30:00.000Z");
  });
  it("keeps a 25-hour DST trading day in a single daily bucket and calendar slot", () => {
    const session: TradingSessionConfig = { mode: "OVERNIGHT_SESSION", timezone: "America/New_York", openMinute: 17 * 60, closeMinute: 17 * 60, weekdays: [1, 2, 3, 4, 5, 6, 7] };
    const start = Date.parse("2026-10-31T21:00:00Z"), end = Date.parse("2026-11-01T22:00:00Z");
    expect(getAggregationBucket(end - 60000, 60, 86400, session)).toEqual({ start, end, expectedCount: 1500 });
    expect(getAdjacentAggregationBucketStart(start, 1, 86400, session)).toBe(end);
    const calendar = new AggregationCalendar(86400, session);
    expect(calendar.position(end - 60000, 1)).toBe(calendar.position(start, 1));
    expect(calendar.timestampAtOffset(start, 1)).toBe(end);
  });
});
