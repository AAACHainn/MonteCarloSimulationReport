import { describe, expect, it } from "vitest";
import { calculateEmaSeries, nextEma } from "./ema";

const bars = [1, 2, 3, 4, 100].map((close) => ({ close }));

describe("EMA", () => {
  it("uses the initial SMA as its first value", () => {
    expect(calculateEmaSeries(bars, 3, 2)).toEqual({
      points: [{ sequence: 2, value: 2 }],
      lastValue: 2,
    });
  });

  it("applies the recursive EMA formula after the seed", () => {
    expect(nextEma(2, 4, 3)).toBe(3);
    expect(calculateEmaSeries(bars, 3, 3).points.at(-1)).toEqual({ sequence: 3, value: 3 });
  });

  it("never reads bars after the revealed sequence", () => {
    const original = calculateEmaSeries(bars, 3, 3);
    const changedFuture = calculateEmaSeries([...bars.slice(0, 4), { close: -999 }], 3, 3);
    expect(changedFuture).toEqual(original);
  });

  it("warms up from all prior bars while filtering points before the display range", () => {
    expect(calculateEmaSeries(bars, 3, 3, 3)).toEqual({
      points: [{ sequence: 3, value: 3 }],
      lastValue: 3,
    });
  });

  it("rejects an unsupported length", () => {
    expect(() => calculateEmaSeries(bars, 1, 3)).toThrow(RangeError);
  });
});
