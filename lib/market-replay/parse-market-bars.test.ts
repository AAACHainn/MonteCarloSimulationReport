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

  it("parses Databento CME OHLCV rows, preserves volume, and keeps the daily volume leader", () => {
    const result = parseMarketBarsCsv([
      "ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume,symbol,ignored",
      "2021-09-07T00:00:00.000000000Z,33,1,1030,4539.25,4539.25,4538,4538.25,576,ESU1,x",
      "2021-09-07T00:00:00.000000000Z,33,1,8858,4529.5,4529.5,4528.25,4528.5,20,ESZ1,x",
      "2021-09-07T00:01:00.000000000Z,33,1,1030,4538.25,4538.25,4537.5,4538,367,ESU1,x",
      "2021-09-07T00:01:00.000000000Z,33,1,8858,4528.25,4528.25,4528,4528,3,ESZ1,x",
      "2021-09-07T00:02:00.000000000Z,33,1,9999,bad,bad,bad,bad,1,NQU1,x",
      "2021-09-07T00:02:00.000000000Z,33,1,9998,bad,bad,bad,bad,1,ESU1-ESZ1,x",
      "not-a-time,33,1,9997,bad,bad,bad,bad,1,NQU1,x",
    ].join("\n"), "UTC", {
      sourceIntervalSeconds: 60,
      cmeRootSymbol: "ES",
      session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] },
    });
    expect(result).toHaveLength(2);
    expect(result.map((bar) => bar.sequence)).toEqual([0, 1]);
    expect(result.map((bar) => bar.close)).toEqual([4538.25, 4538]);
    expect(result.map((bar) => bar.volume)).toEqual([576, 367]);
  });

  it("switches Databento CME rows using the previous available UTC day's volume", () => {
    const result = parseMarketBarsCsv([
      "ts_event,rtype,open,high,low,close,volume,symbol",
      "2021-09-10T00:00:00.000000000Z,33,1,2,0,1,100,ESU1",
      "2021-09-10T00:00:00.000000000Z,33,10,20,5,10,10,ESZ1",
      "2021-09-12T22:00:00.000000000Z,33,2,3,1,2,5,ESU1",
      "2021-09-12T22:00:00.000000000Z,33,20,30,15,20,200,ESZ1",
      "2021-09-13T00:00:00.000000000Z,33,3,4,2,3,1,ESU1",
      "2021-09-13T00:00:00.000000000Z,33,30,40,25,30,250,ESZ1",
    ].join("\n"), "UTC", {
      sourceIntervalSeconds: 60,
      cmeRootSymbol: "ES",
      session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] },
    });
    expect(result.map((bar) => bar.close)).toEqual([1, 2, 30]);
  });

  it("supports Micro Gold delivery months and excludes calendar spreads", () => {
    const result = parseMarketBarsCsv([
      "ts_event,rtype,open,high,low,close,volume,symbol",
      "2021-09-10T00:00:00.000000000Z,33,1780,1781,1779,1780,100,MGCV1",
      "2021-09-10T00:00:00.000000000Z,33,1790,1791,1789,1790,20,MGCZ1",
      "2021-09-10T00:00:00.000000000Z,33,-2,-2,-2,-2,50,MGCV1-MGCZ1",
      "2021-09-12T22:00:00.000000000Z,33,1781,1782,1780,1781,10,MGCV1",
      "2021-09-12T22:00:00.000000000Z,33,1791,1792,1790,1791,200,MGCZ1",
    ].join("\n"), "UTC", {
      sourceIntervalSeconds: 60,
      cmeRootSymbol: "MGC",
      session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] },
    });
    expect(result.map((bar) => ({ close: bar.close, volume: bar.volume }))).toEqual([
      { close: 1780, volume: 100 },
      { close: 1781, volume: 10 },
    ]);
  });

  it("rejects a Databento rtype that disagrees with the selected source interval", () => {
    expect(() => parseMarketBarsCsv([
      "ts_event,rtype,open,high,low,close,volume,symbol",
      "2021-09-10T00:00:00Z,32,1,2,0,1,1,MGCZ1",
      "2021-09-10T00:00:01Z,32,1,2,0,1,1,MGCZ1",
    ].join("\n"), "UTC", {
      sourceIntervalSeconds: 60,
      cmeRootSymbol: "MGC",
      session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] },
    })).toThrow("1s");
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

  it("requires symbol and a root code for Databento CME files", () => {
    const missingSymbol = [
      "ts_event,rtype,open,high,low,close,volume",
      "2021-09-07T00:00:00Z,33,1,2,0,1,1",
      "2021-09-07T00:01:00Z,33,1,2,0,1,1",
    ].join("\n");
    expect(() => parseMarketBarsCsv(missingSymbol, "UTC")).toThrow("symbol");

    const withSymbol = [
      "ts_event,rtype,open,high,low,close,volume,symbol",
      "2021-09-07T00:00:00Z,33,1,2,0,1,1,ESU1",
      "2021-09-07T00:01:00Z,33,1,2,0,1,1,ESU1",
    ].join("\n");
    expect(() => parseMarketBarsCsv(withSymbol, "UTC")).toThrow("根代码");
  });
});
