import { describe, expect, it } from "vitest";
import {
  defaultReplayLogicalRange,
  captureReplayViewport, isReplayRangeFollowing, latestReplayLogicalIndex, rangeForReplayViewport,
  rangeAfterNewReplayBar,
  rangeAfterTimelineChange,
  rangeAfterWindowReplacement,
  rangeForReplayFocus,
} from "./chart-range";
import type { AggregatedMarketBarData } from "./types";

function aggregatedBars(count: number, minutes: number, sourcePerBar: number): AggregatedMarketBarData[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 9, index * minutes)).toISOString(),
    bucketEnd: new Date(Date.UTC(2026, 0, 1, 9, (index + 1) * minutes)).toISOString(),
    firstSequence: index * sourcePerBar,
    lastSequence: (index + 1) * sourcePerBar - 1,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: null,
    sourceCount: sourcePerBar,
    expectedCount: sourcePerBar,
    status: "COMPLETE",
  }));
}

describe("date navigation in the active chart", () => {
  it("only moves the viewport and retains both earlier and later loaded candles", () => {
    const bars = aggregatedBars(200, 5, 5);
    const before = structuredClone(bars);
    const range = rangeForReplayFocus(bars, 501, { from: 140, to: 240 });
    expect(range).toEqual({ from: 50, to: 150 });
    expect(bars).toEqual(before);
    expect(bars.at(-1)!.lastSequence).toBe(999);
  });

  it("preserves a wide chart's zoom instead of switching to a 60-candle close-up", () => {
    expect(rangeForReplayFocus(aggregatedBars(500, 5, 5), 1002, { from: 150, to: 453 }))
      .toEqual({ from: 48.5, to: 351.5 });
  });

  it("locates the next displayed candle when the target is in a filtered session gap", () => {
    const bars = aggregatedBars(3, 5, 5);
    bars[1] = { ...bars[1], firstSequence: 100, lastSequence: 104 };
    bars[2] = { ...bars[2], firstSequence: 105, lastSequence: 109 };
    expect(rangeForReplayFocus(bars, 50, { from: -1, to: 5 })).toEqual({ from: -2, to: 4 });
    expect(rangeForReplayFocus(bars, 110, { from: -1, to: 5 })).toEqual({ from: -1, to: 5 });
    expect(rangeForReplayFocus([], 50, null)).toBeNull();
  });
});

describe("rangeAfterNewReplayBar", () => {
  it("keeps the viewport fixed when the latest bar is around the middle", () => {
    expect(rangeAfterNewReplayBar({ from: 20, to: 120 }, 70)).toEqual({ from: 20, to: 120 });
  });

  it("moves one logical position when the user is following the right edge", () => {
    expect(rangeAfterNewReplayBar({ from: 20, to: 120 }, 116)).toEqual({ from: 21, to: 121 });
  });

  it("does not jump to realtime when the latest bar is outside the historical viewport", () => {
    expect(rangeAfterNewReplayBar({ from: 20, to: 80 }, 120)).toEqual({ from: 20, to: 80 });
  });
});

describe("defaultReplayLogicalRange", () => {
  it.each([[1000, 200], [1250, 250], [1500, 300], [2400, 300], [400, 80]])(
    "uses a readable default at %i CSS pixels",
    (width, expectedBars) => {
      const range = defaultReplayLogicalRange(width, 1000);
      const span = range.to - range.from;
      expect(span).toBeCloseTo(expectedBars + 3);
      expect((999 - range.from) / span).toBeCloseTo(0.618);
    },
  );

  it("keeps the default candle density even with only one revealed bar", () => {
    const range = defaultReplayLogicalRange(1250, 1);
    expect(range.to - range.from).toBeCloseTo(253);
    expect(-range.from / (range.to - range.from)).toBeCloseTo(0.618);
  });

  it("provides a valid range before the first revealed bar", () => {
    const range = defaultReplayLogicalRange(0, 0);
    expect(range.from).toBeLessThan(range.to);
    expect(Number.isFinite(range.from)).toBe(true);
  });

  it("continues following after a reset when a batch arrives in a rolling window", () => {
    const initial = defaultReplayLogicalRange(1250, 300);
    const advanced = rangeAfterNewReplayBar(initial, 299, 10);
    expect({ from: advanced.from - 10, to: advanced.to - 10 }).toEqual(initial);
  });

  it("keeps the latest bar at the reset position over successive advances", () => {
    let range = defaultReplayLogicalRange(1250, 300);
    let lastIndex = 299;
    for (const added of [1, 10, 1, 25]) {
      range = rangeAfterNewReplayBar(range, lastIndex, added);
      lastIndex += added;
      expect((lastIndex - range.from) / (range.to - range.from)).toBeCloseTo(0.618);
    }
  });

  it.each([-10, 10])("preserves manual panning by %i bars away from the reset position", (offset) => {
    const initial = defaultReplayLogicalRange(1250, 300);
    const panned = { from: initial.from + offset, to: initial.to + offset };
    expect(rangeAfterNewReplayBar(panned, 299, 10)).toEqual(panned);
  });

  it("preserves historical panning when a batch arrives", () => {
    const range = { from: 10, to: 200 };
    expect(rangeAfterNewReplayBar(range, 299, 10)).toEqual(range);
  });
});

