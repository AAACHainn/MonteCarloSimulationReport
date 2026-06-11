import { describe, expect, it } from "vitest";
import { buildTradeDuplicateKey, isSafeArchivePath } from "./backup";

describe("isSafeArchivePath", () => {
  it("accepts screenshot paths inside the archive", () => {
    expect(isSafeArchivePath("screenshots/trade-1.png")).toBe(true);
  });

  it("rejects traversal paths", () => {
    expect(isSafeArchivePath("../outside.png")).toBe(false);
    expect(isSafeArchivePath("screenshots/../../outside.png")).toBe(false);
    expect(isSafeArchivePath("C:\\outside.png")).toBe(false);
  });
});

describe("buildTradeDuplicateKey", () => {
  it("uses date, instrument, entry, stop, and target as the duplicate identity", () => {
    expect(
      buildTradeDuplicateKey({
        date: "2026-05-12T08:30:00.000Z",
        instrument: "Emini",
        entryPrice: 7366.5,
        stopLossPrice: 7363,
        targetPrice: 7374.25,
      }),
    ).toBe("2026-05-12|Emini|7366.5|7363|7374.25");
  });

  it("returns null when the trade is missing identity fields", () => {
    expect(
      buildTradeDuplicateKey({
        date: null,
        instrument: "Emini",
        entryPrice: 7366.5,
        stopLossPrice: 7363,
        targetPrice: 7374.25,
      }),
    ).toBeNull();
  });
});
