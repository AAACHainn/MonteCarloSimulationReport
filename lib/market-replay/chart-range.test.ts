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
      expect(range).toEqual({ from: 1000 - expectedBars, to: 1003 });
    },
  );

  it("keeps the default candle density even with only one revealed bar", () => {
    expect(defaultReplayLogicalRange(1250, 1)).toEqual({ from: -249, to: 4 });
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

  it("preserves historical panning when a batch arrives", () => {
    const range = { from: 10, to: 200 };
    expect(rangeAfterNewReplayBar(range, 299, 10)).toEqual(range);
  });
});