describe("rangeAfterWindowReplacement", () => {
  it("preserves zoom and the latest bar position when a large window is replaced", () => {
    const range = { from: 1_100, to: 1_300 };
    const next = rangeAfterWindowReplacement(range, 1_299, 299);
    expect(next).toEqual({ from: 100, to: 300 });
    expect(next.to - next.from).toBe(range.to - range.from);
    expect(299 - next.from).toBe(1_299 - range.from);
  });

  it("preserves a manually panned range even when the old anchor is off screen", () => {
    const range = { from: 40, to: 90 };
    const next = rangeAfterWindowReplacement(range, 299, 99);
    expect(next).toEqual({ from: -160, to: -110 });
    expect(next.to - next.from).toBe(50);
  });

  it("preserves a fractional zoom span", () => {
    const range = { from: 12.25, to: 47.75 };
    const next = rangeAfterWindowReplacement(range, 59, 79);
    expect(next).toEqual({ from: 32.25, to: 67.75 });
  });
});

describe("display-period viewport transitions", () => {
  it.each([[1, 15], [15, 1], [5, 60], [60, 5]])("keeps candle density from %i minutes to %i minutes", (oldMinutes, newMinutes) => {
    const previous = aggregatedBars(360, oldMinutes, oldMinutes);
    const next = aggregatedBars(Math.ceil(360 * oldMinutes / newMinutes), newMinutes, newMinutes);
    const range = { from: 12, to: 108 };
    const mapped = rangeAfterTimelineChange({ visibleRange: range, previousBars: previous, nextBars: next,
      previousDisplayIntervalSeconds: oldMinutes * 60, nextDisplayIntervalSeconds: newMinutes * 60 });
    expect(mapped).not.toBeNull();
    expect(mapped!.to - mapped!.from).toBeCloseTo(96);
    // The original central real candle stays at the same screen position.
    const target = Math.floor(60 * oldMinutes / newMinutes);
    expect((target - mapped!.from + 0.5) / 97).toBeCloseTo(0.5);
  });

  it("keeps the live forming candle's centre at its original position", () => {
    const previous = aggregatedBars(300, 1, 1), next = aggregatedBars(20, 15, 15);
    const range = defaultReplayLogicalRange(1250, previous.length);
    const snapshot = captureReplayViewport({ visibleRange: range, bars: previous, sourceSequence: 299, liveWindow: true,
      chartWidth: 1250, barSpacing: 1250 / (range.to - range.from + 1) })!;
    expect(snapshot.mode).toBe("following");
    const mapped = rangeForReplayViewport(snapshot, next, 900, 1250)!;
    expect(mapped.to - mapped.from).toBeCloseTo(range.to - range.from);
    expect((19 - mapped.from + 0.5) / (mapped.to - mapped.from + 1)).toBeCloseTo(snapshot.position);
  });

  it("does not mistake a detached window's last candle for current replay progress", () => {
    const previous = aggregatedBars(300, 1, 1);
    expect(latestReplayLogicalIndex(previous, 1000, false)).toBe(-1);
    const snapshot = captureReplayViewport({ visibleRange: defaultReplayLogicalRange(1250, 300), bars: previous,
      sourceSequence: 1000, liveWindow: false, mode: "following" })!;
    expect(snapshot.mode).toBe("history");
    expect(snapshot.anchor.sourceSequence).toBeLessThan(300);
    // A verified live tail may precede the source cursor during an RTH gap.
    expect(latestReplayLogicalIndex(previous, 1000, true)).toBe(299);
  });

  it("keeps manual historical mode even if its anchor happens to resemble a following position", () => {
    const previous = aggregatedBars(300, 1, 1);
    const range = defaultReplayLogicalRange(1250, 300);
    const snapshot = captureReplayViewport({ visibleRange: range, bars: previous, sourceSequence: 299, liveWindow: true, mode: "history" })!;
    expect(snapshot.mode).toBe("history");
    expect(snapshot.anchor.sourceSequence).not.toBe(299);
    expect(isReplayRangeFollowing({ from: 20, to: 120 }, 70)).toBe(false);
    expect(isReplayRangeFollowing(range, 299)).toBe(true);
    expect(rangeAfterNewReplayBar(range, 299, 10, false)).toBe(range);
  });

  it("preserves pixel spacing if the available plot width changes", () => {
    const previous = aggregatedBars(300, 1, 1);
    const snapshot = captureReplayViewport({ visibleRange: { from: 150, to: 349 }, bars: previous,
      sourceSequence: 299, liveWindow: true, mode: "following", chartWidth: 1000, barSpacing: 5 })!;
    const mapped = rangeForReplayViewport(snapshot, aggregatedBars(20, 15, 15), 900, 1400)!;
    expect(1400 / (mapped.to - mapped.from + 1)).toBeCloseTo(5);
    expect((19 - mapped.from + 0.5) / (mapped.to - mapped.from + 1)).toBeCloseTo(snapshot.position);
  });

  it("maps filtered gaps to a real candle and never extrapolates outside the loaded window", () => {
    const next = aggregatedBars(3, 15, 15);
    next[1] = { ...next[1], firstSequence: 100, lastSequence: 114 };
    next[2] = { ...next[2], firstSequence: 115, lastSequence: 129 };
    const snapshot = { mode: "history" as const, anchor: { timestamp: next[0].timestamp, sourceSequence: 50 },
      position: 0.5, logicalSpan: 99, barSpacing: 5 };
    const mapped = rangeForReplayViewport(snapshot, next, 900)!;
    expect(mapped.from).toBe(-49.5); // preceding real candle is index zero
    expect(rangeForReplayViewport(snapshot, [], 900)).toBeNull();
    expect(captureReplayViewport({ visibleRange: null, bars: next, sourceSequence: 0, liveWindow: true })).toBeNull();
  });
});
