import { describe, expect, it } from "vitest";
import {
  defaultReplayLogicalRange,
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

describe("rangeAfterTimelineChange", () => {
  it("preserves the represented source span for every interval ratio", () => {
    const fiveMinute = aggregatedBars(120, 5, 5);
    const hourly = aggregatedBars(10, 60, 60);
    const mapped = rangeAfterTimelineChange({
      visibleRange: { from: 12, to: 108 },
      previousBars: fiveMinute,
      nextBars: hourly,
      previousDisplayIntervalSeconds: 300,
      nextDisplayIntervalSeconds: 3_600,
    });
    expect(mapped?.from).toBeCloseTo(1);
    expect(mapped?.to).toBeCloseTo(9);
  });

  it("keeps future whitespace proportional when switching to a higher interval", () => {
    const fiveMinute = aggregatedBars(120, 5, 5);
    const hourly = aggregatedBars(10, 60, 60);
    const mapped = rangeAfterTimelineChange({
      visibleRange: { from: 60, to: 180 },
      previousBars: fiveMinute,
      nextBars: hourly,
      previousDisplayIntervalSeconds: 300,
      nextDisplayIntervalSeconds: 3_600,
    });
    expect(mapped?.from).toBeCloseTo(5);
    expect(mapped?.to).toBeCloseTo(15);
  });

  it("preserves left-side whitespace and maps back from high to low intervals", () => {
    const fiveMinute = aggregatedBars(120, 5, 5);
    const hourly = aggregatedBars(10, 60, 60);
    const mapped = rangeAfterTimelineChange({
      visibleRange: { from: -2, to: 12 },
      previousBars: hourly,
      nextBars: fiveMinute,
      previousDisplayIntervalSeconds: 3_600,
      nextDisplayIntervalSeconds: 300,
    });
    expect(mapped?.from).toBeCloseTo(-24);
    expect(mapped?.to).toBeCloseTo(144);
  });
});
