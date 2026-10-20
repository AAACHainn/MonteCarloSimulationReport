import { describe, expect, it } from "vitest";
import { aggregateMarketBars, aggregateMarketSegments, mergeAggregatedBars, mergeSourceBarInto } from "./aggregation";
import { chartCandleData } from "./chart-data";
import { displayBarScopeKey } from "./bar-cache";
import { chartSnapshotCaption } from "./chart-snapshot-caption";
import { copy } from "@/lib/i18n";
import type { BarEmissionMode, MarketBarData, TradingSessionConfig } from "./types";

const session: TradingSessionConfig = { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1, 2, 3, 4, 5, 6, 7] };
const source = (sequence: number, second: number): MarketBarData => ({ sequence, timestamp: new Date(second * 1000).toISOString(), open: second, high: second + 1, low: second - 1, close: second + .5, volume: 2 });
const options = { sourceSeconds: 1, displaySeconds: 5, session, finalSequence: 99 };

describe("source-aware candle quality", () => {
  it.each([
    ["TRADE_DRIVEN", "NORMAL", "COMPLETE", false],
    ["DENSE", "GAP", "INCOMPLETE", true],
    ["UNKNOWN", "UNKNOWN", "COMPLETE", false],
  ] as const)("classifies sparse closed candles for %s without changing OHLCV", (emissionMode, quality, status, orange) => {
    const bars = aggregateMarketBars({ ...options, emissionMode, bars: [source(0, 0), source(1, 2), source(2, 5)], currentSequence: 2 });
    expect(bars[0]).toMatchObject({ phase: "CLOSED", quality, status, sourceCount: 2, expectedCount: 5, open: 0, high: 3, low: -1, close: 2.5, volume: 4 });
    expect(chartCandleData(bars[0]).borderColor === "#f59e0b").toBe(orange);
  });
  it("does not close a partial final candle solely because the file reached EOF", () => {
    const bars = aggregateMarketBars({ ...options, emissionMode: "TRADE_DRIVEN", finalSequence: 1, currentSequence: 1, bars: [source(0, 0), source(1, 2)] });
    expect(bars[0]).toMatchObject({ phase: "FORMING", status: "FORMING", sourceCount: 2 });
  });
  it("uses only revealed source time, including time outside the selected session", () => {
    const rth: TradingSessionConfig = { ...session, mode: "DAILY_SESSION", openMinute: 570, closeMinute: 571 };
    const start = Date.parse("2026-10-19T09:30:00Z") / 1000;
    const bars = [source(0, start + 1), source(1, start + 61)];
    const selected = aggregateMarketBars({ ...options, session: rth, displaySeconds: 30, bars, emissionMode: "TRADE_DRIVEN", currentSequence: 0 });
    expect(selected[0].phase).toBe("FORMING");
    const closed = aggregateMarketBars({ ...options, session: rth, displaySeconds: 30, bars, emissionMode: "TRADE_DRIVEN", currentSequence: 1 });
    expect(closed[0]).toMatchObject({ phase: "CLOSED", sourceCount: 1, quality: "NORMAL" });
    const incremental = selected.slice();
    expect(mergeSourceBarInto(incremental, bars[1], { ...options, session: rth, displaySeconds: 30, emissionMode: "TRADE_DRIVEN" })).toBe(false);
    expect(incremental).toEqual(closed);
  });
  it.each(["TRADE_DRIVEN", "DENSE", "UNKNOWN"] as BarEmissionMode[])("matches full calculation and both incremental merge paths for %s", (emissionMode) => {
    const raw = [source(0, 0), source(1, 2), source(2, 4), source(3, 7)];
    const expected = aggregateMarketBars({ ...options, emissionMode, bars: raw, currentSequence: 3 });
    const incremental: typeof expected = [];
    for (const bar of raw) mergeSourceBarInto(incremental, bar, { ...options, emissionMode });
    expect(incremental).toEqual(expected);
    const first = aggregateMarketBars({ ...options, emissionMode, bars: raw.slice(0, 2), currentSequence: 1 });
    const revisions = aggregateMarketBars({ ...options, emissionMode, bars: raw, currentSequence: 3 });
    expect(mergeAggregatedBars(first, revisions)).toEqual(expected);
    const nextOnly = aggregateMarketBars({ ...options, emissionMode, bars: [raw[3]], currentSequence: 3 });
    expect(mergeAggregatedBars(first, nextOnly)[0]).toMatchObject({ phase: "CLOSED", quality: emissionMode === "DENSE" ? "GAP" : emissionMode === "UNKNOWN" ? "UNKNOWN" : "NORMAL" });
  });
  it("preserves a confirmed gap even for a trade-driven source", () => {
    const [bar] = aggregateMarketSegments({ ...options, emissionMode: "TRADE_DRIVEN", currentSequence: 0,
      segments: [{ firstSequence: 0, lastSequence: 0, timestamp: new Date(0).toISOString(), endTimestamp: new Date(0).toISOString(), open: 1, high: 2, low: 0, close: 1, volume: 1, sourceCount: 1, confirmedGap: true }] });
    expect(bar).toMatchObject({ phase: "FORMING", quality: "GAP", status: "INCOMPLETE" });
    expect(chartCandleData(bar).borderColor).toBe("#f59e0b");
  });
  it("isolates display caches by source semantics and quality version", () => {
    const base = { datasetId: "d", dataVersion: 1, displayIntervalSeconds: 300, displaySession: "ETH" as const, sessionFingerprint: "s" };
    const keys = ["DENSE", "TRADE_DRIVEN", "UNKNOWN"].map(mode => displayBarScopeKey({ ...base, barEmissionMode: mode }));
    expect(new Set(keys).size).toBe(3);
    expect(keys.every(key => key.includes("quality-1"))).toBe(true);
  });
  it("discloses unknown coverage in PDF/AI captions without claiming a confirmed gap", () => {
    const bars = aggregateMarketBars({ ...options, bars: [source(0, 0), source(1, 2)], currentSequence: 1, revealedThroughMs: 5000 });
    expect(bars[0]).toMatchObject({ phase: "CLOSED", quality: "UNKNOWN" });
    expect(chartSnapshotCaption({ bars })).toContain(copy.marketReplay.barEmission.unknownCoverage);
    expect(chartSnapshotCaption({ bars })).not.toBe(copy.paperTrading.pdf.incomplete);
  });
});
