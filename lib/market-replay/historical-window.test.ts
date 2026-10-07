import { describe, expect, it } from "vitest";
import { mergeHistoricalBars } from "./historical-window";
import type { AggregatedMarketBarData } from "./types";

function bar(sequence: number, count = 5): AggregatedMarketBarData {
  return { timestamp: String(sequence), bucketEnd: String(sequence + 5), firstSequence: sequence,
    lastSequence: sequence + count - 1, sourceCount: count, expectedCount: 5,
    open: 10, high: 12, low: 9, close: 11, volume: null, status: count === 5 ? "COMPLETE" : "INCOMPLETE" };
}

describe("historical chart window extension", () => {
  it("supports extending both directions without duplicates or mutating the loaded window", () => {
    const current = [bar(5), bar(10)];
    const left = mergeHistoricalBars(current, [bar(0), bar(5)]);
    const both = mergeHistoricalBars(left, [bar(10), bar(15)]);
    expect(both.map((item) => item.firstSequence)).toEqual([0, 5, 10, 15]);
    expect(current.map((item) => item.firstSequence)).toEqual([5, 10]);
  });
  it("keeps the complete overlapping bucket when a boundary request returns a partial bucket", () => {
    expect(mergeHistoricalBars([bar(5)], [bar(5, 2)])).toEqual([bar(5)]);
    expect(mergeHistoricalBars([bar(5, 2)], [bar(5)])).toEqual([bar(5)]);
  });
  it("preserves source gaps instead of inventing candles", () => {
    expect(mergeHistoricalBars([bar(100)], [bar(0)]).map((item) => item.firstSequence)).toEqual([0, 100]);
  });
});
