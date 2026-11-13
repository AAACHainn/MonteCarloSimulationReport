import { describe, expect, it } from "vitest";
import { buildBarCountLabels, buildBarCountLabelWindow, DEFAULT_BAR_COUNT_CONFIG } from "./bar-count";
import { getAggregationBucket } from "./aggregation";
import { resolveDisplaySession } from "./chart-sessions";
import type { AggregatedMarketBarData, TradingSessionConfig } from "./types";

const continuous: TradingSessionConfig = { mode: "TWENTY_FOUR_SEVEN", timezone: "Asia/Shanghai", openMinute: null, closeMinute: null, weekdays: [1, 2, 3, 4, 5, 6, 7] };
const input = { displaySession: "ETH" as const, displayIntervalSeconds: 300, session: continuous, config: DEFAULT_BAR_COUNT_CONFIG };
function candle(time: string | number, seconds: number, sequence = 0): AggregatedMarketBarData {
  const bucket = getAggregationBucket(typeof time === "string" ? Date.parse(time) : time, 1, seconds, continuous)!;
  return { timestamp: new Date(bucket.start).toISOString(), bucketEnd: new Date(bucket.end).toISOString(),
    firstSequence: sequence, lastSequence: sequence, open: 100, high: 102, low: 99, close: 101,
    sourceCount: 1, expectedCount: seconds, volume: 1, status: "COMPLETE" };
}
function dayBars(day: string, seconds: number) {
  const start = Date.parse(day + "T00:00:00Z");
  const first = getAggregationBucket(start, 1, seconds, continuous)!;
  const firstStart = first.start < start ? first.end : first.start;
  return Array.from({ length: Math.ceil((start + 86400000 - firstStart) / (seconds * 1000)) },
    (_, i) => candle(firstStart + i * seconds * 1000, seconds, i));
}

