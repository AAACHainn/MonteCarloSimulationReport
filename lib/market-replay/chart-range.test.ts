import { describe, expect, it } from "vitest";
import { defaultReplayLogicalRange, rangeAfterNewReplayBar } from "./chart-range";

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
