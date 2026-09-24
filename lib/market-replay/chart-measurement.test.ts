import { describe, expect, it } from "vitest";
import {
  calculateChartMeasurement,
  calculateChartMeasurementGeometry,
  measurementDurationParts,
} from "@/lib/market-replay/chart-measurement";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";

function bar(index: number, timestamp: string, volume: number | null): AggregatedMarketBarData {
  return {
    timestamp,
    bucketEnd: timestamp,
    firstSequence: index,
    lastSequence: index,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume,
    sourceCount: 1,
    expectedCount: 1,
    status: "COMPLETE",
  };
}

const bars = [
  bar(0, "2026-01-02T09:30:00.000Z", 100),
  bar(1, "2026-01-02T09:35:00.000Z", 200),
  bar(2, "2026-01-02T09:40:00.000Z", 300),
  bar(3, "2026-01-05T09:30:00.000Z", 400),
];

describe("calculateChartMeasurementGeometry", () => {
  it("places horizontal and vertical dividers at the center of the selected area", () => {
    expect(calculateChartMeasurementGeometry({
      startX: 40,
      startY: 360,
      endX: 920,
      endY: 20,
    })).toEqual({
      left: 40,
      top: 20,
      right: 920,
      bottom: 360,
      width: 880,
      height: 340,
      middleX: 480,
      middleY: 190,
    });
  });

  it("keeps the center stable when the drag direction is reversed", () => {
    expect(calculateChartMeasurementGeometry({
      startX: 920,
      startY: 20,
      endX: 40,
      endY: 360,
    })).toMatchObject({
      left: 40,
      top: 20,
      right: 920,
      bottom: 360,
      middleX: 480,
      middleY: 190,
    });
  });
});

describe("calculateChartMeasurement", () => {
  it("calculates an upward move, percentage, ticks, bars, elapsed time, and volume", () => {
    expect(calculateChartMeasurement({
      bars,
      startIndex: 0,
      endIndex: 2,
      startPrice: 100,
      endPrice: 102.5,
      priceTickSize: 0.25,
      displayIntervalSeconds: 300,
    })).toEqual({
      priceChange: 2.5,
      percentageChange: 2.5,
      tickChange: 10,
      barCount: 2,
      elapsedMilliseconds: 10 * 60 * 1_000,
      volume: 500,
    });
  });

  it("keeps price direction while making horizontal statistics direction-independent", () => {
    expect(calculateChartMeasurement({
      bars,
      startIndex: 3,
      endIndex: 1,
      startPrice: 105,
      endPrice: 100,
      priceTickSize: 0.5,
      displayIntervalSeconds: 300,
    })).toEqual({
      priceChange: -5,
      percentageChange: (-5 / 105) * 100,
      tickChange: -10,
      barCount: 2,
      elapsedMilliseconds: (71 * 60 + 55) * 60 * 1_000,
      volume: 700,
    });
  });

  it("handles a flat measurement on the same bar", () => {
    expect(calculateChartMeasurement({
      bars,
      startIndex: 1,
      endIndex: 1,
      startPrice: 100,
      endPrice: 100,
      priceTickSize: 0.25,
      displayIntervalSeconds: 300,
    })).toMatchObject({
      priceChange: 0,
      percentageChange: 0,
      tickChange: 0,
      barCount: 0,
      elapsedMilliseconds: 0,
      volume: null,
    });
  });

  it("includes real timestamp gaps and omits incomplete volume ranges", () => {
    const withMissingVolume = [...bars];
    withMissingVolume[2] = { ...withMissingVolume[2], volume: null };
    const result = calculateChartMeasurement({
      bars: withMissingVolume,
      startIndex: 0,
      endIndex: 3,
      startPrice: 100,
      endPrice: 99,
      priceTickSize: 0.25,
      displayIntervalSeconds: 300,
    });

    expect(result.elapsedMilliseconds).toBe(72 * 60 * 60 * 1_000);
    expect(result.volume).toBeNull();
  });

  it("measures future logical bars without requiring candle data", () => {
    expect(calculateChartMeasurement({
      bars,
      startIndex: 2,
      endIndex: 8,
      startPrice: 100,
      endPrice: 103,
      priceTickSize: 0.25,
      displayIntervalSeconds: 300,
    })).toMatchObject({
      barCount: 6,
      elapsedMilliseconds: 30 * 60 * 1_000,
      volume: null,
    });
  });
});

describe("measurementDurationParts", () => {
  it("splits seconds through days without losing sub-minute precision", () => {
    expect(measurementDurationParts(((2 * 24 + 3) * 60 * 60 + 4 * 60 + 5) * 1_000)).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
    });
  });
});