describe("24/7 Bar Count", () => {
  it.each([[60, 1440], [300, 288], [3600, 24]])("counts a full UTC date at %ss without market boundary or bar-18 colors", (seconds, count) => {
    const bars = dayBars("2026-11-14", seconds);
    const labels = buildBarCountLabels({ ...input, bars, displayIntervalSeconds: seconds });
    expect(bars).toHaveLength(count);
    expect(labels[0].number).toBe(1);
    expect(labels.at(-1)?.number).toBe(count);
    expect(labels.every(label => label.kind === "REGULAR" || label.kind === "HOUR_CLOSE")).toBe(true);
    expect(labels.find(label => label.kind === "HOUR_CLOSE")?.color).toBe(DEFAULT_BAR_COUNT_CONFIG.hourCloseColor);
  });

  it("resets at UTC midnight over the weekend, independently of the data parsing timezone", () => {
    const bars = ["2026-11-13T23:55:00Z", "2026-11-14T00:00:00Z", "2026-11-14T00:05:00Z", "2026-11-14T23:55:00Z", "2026-11-15T00:00:00Z"].map(t => candle(t, 300));
    const labels = buildBarCountLabels({ ...input, bars });
    expect(labels.map(label => label.number)).toEqual([288, 1, 2, 288, 1]);
    expect(labels[0].kind).toBe("HOUR_CLOSE");
    expect(labels[1]).toMatchObject({ kind: "REGULAR", color: DEFAULT_BAR_COUNT_CONFIG.regularColor });
    expect(buildBarCountLabels({ ...input, bars, session: { ...continuous, timezone: "America/Chicago" } })).toEqual(labels);
  });

  it("keeps cropped-window and missing-slot numbering instead of renumbering loaded bars", () => {
    const bars = dayBars("2026-11-14", 300).filter((_, i) => i !== 1 && i !== 4);
    const labels = buildBarCountLabels({ ...input, bars, config: { ...input.config, interval: 2 } });
    expect(labels.find(label => label.number === 3)).toMatchObject({ index: 1 });
    expect(labels.find(label => label.number === 6)).toMatchObject({ index: 3 });
    const noon = bars.filter(b => Date.parse(b.timestamp) >= Date.parse("2026-11-14T12:00:00Z"));
    expect(buildBarCountLabels({ ...input, bars: noon })[0].number).toBe(146);
    expect(buildBarCountLabels({ ...input, bars: bars.slice(1) })[0].number).toBe(4);
  });

  it.each([61, 420, 2700])("numbers custom %ss periods on the existing UTC aggregation grid across dates", (seconds) => {
    for (const day of ["2026-11-13", "2026-11-14", "2026-11-15"]) {
      const bars = dayBars(day, seconds);
      const before = structuredClone(bars);
      const labels = buildBarCountLabels({ ...input, bars, displayIntervalSeconds: seconds });
      expect(labels.slice(0, 2).map(label => label.number)).toEqual([1, 2]);
      expect(labels.find(label => label.number === 20)?.index).toBe(19);
      expect(bars).toEqual(before);
      const sparse = buildBarCountLabels({ ...input, bars: bars.slice(15), displayIntervalSeconds: seconds });
      expect(sparse[0].number).toBe(16);
    }
  });

  it("assigns a cross-midnight seven-minute candle to its starting UTC date", () => {
    const bars = ["2026-11-13T23:50:00Z", "2026-11-13T23:57:00Z", "2026-11-14T00:04:00Z", "2026-11-14T00:11:00Z"].map(t => candle(t, 420));
    expect(buildBarCountLabels({ ...input, bars, displayIntervalSeconds: 420 }).map(label => label.number)).toEqual([206, 1, 2]);
    expect(bars[1].bucketEnd).toBe("2026-11-14T00:04:00.000Z");
    expect(buildBarCountLabelWindow({ ...input, bars, displayIntervalSeconds: 420, config: { ...input.config, recentTradingDays: 1 } })).toMatchObject({
      startIndex: 2, labels: [{ index: 2, number: 1 }, { index: 3, number: 2 }],
    });
  });

  it("treats recent dates as UTC calendar days, including weekends and dates without data", () => {
    const bars = ["2026-11-13T00:00:00Z", "2026-11-14T00:00:00Z", "2026-11-15T00:00:00Z"].map(t => candle(t, 300));
    expect(buildBarCountLabelWindow({ ...input, bars }).startIndex).toBe(1);
    expect(buildBarCountLabelWindow({ ...input, bars: [bars[0], bars[2]] }).startIndex).toBe(1);
  });

  it("uses dataset coverage rather than a BTC symbol whitelist and ignores an inapplicable RTH boundary", () => {
    for (const symbol of ["BTCUSDT", "ETHUSDT", "CUSTOM"]) {
      const dataset = { symbol, timeframe: "1m", sourceIntervalSeconds: 60, timezone: "UTC", sessionMode: "TWENTY_FOUR_SEVEN", sessionOpenMinute: null, sessionCloseMinute: null, tradingWeekdays: "1,2,3,4,5,6,7" };
      const session = resolveDisplaySession(dataset, "ETH")!;
      const rthSession: TradingSessionConfig = { ...continuous, mode: "DAILY_SESSION", openMinute: 0, closeMinute: 60 };
      const labels = buildBarCountLabels({ ...input, bars: dayBars("2026-11-14", 300), session, rthSession });
      expect(labels[0]).toMatchObject({ number: 1, kind: "REGULAR" });
      expect(labels.some(label => label.kind === "RTH_BOUNDARY" || label.kind === "BAR_18")).toBe(false);
    }
  });

  it("retains visibility limits and old screenshot rules", () => {
    const bars = dayBars("2026-11-14", 300);
    for (const override of [
      { config: { ...input.config, enabled: false } },
      { displayIntervalSeconds: 7200 },
      { displaySession: "RTH" as const },
      { legacy: true },
      { allowContinuous: false },
    ]) expect(buildBarCountLabels({ ...input, bars, ...override })).toEqual([]);
  });
});
