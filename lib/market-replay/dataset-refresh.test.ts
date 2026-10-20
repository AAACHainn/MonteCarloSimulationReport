import { describe, expect, it } from "vitest";
import { mergeRefreshedReplayWindow, replayDatasetUpdate, replayDisplayMetadataKey } from "./dataset-refresh";
import { aggregateMarketBars, mergeSourceBarInto } from "./aggregation";
import { displayBarScopeKey, marketChunkKey } from "./bar-cache";
import { canUpdateReplayTail, chartCandleData } from "./chart-data";
import type { AggregatedMarketBarData, MarketDatasetSummary } from "./types";

const dataset: MarketDatasetSummary = { id: "d", name: "d", description: null, symbol: "TEST", timeframe: "1s", timezone: "UTC", status: "READY",
  dataVersion: 1, historyVersion: 1, sourceIntervalSeconds: 1, priceTickSize: 1, sessionMode: "TWENTY_FOUR_SEVEN",
  sessionOpenMinute: null, sessionCloseMinute: null, tradingWeekdays: [1, 2, 3, 4, 5, 6, 7], availableDisplaySessions: ["ETH"],
  barCount: 11, startTime: new Date(0).toISOString(), endTime: new Date(10000).toISOString(), createdAt: new Date(0).toISOString(), progress: null,
  barEmissionMode: "DENSE", aggregationGenerationId: "first", aggregationRuleVersion: 1 };

describe("opened replay display refresh (AR-03)", () => {
  it.each([
    { barEmissionMode: "TRADE_DRIVEN" as const }, { barEmissionMode: "UNKNOWN" as const },
    { aggregationGenerationId: "second" }, { aggregationRuleVersion: 2 }, { timezone: "America/Chicago" },
  ])("detects same-source-version display changes: %j", update => {
    const next = { ...dataset, ...update };
    expect(next.dataVersion).toBe(dataset.dataVersion);
    expect(replayDatasetUpdate(dataset, next)).toBe("display");
    expect(replayDisplayMetadataKey(next)).not.toBe(replayDisplayMetadataKey(dataset));
    const source = { datasetId: dataset.id, dataVersion: dataset.dataVersion, symbol: dataset.symbol, sourceIntervalSeconds: 1, tradingDay: "1970-01-01" };
    expect(marketChunkKey({ ...source, dataVersion: next.dataVersion })).toBe(marketChunkKey(source));
    const display = { datasetId: dataset.id, dataVersion: 1, displayIntervalSeconds: 5, displaySession: "ETH" as const };
    expect(displayBarScopeKey({ ...display, sessionFingerprint: replayDisplayMetadataKey(next) }))
      .not.toBe(displayBarScopeKey({ ...display, sessionFingerprint: replayDisplayMetadataKey(dataset) }));
  });

  it("ignores identical metadata while preserving tail and history conflict handling", () => {
    expect(replayDatasetUpdate(dataset, { ...dataset, tradingWeekdays: [...dataset.tradingWeekdays].reverse() })).toBe("none");
    expect(replayDatasetUpdate(dataset, { ...dataset, dataVersion: 2, barCount: 12 })).toBe("tail");
    expect(replayDatasetUpdate(dataset, { ...dataset, historyVersion: 2, barEmissionMode: "UNKNOWN" })).toBe("history");
  });

  it("reclassifies retained history and continues incrementally with the new mode without losing the panned prefix", () => {
    const session = { mode: "TWENTY_FOUR_SEVEN" as const, timezone: "UTC", openMinute: null, closeMinute: null, weekdays: dataset.tradingWeekdays };
    const source = [0, 2, 5, 7, 10].map((second, sequence) => ({ sequence, timestamp: new Date(second * 1000).toISOString(), open: 100, high: 101, low: 99, close: 100, volume: 1 }));
    const old = aggregateMarketBars({ bars: source.slice(0, 4), sourceSeconds: 1, displaySeconds: 5, session, currentSequence: 3, finalSequence: 4, emissionMode: "DENSE" });
    expect(old[0].quality).toBe("GAP");
    const fresh = aggregateMarketBars({ bars: source.slice(2, 4), sourceSeconds: 1, displaySeconds: 5, session, currentSequence: 3, finalSequence: 4, emissionMode: "TRADE_DRIVEN" });
    const refreshed = mergeRefreshedReplayWindow(old, [], fresh, [], 0, "TRADE_DRIVEN", 3);
    expect(refreshed.bars).toHaveLength(old.length);
    expect(refreshed.bars[0]).toMatchObject({ timestamp: old[0].timestamp, quality: "NORMAL", phase: "CLOSED", sourceCount: 2, volume: 2 });
    expect(old[0].quality).toBe("GAP"); // The old cache is not mutated.
    expect(canUpdateReplayTail(old, refreshed.bars, "DENSE:first", "TRADE_DRIVEN:second")).toBe(false);
    expect(canUpdateReplayTail(old, refreshed.bars, "same", "same")).toBe(true);
    expect(chartCandleData(old[0]).borderColor).toBe("#f59e0b");
    expect(chartCandleData(refreshed.bars[0]).borderColor).toBeUndefined();
    mergeSourceBarInto(refreshed.bars, source[4], { sourceSeconds: 1, displaySeconds: 5, session, finalSequence: 4, emissionMode: "TRADE_DRIVEN" });
    expect(refreshed.bars).toEqual(aggregateMarketBars({ bars: source, sourceSeconds: 1, displaySeconds: 5, session, currentSequence: 4, finalSequence: 4, emissionMode: "TRADE_DRIVEN" }));
  });

  it("retains explicit gap evidence and excludes future cached candles", () => {
    const bar = { timestamp: new Date(0).toISOString(), bucketEnd: new Date(5000).toISOString(), firstSequence: 0, lastSequence: 1,
      open: 1, high: 2, low: 0, close: 1, volume: null, sourceCount: 2, expectedCount: 5, phase: "CLOSED", quality: "GAP", status: "INCOMPLETE", confirmedGap: true } as AggregatedMarketBarData;
    const result = mergeRefreshedReplayWindow([bar, { ...bar, timestamp: new Date(5000).toISOString(), firstSequence: 2, lastSequence: 3 }], [], [], [], 0, "TRADE_DRIVEN", 1);
    expect(result.bars).toEqual([{ ...bar, emissionMode: "TRADE_DRIVEN" }]);
  });
});
