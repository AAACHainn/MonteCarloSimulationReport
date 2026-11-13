import { describe, expect, it } from "vitest";
import {
  barCountWindowStartIndex,
  buildBarCountLabelWindow,
  buildBarCountLabels,
  DEFAULT_BAR_COUNT_CONFIG,
  parseBarCountPreferences,
} from "./bar-count";
import type { AggregatedMarketBarData, BarCountIndicatorConfig, TradingSessionConfig } from "./types";
import { tradingDayBounds } from "./chunks";
import { resolveDisplaySession } from "./chart-sessions";

const rth: TradingSessionConfig = {
  mode: "DAILY_SESSION",
  timezone: "America/Chicago",
  openMinute: 8 * 60 + 30,
  closeMinute: 15 * 60 + 15,
  weekdays: [1, 2, 3, 4, 5],
};
const config: BarCountIndicatorConfig = {
  enabled: true,
  interval: 1,
  recentTradingDays: 2,
  regularColor: "#64748B",
  bar18Color: "#DC2626",
  hourCloseColor: "#2563EB",
  rthBoundaryColor: "#0D9488",
};

function sessionBars(day: string, displaySeconds: number, count: number, missing: number[] = []) {
  const sessionStart = Date.parse(`${day}T13:30:00.000Z`);
  return Array.from({ length: count }, (_, index): AggregatedMarketBarData => ({
    timestamp: new Date(sessionStart + index * displaySeconds * 1_000).toISOString(),
    bucketEnd: new Date(sessionStart + (index + 1) * displaySeconds * 1_000).toISOString(),
    firstSequence: index,
    lastSequence: index,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
    sourceCount: 1,
    expectedCount: 1,
    status: "COMPLETE",
  })).filter((_, index) => !missing.includes(index + 1));
}

