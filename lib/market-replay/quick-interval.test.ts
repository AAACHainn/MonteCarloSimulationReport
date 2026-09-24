import { describe, expect, it } from "vitest";
import { getQuickIntervalRange, parseQuickInterval } from "@/lib/market-replay/quick-interval";

describe("quick interval", () => {
  it("uses minutes by converting the typed amount to seconds", () => {
    expect(parseQuickInterval("5", "m", 60)).toBe(300);
    expect(parseQuickInterval(" 15 ", "m", 300)).toBe(900);
  });

  it("rejects values that are not an integer multiple of the source interval", () => {
    expect(parseQuickInterval("9", "m", 300)).toBeNull();
    expect(parseQuickInterval("1.5", "h", 300)).toBeNull();
    expect(parseQuickInterval("0", "m", 60)).toBeNull();
  });

  it("caps the range at the largest interval the chart supports", () => {
    expect(getQuickIntervalRange(300, "m")).toEqual({ minimum: 5, maximum: 1_440, step: 5 });
    expect(getQuickIntervalRange(7, "m")).toEqual({ minimum: 7, maximum: 1_435, step: 7 });
    expect(parseQuickInterval("1441", "m", 60)).toBeNull();
  });

  it("reports when a unit cannot represent a supported interval", () => {
    expect(getQuickIntervalRange(50_000, "m")).toBeNull();
    expect(getQuickIntervalRange(50_000, "s")).toEqual({ minimum: 50_000, maximum: 50_000, step: 50_000 });
  });
});
