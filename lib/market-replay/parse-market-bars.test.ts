import { describe, expect, it } from "vitest";
import { MarketCsvValidationError, parseMarketBarsCsv, parseMarketTimestamp } from "./parse-market-bars";

describe("parseMarketBarsCsv", () => {
  it("parses case-insensitive OHLCV headers and common timestamp formats", () => {
    const result = parseMarketBarsCsv([
      "\uFEFFTimestamp,OPEN,High,low,Close,Volume",
      "2026-01-01T00:00:00Z,10,12,9,11,100",
      "1767229200,11,13,10,12,200",
      "1767232800000,12,14,11,13,",
    ].join("\n"), "UTC");
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ sequence: 0, open: 10, volume: 100 });
    expect(result[2].volume).toBeNull();
  });

  it("interprets offset-free ISO timestamps in the selected IANA timezone", () => {
    const date = parseMarketTimestamp("2026-01-01 09:30:00", "Asia/Shanghai");
    expect(date?.toISOString()).toBe("2026-01-01T01:30:00.000Z");
  });

  it("allows negative prices when their OHLC relationship is valid", () => {
    const result = parseMarketBarsCsv([
      "timestamp,open,high,low,close",
      "2026-01-01T00:00:00Z,-2,-1,-3,-2.5",
      "2026-01-01T01:00:00Z,-2.5,-2,-4,-3",
    ].join("\n"), "UTC");
    expect(result[0].low).toBe(-3);
  });

  it("validates source-open timestamps against the configured cadence", () => {
    const csv = ["timestamp,open,high,low,close", "2026-01-01T00:00:00Z,1,2,0,1", "2026-01-01T00:07:00Z,1,2,0,1"].join("\n");
    expect(() => parseMarketBarsCsv(csv, "UTC", {
      sourceIntervalSeconds: 300,
      session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] },
    })).toThrow();
  });

  it.each([
    ["2024-03-10 02:30:00", "nonexistent"],
    ["2024-11-03 01:30:00", "ambiguous"],
  ])("rejects %s America/New_York local time as %s", (value) => {
    expect(parseMarketTimestamp(value, "America/New_York")).toBeNull();
  });

  it("rejects duplicate timestamps, invalid OHLC, and negative volume as one import", () => {
    expect(() => parseMarketBarsCsv([
      "timestamp,open,high,low,close,volume",
      "2026-01-01T00:00:00Z,10,12,9,11,1",
      "2026-01-01T00:00:00Z,10,12,9,11,-1",
      "2026-01-01T01:00:00Z,10,9,8,11,1",
    ].join("\n"), "UTC")).toThrow(MarketCsvValidationError);
    try {
      parseMarketBarsCsv([
        "timestamp,open,high,low,close,volume",
        "2026-01-01T00:00:00Z,10,12,9,11,1",
        "2026-01-01T00:00:00Z,10,12,9,11,-1",
        "2026-01-01T01:00:00Z,10,9,8,11,1",
      ].join("\n"), "UTC");
    } catch (error) {
      expect(error).toBeInstanceOf(MarketCsvValidationError);
      expect((error as MarketCsvValidationError).totalIssues).toBeGreaterThanOrEqual(3);
    }
  });

  it("rejects two bars that would collapse into the same chart second", () => {
    expect(() => parseMarketBarsCsv([
      "timestamp,open,high,low,close",
      "2026-01-01T00:00:00.100Z,10,12,9,11",
      "2026-01-01T00:00:00.900Z,11,13,10,12",
    ].join("\n"), "UTC")).toThrow("每秒只能有一根");
  });

  it("rejects missing required columns and one-row files", () => {
    expect(() => parseMarketBarsCsv("timestamp,open\n2026-01-01T00:00:00Z,1", "UTC")).toThrow("至少需要 2 行");
  });
});
