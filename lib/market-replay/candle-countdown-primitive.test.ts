import { describe, expect, it } from "vitest";
import {
  candleCountdownRemainingSeconds,
  formatCandleCountdown,
} from "./candle-countdown-primitive";
import type { AggregatedMarketBarData } from "./types";

function bar(overrides: Partial<AggregatedMarketBarData> = {}): AggregatedMarketBarData {
  return {
    timestamp: "2026-09-18T01:00:00.000Z",
    bucketEnd: "2026-09-18T01:05:00.000Z",
    firstSequence: 0,
    lastSequence: 0,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
    sourceCount: 1,
    expectedCount: 5,
    status: "FORMING",
    ...overrides,
  };
}

describe("candle countdown", () => {
  it("decrements by one-minute source bars on a five-minute candle", () => {
    expect(candleCountdownRemainingSeconds(bar(), "2026-09-18T01:00:00.000Z", 60)).toBe(240);
    expect(candleCountdownRemainingSeconds(bar({ sourceCount: 4 }), "2026-09-18T01:03:00.000Z", 60)).toBe(60);
    expect(candleCountdownRemainingSeconds(
      bar({ sourceCount: 5, status: "COMPLETE" }), "2026-09-18T01:04:00.000Z", 60,
    )).toBe(0);
  });

  it("uses timestamps so missing source bars do not add fake remaining time", () => {
    expect(candleCountdownRemainingSeconds(
      bar({ sourceCount: 2 }), "2026-09-18T01:04:00.000Z", 60,
    )).toBe(0);
  });

  it("supports second-level sources and formats longer durations", () => {
    expect(candleCountdownRemainingSeconds(
      bar({ bucketEnd: "2026-09-18T01:01:00.000Z", expectedCount: 60 }),
      "2026-09-18T01:00:00.000Z",
      1,
    )).toBe(59);
    expect(formatCandleCountdown(59)).toBe("00:59");
    expect(formatCandleCountdown(300)).toBe("05:00");
    expect(formatCandleCountdown(3_661)).toBe("01:01:01");
  });
});
