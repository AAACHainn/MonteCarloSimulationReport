import { describe, expect, it } from "vitest";
import { marketBarBlockSizeForMultiplier, mergeReplayHistory, nextHistoryEndSequence, replayHistoryPageSize } from "./history";
import type { AggregatedMarketBarData } from "./types";

function bar(sequence: number, sourceCount = 1): AggregatedMarketBarData {
  return {
    timestamp: new Date(sequence * 1_000).toISOString(), bucketEnd: new Date((sequence + 1) * 1_000).toISOString(),
    firstSequence: sequence, lastSequence: sequence + sourceCount - 1,
    open: sequence, high: sequence + 1, low: sequence - 1, close: sequence,
    volume: null, sourceCount, expectedCount: sourceCount, status: "COMPLETE",
  };
}

describe("replay history", () => {
  it("deduplicates buckets, prefers the most complete revision and separates warmup", () => {
    const partial = { ...bar(2), sourceCount: 1, expectedCount: 2, status: "FORMING" as const };
    const complete = { ...bar(2, 2), expectedCount: 2 };
    const result = mergeReplayHistory([[bar(0), bar(1), partial], [complete, bar(4)]], 1, 2);
    expect(result.warmupBars.map((item) => item.firstSequence)).toEqual([1]);
    expect(result.bars.map((item) => item.firstSequence)).toEqual([2, 4]);
    expect(result.bars[0].sourceCount).toBe(2);
  });

  it("caps adaptive pages by both displayed and estimated source bars", () => {
    expect(replayHistoryPageSize(60, 60)).toBe(2_000);
    expect(replayHistoryPageSize(1, 60)).toBe(416);
    expect(replayHistoryPageSize(1, 86_400)).toBe(1);
  });

  it("chooses a block level small enough to stay inside most display buckets", () => {
    expect(marketBarBlockSizeForMultiplier(60)).toBeNull();
    expect(marketBarBlockSizeForMultiplier(300)).toBe(64);
    expect(marketBarBlockSizeForMultiplier(3_600)).toBe(512);
    expect(marketBarBlockSizeForMultiplier(20_000)).toBe(4_096);
  });

  it("returns a backward cursor without crossing dataset start", () => {
    expect(nextHistoryEndSequence([bar(10)])).toBe(9);
    expect(nextHistoryEndSequence([bar(0)])).toBeNull();
  });
});
