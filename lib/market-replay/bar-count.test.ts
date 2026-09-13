import { describe, expect, it } from "vitest";
import { buildBarCountLabels, DEFAULT_BAR_COUNT_CONFIG, parseBarCountPreferences } from "./bar-count";
import type { AggregatedMarketBarData, BarCountIndicatorConfig, TradingSessionConfig } from "./types";

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
  regularColor: "#64748B",
  bar18Color: "#DC2626",
  hourCloseColor: "#2563EB",
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
    expect(labels).toHaveLength(41);
    expect(labels[0]).toMatchObject({ number: 1, kind: "REGULAR" });
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

  it("does not draw outside RTH or above one hour", () => {
    const bars = sessionBars("2021-09-07", 300, 2);
    expect(buildBarCountLabels({ bars, displaySession: "ETH", displayIntervalSeconds: 300, session: rth, config })).toEqual([]);
    expect(buildBarCountLabels({ bars, displaySession: "RTH", displayIntervalSeconds: 7_200, session: rth, config })).toEqual([]);
    expect(buildBarCountLabels({
      bars, displaySession: "RTH", displayIntervalSeconds: 300,
      session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] },
      config,
    })).toEqual([]);
  });

  it("marks exact RTH-anchored hourly closes but not the final 45-minute bucket", () => {
    const bars = sessionBars("2021-09-07", 3_600, 7);
    bars[6].bucketEnd = "2021-09-07T20:15:00.000Z";
    const labels = buildBarCountLabels({
      bars, displaySession: "RTH", displayIntervalSeconds: 3_600, session: rth,
      config: { ...config, interval: 6 },
    });
    expect(labels.slice(0, 6).every((label) => label.kind === "HOUR_CLOSE")).toBe(true);
    expect(labels[6]).toMatchObject({ number: 7, kind: "REGULAR" });
  });

  it("parses stored preferences and falls back field by field", () => {
    expect(parseBarCountPreferences(JSON.stringify({
      enabled: false, interval: 2, regularColor: "#abcdef", bar18Color: "bad", hourCloseColor: "#123456",
    }))).toEqual({
      enabled: false,
      interval: 2,
      regularColor: "#ABCDEF",
      bar18Color: DEFAULT_BAR_COUNT_CONFIG.bar18Color,
      hourCloseColor: "#123456",
    });
    expect(parseBarCountPreferences("not-json")).toEqual(DEFAULT_BAR_COUNT_CONFIG);
    expect(parseBarCountPreferences(JSON.stringify({ interval: 101 }))).toEqual(DEFAULT_BAR_COUNT_CONFIG);
  });
});