describe("RTH bar count", () => {
  it("numbers the 81 five-minute ES RTH slots and marks bar 18", () => {
    const bars = sessionBars("2021-09-07", 300, 81);
    const labels = buildBarCountLabels({
      bars, displaySession: "RTH",
      displayIntervalSeconds: 300, session: rth, config,
    });
    expect(bars).toHaveLength(81);
    expect(labels).toHaveLength(42);
    expect(labels[0]).toMatchObject({ number: 1, kind: "RTH_BOUNDARY", color: config.rthBoundaryColor });
    expect(labels.at(-1)).toMatchObject({ number: 81, kind: "RTH_BOUNDARY", color: config.rthBoundaryColor });
    expect(labels.find((label) => label.number === 18)).toMatchObject({ kind: "BAR_18", color: config.bar18Color });
    expect(bars[17].timestamp).toBe("2021-09-07T14:55:00.000Z");
    expect(labels.find((label) => label.number === 12)).toMatchObject({ kind: "HOUR_CLOSE", color: config.hourCloseColor });
  });

  it("treats bar 18 as special only on the five-minute timeframe", () => {
    const labels = buildBarCountLabels({
      bars: sessionBars("2021-09-07", 60, 18), displaySession: "RTH",
      displayIntervalSeconds: 60, session: rth, config: { ...config, interval: 17 },
    });
    expect(labels.at(-1)).toMatchObject({ number: 18, kind: "REGULAR", color: config.regularColor });
  });

  it("treats interval one as every second bar while forcing bar one, bar 18, and hourly closes", () => {
    const labels = buildBarCountLabels({
      bars: sessionBars("2021-09-07", 300, 24), displaySession: "RTH",
      displayIntervalSeconds: 300, session: rth, config: { ...config, interval: 1 },
    });
    expect(labels.map((label) => label.number)).toEqual([1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
  });

  it("treats interval two as every third bar", () => {
    const labels = buildBarCountLabels({
      bars: sessionBars("2021-09-07", 300, 18), displaySession: "RTH",
      displayIntervalSeconds: 300, session: rth, config: { ...config, interval: 2 },
    });
    expect(labels.map((label) => label.number)).toEqual([1, 3, 6, 9, 12, 15, 18]);
  });

  it("derives numbers from session time when the window starts midday or has gaps", () => {
    const bars = sessionBars("2021-09-07", 300, 20, [2, 3, 4, 5]).slice(10);
    const labels = buildBarCountLabels({
      bars, displaySession: "RTH", displayIntervalSeconds: 300, session: rth,
      config: { ...config, interval: 14 },
    });
    expect(labels[0].number).toBe(15);
    expect(labels.map((label) => label.number)).not.toContain(2);
  });

  it("resets each day and respects Chicago daylight-saving time", () => {
    const summer = sessionBars("2021-09-07", 300, 1);
    const winterStart = Date.parse("2021-12-07T14:30:00.000Z");
    const winter = [{ ...summer[0], timestamp: new Date(winterStart).toISOString(), bucketEnd: new Date(winterStart + 300_000).toISOString() }];
    const labels = buildBarCountLabels({
      bars: [...summer, ...winter], displaySession: "RTH", displayIntervalSeconds: 300, session: rth, config,
    });
    expect(labels.map((label) => label.number)).toEqual([1, 1]);
  });

  it("limits labels to the configured number of most recent trading days", () => {
    const bars = [
      ...sessionBars("2021-09-07", 300, 2),
      ...sessionBars("2021-09-08", 300, 2),
      ...sessionBars("2021-09-09", 300, 2),
    ];
    expect(barCountWindowStartIndex(bars, rth, 2)).toBe(2);
    expect(barCountWindowStartIndex(bars, rth, 1)).toBe(4);
    expect(barCountWindowStartIndex(bars, rth, 30)).toBe(0);
    const window = buildBarCountLabelWindow({
      bars,
      displaySession: "RTH",
      displayIntervalSeconds: 300,
      session: rth,
      config,
    });
    expect(window.startIndex).toBe(2);
    expect(window.labels.map((label) => label.index)).toEqual([2, 3, 4, 5]);
  });

  it("does not draw disabled, above one hour, invalid continuous RTH or legacy ETH", () => {
    const bars = sessionBars("2021-09-07", 300, 2);
    expect(buildBarCountLabels({ bars, displaySession: "ETH", displayIntervalSeconds: 300, session: rth, config, legacy: true })).toEqual([]);
    expect(buildBarCountLabels({ bars, displaySession: "RTH", displayIntervalSeconds: 300, session: rth, config: { ...config, enabled: false } })).toEqual([]);
    expect(buildBarCountLabels({ bars, displaySession: "RTH", displayIntervalSeconds: 7_200, session: rth, config })).toEqual([]);
    expect(buildBarCountLabels({
      bars, displaySession: "RTH", displayIntervalSeconds: 300,
      session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] },
      config,
    })).toEqual([]);
  });

  it("prioritizes RTH boundaries over hourly closes, including the final 45-minute bucket", () => {
    const bars = sessionBars("2021-09-07", 3_600, 7);
    bars[6].bucketEnd = "2021-09-07T20:15:00.000Z";
    const labels = buildBarCountLabels({
      bars, displaySession: "RTH", displayIntervalSeconds: 3_600, session: rth,
      config: { ...config, interval: 6 },
    });
    expect(labels[0].kind).toBe("RTH_BOUNDARY");
    expect(labels.slice(1, 6).every((label) => label.kind === "HOUR_CLOSE")).toBe(true);
    expect(labels[6]).toMatchObject({ number: 7, kind: "RTH_BOUNDARY" });
  });

  it("parses stored preferences and falls back field by field", () => {
    expect(parseBarCountPreferences(JSON.stringify({
      enabled: false, interval: 2, recentTradingDays: 3,
      regularColor: "#abcdef", bar18Color: "bad", hourCloseColor: "#123456",
    }))).toEqual({
      enabled: false,
      interval: 2,
      recentTradingDays: 3,
      regularColor: "#ABCDEF",
      bar18Color: DEFAULT_BAR_COUNT_CONFIG.bar18Color,
      hourCloseColor: "#123456",
      rthBoundaryColor: DEFAULT_BAR_COUNT_CONFIG.rthBoundaryColor,
    });
    expect(parseBarCountPreferences("not-json")).toEqual(DEFAULT_BAR_COUNT_CONFIG);
    expect(parseBarCountPreferences(JSON.stringify({ interval: 101 }))).toEqual(DEFAULT_BAR_COUNT_CONFIG);
    expect(parseBarCountPreferences(JSON.stringify({ recentTradingDays: 31 }))).toEqual(DEFAULT_BAR_COUNT_CONFIG);
  });
});

const eth: TradingSessionConfig = { ...rth, mode: "OVERNIGHT_SESSION", openMinute: 17 * 60, closeMinute: 16 * 60 };
function ethBars(day: string, seconds = 300) {
  const { start, end } = tradingDayBounds(day, eth);
  return Array.from({ length: Math.ceil((end - start) / (seconds * 1000)) }, (_, index): AggregatedMarketBarData => ({
    ...sessionBars("2021-09-07", 300, 1)[0],
    timestamp: new Date(start + index * seconds * 1000).toISOString(),
    bucketEnd: new Date(Math.min(end, start + (index + 1) * seconds * 1000)).toISOString(),
    firstSequence: index, lastSequence: index,
  }));
}
const ethInput = { displaySession: "ETH" as const, displayIntervalSeconds: 300, session: eth, rthSession: rth, config };

