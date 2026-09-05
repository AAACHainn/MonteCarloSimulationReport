import { describe, expect, it } from "vitest";
import { formatPriceForTick, isPriceOnTick, priceDecimalsForTick, snapPriceToTick } from "./price-ticks";

describe("market price ticks", () => {
  it.each([
    [1, 0], [0.25, 2], [0.01, 2], [0.0001, 4], [1e-8, 8],
  ])("derives the display precision for %s", (tickSize, decimals) => {
    expect(priceDecimalsForTick(tickSize)).toBe(decimals);
  });

  it("snaps futures prices to quarter-point ticks", () => {
    expect(snapPriceToTick(5321.37, 0.25)).toBe(5321.25);
    expect(snapPriceToTick(5321.38, 0.25)).toBe(5321.5);
  });

  it("snaps forex prices to one pip", () => {
    expect(snapPriceToTick(1.08647, 0.0001)).toBe(1.0865);
    expect(formatPriceForTick(1.0865, 0.0001)).toBe("1.0865");
  });

  it("detects prices that do not respect the configured tick", () => {
    expect(isPriceOnTick(5321.25, 0.25)).toBe(true);
    expect(isPriceOnTick(5321.3, 0.25)).toBe(false);
  });
});
