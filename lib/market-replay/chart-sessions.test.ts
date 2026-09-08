import { describe, expect, it } from "vitest";
import { aggregateMarketBars, getAggregationBucket } from "./aggregation";
import { availableDisplaySessions, cmeEquityIndexRoot, resolveDisplaySession } from "./chart-sessions";
import { nextEma } from "./ema";
import type { MarketBarData } from "./types";

const dataset = {
  symbol: "ES",
  timeframe: "1m",
  timezone: "Asia/Shanghai",
  sourceIntervalSeconds: 60,
  sessionMode: "TWENTY_FOUR_SEVEN",
  sessionOpenMinute: null,
  sessionCloseMinute: null,
  tradingWeekdays: "1,2,3,4,5,6,7",
};

describe("CME equity-index display sessions", () => {
  it.each(["ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K"])("recognizes %s", (symbol) => {
    expect(cmeEquityIndexRoot(symbol)).toBe(symbol);
    expect(availableDisplaySessions(symbol)).toEqual(["ETH", "RTH"]);
  });

  it("recognizes continuous and quarterly contracts without accepting spreads", () => {
    expect(cmeEquityIndexRoot("CME_MINI:ES1!")).toBe("ES");
    expect(cmeEquityIndexRoot("MESU26")).toBe("MES");
    expect(cmeEquityIndexRoot("CME_MINI:NQZ2026")).toBe("NQ");
    expect(cmeEquityIndexRoot("ESU1-ESZ1")).toBeNull();
    expect(cmeEquityIndexRoot("BTCUSD")).toBeNull();
  });

  it("uses Chicago DST for the RTH half-open interval and shortened final hour", () => {
    const rth = resolveDisplaySession(dataset, "RTH")!;
    expect(getAggregationBucket(Date.parse("2021-09-07T13:30:00Z"), 60, 3600, rth)?.start)
      .toBe(Date.parse("2021-09-07T13:30:00Z"));
    expect(getAggregationBucket(Date.parse("2021-09-07T20:14:00Z"), 60, 3600, rth)?.expectedCount).toBe(45);
    expect(getAggregationBucket(Date.parse("2021-09-07T20:15:00Z"), 60, 3600, rth)).toBeNull();
    expect(getAggregationBucket(Date.parse("2021-12-07T14:30:00Z"), 60, 3600, rth)?.start)
      .toBe(Date.parse("2021-12-07T14:30:00Z"));
  });

  it("anchors 5m and 9m bars at 08:30 and excludes off-session data from OHLCV and EMA input", () => {
    const rth = resolveDisplaySession(dataset, "RTH")!;
    const start = Date.parse("2021-09-07T13:29:00Z");
    const bars: MarketBarData[] = Array.from({ length: 7 }, (_, sequence) => ({
      sequence,
      timestamp: new Date(start + sequence * 60_000).toISOString(),
      open: 100 + sequence,
      high: 101 + sequence,
      low: 99 + sequence,
      close: 100.5 + sequence,
      volume: sequence + 1,
    }));
    const fiveMinute = aggregateMarketBars({
      bars, sourceSeconds: 60, displaySeconds: 300, session: rth, currentSequence: 6, finalSequence: 99,
    });
    expect(fiveMinute[0]).toMatchObject({
      timestamp: "2021-09-07T13:30:00.000Z",
      firstSequence: 1,
      lastSequence: 5,
      open: 101,
      high: 106,
      low: 100,
      close: 105.5,
      volume: 20,
      sourceCount: 5,
      expectedCount: 5,
      status: "COMPLETE",
    });
    expect(getAggregationBucket(Date.parse("2021-09-07T13:38:00Z"), 60, 540, rth)?.start)
      .toBe(Date.parse("2021-09-07T13:30:00Z"));
    expect(nextEma(100, fiveMinute[0].close, 20)).toBeCloseTo(100.5238095238, 9);
  });

  it("uses one 23-hour ETH bucket for a 24-hour display interval", () => {
    const eth = resolveDisplaySession(dataset, "ETH")!;
    const bucket = getAggregationBucket(Date.parse("2021-09-13T12:00:00Z"), 60, 86_400, eth)!;
    expect(new Date(bucket.start).toISOString()).toBe("2021-09-12T22:00:00.000Z");
    expect(new Date(bucket.end).toISOString()).toBe("2021-09-13T21:00:00.000Z");
    expect(bucket.expectedCount).toBe(1_380);
  });

  it("assigns the Sunday Globex open to Monday and excludes maintenance and weekends", () => {
    const eth = resolveDisplaySession(dataset, "ETH")!;
    expect(getAggregationBucket(Date.parse("2021-09-12T22:00:00Z"), 60, 3600, eth)?.start)
      .toBe(Date.parse("2021-09-12T22:00:00Z"));
    expect(getAggregationBucket(Date.parse("2021-09-13T21:00:00Z"), 60, 3600, eth)).toBeNull();
    expect(getAggregationBucket(Date.parse("2021-09-17T22:00:00Z"), 60, 3600, eth)).toBeNull();
  });

  it("falls back to the imported session for unsupported symbols and rejects RTH", () => {
    const other = { ...dataset, symbol: "BTCUSD" };
    expect(resolveDisplaySession(other, "ETH")?.timezone).toBe("Asia/Shanghai");
    expect(resolveDisplaySession(other, "RTH")).toBeNull();
  });
});