describe("ETH continuous Bar Count and RTH boundaries", () => {
  it.each(["2021-09-07", "2021-12-07", "2026-11-02", "2026-03-09"])("keeps continuous numbering and Chicago DST on %s", (day) => {
    const bars = ethBars(day);
    const labels = buildBarCountLabels({ ...ethInput, bars });
    expect(labels[0]).toMatchObject({ number: 1, kind: "REGULAR" });
    expect(labels.filter((label) => label.kind === "RTH_BOUNDARY")).toMatchObject([
      { number: 187, index: 186, color: config.rthBoundaryColor },
      { number: 267, index: 266, color: config.rthBoundaryColor },
    ]);
    expect(labels.find((label) => label.number === 18)?.kind).toBe("REGULAR");
    expect(labels.some((label) => label.kind === "BAR_18")).toBe(false);
    expect(labels.at(-1)?.number).toBe(276);
  });

  it("does not reset at midnight, RTH open, or a cropped window and does reset at the next ETH open", () => {
    const bars = ethBars("2021-09-07");
    const labels = buildBarCountLabels({ ...ethInput, bars: [...bars.slice(84), ...ethBars("2021-09-08").slice(0, 2)] });
    expect(labels.find((label) => label.kind === "RTH_BOUNDARY")?.number).toBe(187);
    expect(labels.slice(-2).map((label) => label.number)).toEqual([1, 2]);
    const window = buildBarCountLabelWindow({ ...ethInput, bars: [...bars, ...ethBars("2021-09-08")], config: { ...config, recentTradingDays: 1 } });
    expect(window.startIndex).toBe(276);
    expect(window.labels[0]).toMatchObject({ index: 276, number: 1 });
  });

  it("forces both RTH boundaries with sparse labels, retains gaps and never moves missing markers", () => {
    const bars = ethBars("2021-09-07");
    const sparse = { ...ethInput, config: { ...config, interval: 100 } };
    const labels = buildBarCountLabels({ ...sparse, bars: bars.slice(180, 270) });
    expect(labels.filter((label) => label.kind === "RTH_BOUNDARY").map((label) => label.number)).toEqual([187, 267]);
    const missing = buildBarCountLabels({ ...sparse, bars: bars.filter((_, index) => index !== 186 && index !== 266 && index !== 201) });
    expect(missing.filter((label) => label.kind === "RTH_BOUNDARY")).toEqual([]);
    expect(missing.map((label) => label.number)).not.toContain(202);
    const early = buildBarCountLabels({ ...ethInput, bars: bars.slice(180, 187) });
    expect(early.filter((label) => label.kind === "RTH_BOUNDARY").map((label) => label.number)).toEqual([187]);
  });

  it.each([60, 61, 420, 3600])("marks the containing bucket and gives boundaries priority at %ss", (seconds) => {
    const labels = buildBarCountLabels({ ...ethInput, bars: ethBars("2021-09-07", seconds), displayIntervalSeconds: seconds });
    const { start, end } = tradingDayBounds("2021-09-07", rth);
    const ethStart = tradingDayBounds("2021-09-07", eth).start;
    const step = seconds * 1000;
    expect(labels.filter((label) => label.kind === "RTH_BOUNDARY").map((label) => label.number)).toEqual([
      Math.floor((start - ethStart) / step) + 1,
      Math.ceil((end - ethStart) / step),
    ]);
  });

  it("keeps old screenshot versions on RTH-only numbering without new boundary colors", () => {
    expect(buildBarCountLabels({ ...ethInput, bars: ethBars("2021-09-07"), legacy: true })).toEqual([]);
    const labels = buildBarCountLabels({ bars: sessionBars("2021-09-07", 300, 81), displaySession: "RTH", displayIntervalSeconds: 300, session: rth, config, legacy: true });
    expect(labels).toHaveLength(41);
    expect(labels[0]).toMatchObject({ number: 1, kind: "REGULAR" });
  });

  it("does not invent a US session for a symbol without RTH support", () => {
    const dataset = { symbol: "MGC", timeframe: "1m", sourceIntervalSeconds: 60, timezone: eth.timezone, sessionMode: "OVERNIGHT_SESSION", sessionOpenMinute: eth.openMinute, sessionCloseMinute: eth.closeMinute, tradingWeekdays: "1,2,3,4,5" };
    const labels = buildBarCountLabels({ ...ethInput, bars: ethBars("2021-09-07"), rthSession: resolveDisplaySession(dataset, "RTH") });
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((label) => label.kind === "RTH_BOUNDARY")).toBe(false);
  });

  it("restores custom boundary colors, defaults missing fields, and rejects invalid colors", () => {
    expect(parseBarCountPreferences(JSON.stringify({ ...config, rthBoundaryColor: "#a1b2c3" })).rthBoundaryColor).toBe("#A1B2C3");
    expect(parseBarCountPreferences(JSON.stringify({ rthBoundaryColor: "red" })).rthBoundaryColor).toBe(config.rthBoundaryColor);
  });
});
