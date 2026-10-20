import { describe, expect, it } from "vitest";
import { aggregateMarketBars } from "./aggregation";
import { chartBarsBeforeHiddenBoundary, chartHiddenSeriesData, chartHideAfterTarget } from "./chart-hide-after";
import { chartCandleData, chartVolumeData } from "./chart-data";
import type { MarketBarData } from "./types";

const start = Date.parse("2026-10-09T13:30:00Z");
function aggregate(sequences: number[], displaySeconds = 300) {
  const source: MarketBarData[] = sequences.map((sequence) => ({ sequence,
    timestamp: new Date(start + sequence * 60_000).toISOString(),
    open: 100 + sequence, high: 102 + sequence, low: 99 + sequence, close: 101 + sequence, volume: 10 + sequence,
  }));
  return aggregateMarketBars({ bars: source, sourceSeconds: 60, displaySeconds,
    session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [] },
    currentSequence: sequences.at(-1) ?? -1, finalSequence: 100, emissionMode: "DENSE" });
}

describe("temporary hiding of later chart candles", () => {
  it("includes the selected candle, selects by source sequence and never changes input data", () => {
    const bars = aggregate([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const before = structuredClone(bars);
    const target = chartHideAfterTarget(bars, 0.2, 300, "ETH")!;
    expect(target.bar.lastSequence).toBe(4);
    expect(chartBarsBeforeHiddenBoundary(bars, target, 300, "ETH")).toEqual([bars[0]]);
    expect(bars).toEqual(before);
    expect(target.bar).not.toBe(bars[0]);
  });

  it.each([null, NaN, Infinity, -0.6, 1.5, 10])("does not select blank or invalid chart positions (%s)", (logical) => {
    expect(chartHideAfterTarget(aggregate([0, 1, 2, 3, 4, 5]), logical, 300, "ETH")).toBeNull();
    expect(chartHideAfterTarget([], logical, 300, "ETH")).toBeNull();
  });

  it("freezes a forming boundary candle while the original replay continues", () => {
    const bars = aggregate([0, 1, 2, 3, 4, 5, 6]);
    const target = chartHideAfterTarget(bars, 1, 300, "ETH")!;
    expect(target.bar.status).toBe("FORMING");
    const advanced = aggregate(Array.from({ length: 12 }, (_, i) => i));
    const shown = chartBarsBeforeHiddenBoundary(advanced, target, 300, "ETH");
    expect(shown).toEqual(bars);
    expect(shown.at(-1)?.lastSequence).toBe(6);
    expect(advanced[1].lastSequence).toBe(9);
    expect(advanced).toHaveLength(3);
  });

  it("preserves time-axis slots and removes hidden OHLC, volume and incomplete-bar colors", () => {
    const bars = aggregate([0, 1, 3, 5, 6, 10]);
    const target = chartHideAfterTarget(bars, 0, 300, "ETH")!;
    expect(target.bar.status).toBe("INCOMPLETE");
    const shown = chartBarsBeforeHiddenBoundary(bars, target, 300, "ETH");
    const data = chartHiddenSeriesData(bars, shown);
    expect(data.candles[0]).toEqual(chartCandleData(bars[0]));
    expect(data.volumes[0]).toEqual(chartVolumeData(bars[0]));
    expect(data.candles.map((item) => item.time)).toEqual(bars.map((bar) => chartCandleData(bar).time));
    for (let i = 1; i < bars.length; i++) {
      expect(data.candles[i]).toEqual({ time: chartCandleData(bars[i]).time });
      expect(data.volumes[i]).toEqual({ time: chartCandleData(bars[i]).time });
    }
  });

  it("retains the original boundary after prepending history across a weekend gap", () => {
    const bars = aggregate([0, 1, 2, 3, 4, 5]);
    const monday = { ...bars[1], timestamp: "2026-10-12T13:30:00Z", firstSequence: 50, lastSequence: 54 };
    const target = chartHideAfterTarget([bars[0], monday], 0, 300, "RTH")!;
    const earlier = { ...bars[0], timestamp: "2026-10-08T13:30:00Z", firstSequence: -5, lastSequence: -1 };
    expect(chartBarsBeforeHiddenBoundary([earlier, bars[0], monday], target, 300, "RTH")).toEqual([earlier, bars[0]]);
  });

  it("keeps the source boundary across timeframe changes without exposing a crossing bucket", () => {
    const source = Array.from({ length: 15 }, (_, i) => i);
    const target = chartHideAfterTarget(aggregate(source), 1, 300, "ETH")!;
    const minuteBars = aggregate(source, 60);
    expect(chartBarsBeforeHiddenBoundary(minuteBars, target, 60, "ETH")).toEqual(minuteBars.slice(0, 10));
    const tenMinuteBars = aggregate(source, 600);
    expect(chartBarsBeforeHiddenBoundary(tenMinuteBars, target, 600, "ETH")).toEqual(tenMinuteBars.slice(0, 1));
    const crossing = { ...tenMinuteBars[0], lastSequence: target.bar.lastSequence + 1 };
    expect(chartBarsBeforeHiddenBoundary([crossing], target, 600, "ETH")).toEqual([]);
    expect(chartBarsBeforeHiddenBoundary([crossing], target, 300, "RTH")).toEqual([]);
  });

  it("never reveals a later window and restores the complete current data after clearing the boundary", () => {
    const bars = aggregate([0, 1, 2, 3, 4, 5, 6]);
    const target = chartHideAfterTarget(bars, 0, 300, "ETH")!;
    const later = aggregate([10, 11, 12, 13, 14]);
    expect(chartBarsBeforeHiddenBoundary(later, target, 300, "ETH")).toEqual([]);
    expect(chartHiddenSeriesData(later, []).candles).toEqual(later.map((bar) => ({ time: chartCandleData(bar).time })));
    expect(chartBarsBeforeHiddenBoundary(later, null, 300, "ETH")).toBe(later);
    expect(chartBarsBeforeHiddenBoundary(bars, null, 300, "ETH")).toBe(bars);
  });
});
