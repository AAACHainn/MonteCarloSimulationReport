import { describe, expect, it } from "vitest";
import { getTradeScreenshotUrl } from "./screenshot-url";

describe("getTradeScreenshotUrl", () => {
  it("changes when the stored screenshot path changes", () => {
    const oldUrl = getTradeScreenshotUrl("journal-1", "trade-1", "journal-1/Emini-100.png");
    const newUrl = getTradeScreenshotUrl("journal-1", "trade-1", "journal-1/Emini-200.png");

    expect(oldUrl).not.toBe(newUrl);
    expect(newUrl).toBe(
      "/api/trade-journals/journal-1/trades/trade-1/screenshot?version=journal-1%2FEmini-200.png",
    );
  });

  it("returns the endpoint without a version when no screenshot path exists", () => {
    expect(getTradeScreenshotUrl("journal-1", "trade-1", null)).toBe(
      "/api/trade-journals/journal-1/trades/trade-1/screenshot",
    );
  });
});
