import { describe, expect, it } from "vitest";
import { aggregateMarketBars, aggregateMarketSegments, getAggregationBucket, mergeAggregatedBars, mergeSourceBar } from "./aggregation";
import type { MarketBarData, TradingSessionConfig } from "./types";

const always: TradingSessionConfig = { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] };
const bar = (sequence: number, second: number, close = sequence + 1): MarketBarData => ({
  sequence, timestamp: new Date(second * 1_000).toISOString(), open: close - 0.5,
  high: close + 1, low: close - 1, close, volume: 2,
});

describe("market bar aggregation", () => {
  it("accepts integer multiples and rejects 5m to 9m", () => {
    expect(getAggregationBucket(0, 1, 540, always)).not.toBeNull();
    expect(getAggregationBucket(0, 300, 600, always)).not.toBeNull();
    expect(getAggregationBucket(0, 300, 540, always)).toBeNull();
  });

  it("updates an in-progress candle from source bars", () => {
    const result = aggregateMarketBars({ bars: [bar(0, 0), bar(1, 1, 4)], sourceSeconds: 1, displaySeconds: 5, session: always, currentSequence: 1, finalSequence: 99 });
    expect(result).toEqual([expect.objectContaining({ open: 0.5, high: 5, low: 0, close: 4, volume: 4, sourceCount: 2, expectedCount: 5, status: "FORMING" })]);
  });

  it("marks the current aggregate complete as soon as all source bars are revealed", () => {
    const result = aggregateMarketBars({
      bars: [bar(0, 0), bar(1, 1), bar(2, 2), bar(3, 3), bar(4, 4)],
      sourceSeconds: 1, displaySeconds: 5, session: always, currentSequence: 4, finalSequence: 99,
    });
    expect(result[0]).toMatchObject({ sourceCount: 5, expectedCount: 5, status: "COMPLETE" });
  });

  it("marks a closed candle with missing source bars incomplete", () => {
    const result = aggregateMarketBars({ bars: [bar(0, 0), bar(1, 2), bar(2, 5)], sourceSeconds: 1, displaySeconds: 5, session: always, currentSequence: 2, finalSequence: 99 });
    expect(result[0].status).toBe("INCOMPLETE");
    expect(result[1].status).toBe("FORMING");
  });

  it("aligns a daily session to its local open and shortens the final bucket", () => {
    const session: TradingSessionConfig = { mode: "DAILY_SESSION", timezone: "Asia/Shanghai", openMinute: 570, closeMinute: 960, weekdays: [1,2,3,4,5] };
    const timestamp = Date.parse("2026-08-28T07:45:00.000Z");
    const bucket = getAggregationBucket(timestamp, 300, 2_700, session);
    expect(new Date(bucket!.start).toISOString()).toBe("2026-08-28T07:30:00.000Z");
    expect(new Date(bucket!.end).toISOString()).toBe("2026-08-28T08:00:00.000Z");
    expect(bucket!.expectedCount).toBe(6);
  });

  it("combines a pre-aggregated source block without changing OHLCV or completeness", () => {
    const result = aggregateMarketSegments({
      segments: [{ firstSequence: 0, lastSequence: 4, timestamp: new Date(0).toISOString(), endTimestamp: new Date(4_000).toISOString(), open: 1, high: 6, low: 0, close: 5, volume: 10, sourceCount: 5 }],
      sourceSeconds: 1, displaySeconds: 5, session: always, currentSequence: 4, finalSequence: 4,
    });
    expect(result[0]).toMatchObject({ open: 1, high: 6, low: 0, close: 5, volume: 10, sourceCount: 5, status: "COMPLETE" });
  });

  it("aggregates a logical twenty-million-bar history from bounded summaries", () => {
    const secondsPerDay = 86_400;
    const dayCount = Math.ceil(20_000_000 / secondsPerDay);
    const segments = Array.from({ length: dayCount }, (_, day) => {
      const count = Math.min(secondsPerDay, 20_000_000 - day * secondsPerDay);
      return {
        firstSequence: day * secondsPerDay, lastSequence: day * secondsPerDay + count - 1,
        timestamp: new Date(day * secondsPerDay * 1_000).toISOString(),
        endTimestamp: new Date((day * secondsPerDay + count - 1) * 1_000).toISOString(),
        open: day, high: day + 2, low: day - 1, close: day + 1, volume: count, sourceCount: count,
      };
    });
    const result = aggregateMarketSegments({ segments, sourceSeconds: 1, displaySeconds: secondsPerDay, session: always, currentSequence: 19_999_999, finalSequence: 19_999_999 });
    expect(result).toHaveLength(dayCount);
    expect(result.slice(0, -1).every((item) => item.status === "COMPLETE")).toBe(true);
    expect(result.at(-1)?.status).toBe("INCOMPLETE");
  });
});

describe("incremental replay aggregation", () => {
  const options = { sourceSeconds: 1, displaySeconds: 5, session: always, finalSequence: 9 };
  it("replaces a partial bucket, remains immutable and ignores duplicate or older revisions", () => {
    const raw = Array.from({ length: 5 }, (_, i) => bar(i, i));
    const forming = aggregateMarketBars({ bars: raw.slice(0, 2), ...options, currentSequence: 1 });
    const complete = aggregateMarketBars({ bars: raw, ...options, currentSequence: 4 });
    const next = mergeAggregatedBars(forming, complete);
    expect(next).toEqual(complete);
    expect(forming[0].sourceCount).toBe(2);
    expect(mergeAggregatedBars(next, complete)).toEqual(complete);
    expect(mergeAggregatedBars(next, forming)).toEqual(complete);
  });
  it("closes a missing-data bucket when the next bucket arrives", () => {
    const forming = aggregateMarketBars({ bars: [bar(0, 0)], ...options, currentSequence: 0 });
    const following = aggregateMarketBars({ bars: [bar(1, 7)], ...options, currentSequence: 1 });
    const merged = mergeAggregatedBars(forming, following);
    expect(merged[0].status).toBe("INCOMPLETE");
    expect(forming[0].status).toBe("FORMING");
  });
  it("keeps single-source-period candles complete without mutating history", () => {
    const original = aggregateMarketBars({ bars: [bar(0, 0)], ...options, displaySeconds: 1, currentSequence: 0 });
    const next = mergeSourceBar(original, bar(1, 1), { ...options, displaySeconds: 1 });
    expect(next[1].status).toBe("COMPLETE");
    expect(original).toHaveLength(1);
  });
});
