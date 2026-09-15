import { describe, expect, it } from "vitest";
import { calculateAbrSeries, calculateLatestAbr } from "./abr";

const bars = [
  { high: 12, low: 10 },
  { high: 15, low: 11 },
  { high: 13, low: 7 },
  { high: 20, low: 12 },
];

describe("ABR", () => {
  it("calculates the latest value across warmup and visible arrays", () => {
    expect(calculateLatestAbr(
      [{ high: 3, low: 1 }],
      [{ high: 8, low: 4 }, { high: 9, low: 3 }],
      3,
    )).toBe(4);
    expect(calculateLatestAbr([], [{ high: 2, low: 1 }], 2)).toBeNull();
  });

  it("averages the ranges of the latest N bars including the current bar", () => {
    expect(calculateAbrSeries(bars, 3, 3)).toEqual({
      points: [
        { sequence: 2, value: 4 },
        { sequence: 3, value: 6 },
      ],
      lastValue: 6,
    });
  });

  it("uses the absolute high-low difference", () => {
    expect(calculateAbrSeries([{ high: 5, low: 8 }], 1, 0).lastValue).toBe(3);
  });

  it("does not return a value before enough bars are available", () => {
    expect(calculateAbrSeries(bars, 3, 1)).toEqual({ points: [], lastValue: null });
  });

  it("uses warmup bars while filtering values before the visible range", () => {
    expect(calculateAbrSeries(bars, 3, 3, 3)).toEqual({
      points: [{ sequence: 3, value: 6 }],
      lastValue: 6,
    });
  });

  it("never reads bars after the requested sequence", () => {
    const original = calculateAbrSeries(bars, 3, 2);
    const changedFuture = calculateAbrSeries([...bars.slice(0, 3), { high: 999, low: 0 }], 3, 2);
    expect(changedFuture).toEqual(original);
  });

  it("rejects an unsupported length", () => {
    expect(() => calculateAbrSeries(bars, 0, 3)).toThrow(RangeError);
  });
});
