import { describe, expect, it } from "vitest";
import {
  getAdjacentBrowseIndex,
  getBrowsableTrades,
  resolveBrowseIndex,
} from "@/lib/trade-journal/browse";

describe("trade journal browsing", () => {
  const trades = [
    { id: "first", screenshotPath: "first.webp" },
    { id: "without-image", screenshotPath: null },
    { id: "last", screenshotPath: "last.webp" },
  ];

  it("keeps the incoming order and skips trades without screenshots", () => {
    expect(getBrowsableTrades(trades).map((trade) => trade.id)).toEqual(["first", "last"]);
  });

  it("preserves the current trade when possible and otherwise selects the first trade", () => {
    const browsableTrades = getBrowsableTrades(trades);

    expect(resolveBrowseIndex(browsableTrades, "last")).toBe(1);
    expect(resolveBrowseIndex(browsableTrades, "without-image")).toBe(0);
    expect(resolveBrowseIndex(browsableTrades, null)).toBe(0);
    expect(resolveBrowseIndex([], "last")).toBe(-1);
  });

  it("does not navigate beyond either end", () => {
    expect(getAdjacentBrowseIndex(0, 2, -1)).toBe(0);
    expect(getAdjacentBrowseIndex(0, 2, 1)).toBe(1);
    expect(getAdjacentBrowseIndex(1, 2, 1)).toBe(1);
    expect(getAdjacentBrowseIndex(0, 0, 1)).toBe(-1);
  });
});
