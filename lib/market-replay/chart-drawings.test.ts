import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
  anchorForLogicalIndex,
  createMarketDrawingSchema,
  distanceToSegment,
  fibonacciPriceAtLevel,
  logicalIndexForAnchor,
  logicalIndexForTimelineAnchor,
  parseFibonacciRetracementPreferences,
  parseTrendLinePreferences,
  snapScreenPointTo45,
  timelineAnchorForLogicalIndex,
  trendLineCanvasDashArray,
  trendLineDashArray,
} from "@/lib/market-replay/chart-drawings";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";

const bars: AggregatedMarketBarData[] = [0, 1, 2].map((index) => ({
  timestamp: new Date(Date.UTC(2026, 0, 1, 9, index * 5)).toISOString(),
  bucketEnd: new Date(Date.UTC(2026, 0, 1, 9, (index + 1) * 5)).toISOString(),
  firstSequence: index * 5,
  lastSequence: index * 5 + 4,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 10,
  sourceCount: 5,
  expectedCount: 5,
  status: "COMPLETE",
}));

const rthSession = {
  mode: "DAILY_SESSION" as const,
  timezone: "America/Chicago",
  openMinute: 8 * 60 + 30,
  closeMinute: 15 * 60 + 15,
  weekdays: [1, 2, 3, 4, 5],
};

describe("chart drawing geometry", () => {
  it("snaps to horizontal, vertical and diagonal 45 degree directions", () => {
    expect(snapScreenPointTo45({ x: 0, y: 0 }, { x: 10, y: 1 }).y).toBeCloseTo(0);
    expect(snapScreenPointTo45({ x: 0, y: 0 }, { x: 1, y: 10 }).x).toBeCloseTo(0);
    const diagonal = snapScreenPointTo45({ x: 5, y: 5 }, { x: 15, y: 13 });
    expect(diagonal.x - 5).toBeCloseTo(diagonal.y - 5);
  });

  it("calculates distance to a finite segment", () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: 12, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(2);
  });

  it("anchors real bars by source sequence and future slots by absolute time", () => {
    expect(anchorForLogicalIndex({ logicalIndex: 1, price: 101, bars, displayIntervalSeconds: 300 })).toEqual({
      timestamp: bars[1].timestamp,
      sourceSequence: 5,
      price: 101,
    });
    const future = anchorForLogicalIndex({ logicalIndex: 5, price: 105, bars, displayIntervalSeconds: 300 });
    expect(future.sourceSequence).toBeNull();
    expect(new Date(future.timestamp).getTime() - new Date(bars[2].timestamp).getTime()).toBe(15 * 60_000);
    expect(logicalIndexForAnchor(future, bars, 300)).toBe(5);
  });

  it("uses source sequence across aggregation-window changes", () => {
    const anchor = { timestamp: bars[0].timestamp, sourceSequence: 7, price: 100 };
    expect(logicalIndexForAnchor(anchor, bars, 300)).toBe(1);
  });

  it("anchors a drawing to the target candle that contains its source bar", () => {
    const hourly = [{
      ...bars[0],
      bucketEnd: new Date(Date.UTC(2026, 0, 1, 10, 0)).toISOString(),
      firstSequence: 0,
      lastSequence: 59,
      sourceCount: 60,
      expectedCount: 60,
    }];
    const anchor = { timestamp: bars[1].timestamp, sourceSequence: 5, price: 100 };
    expect(logicalIndexForAnchor(anchor, hourly, 3_600)).toBe(0);
  });

  it("finds drawing anchors inside RTH candles despite overnight sequence gaps", () => {
    const rthBars = [
      { ...bars[0], firstSequence: 100, lastSequence: 144, expectedCount: 45 },
      { ...bars[1], firstSequence: 1_300, lastSequence: 1_359, expectedCount: 60 },
    ];
    expect(logicalIndexForAnchor({
      timestamp: rthBars[0].timestamp,
      sourceSequence: 105,
      price: 100,
    }, rthBars, 3_600)).toBe(0);
    expect(logicalIndexForAnchor({
      timestamp: rthBars[1].timestamp,
      sourceSequence: 1_330,
      price: 100,
    }, rthBars, 3_600)).toBe(1);
  });

  it("round-trips fractional viewport positions through the source timeline", () => {
    const anchor = timelineAnchorForLogicalIndex(1.5, bars, 300);
    expect(anchor?.sourceSequence).toBeCloseTo(7.5);
    expect(anchor && logicalIndexForTimelineAnchor(anchor, bars, 300)).toBeCloseTo(1.5);
  });

  it("interpolates timestamps inside a market gap", () => {
    const gapBars = [bars[0], { ...bars[1], timestamp: new Date(Date.UTC(2026, 0, 1, 10, 0)).toISOString() }];
    const anchor = { timestamp: new Date(Date.UTC(2026, 0, 1, 9, 30)).toISOString(), sourceSequence: null, price: 100 };
    expect(logicalIndexForAnchor(anchor, gapBars, 300)).toBeCloseTo(0.5);
  });

  it("projects future RTH anchors through the weekend using target-period buckets", () => {
    const fridayLastFiveMinute: AggregatedMarketBarData = {
      ...bars[0],
      timestamp: "2026-06-19T20:10:00.000Z",
      bucketEnd: "2026-06-19T20:15:00.000Z",
      firstSequence: 1_000,
      lastSequence: 1_004,
      expectedCount: 5,
      sourceCount: 5,
    };
    const anchor = anchorForLogicalIndex({
      logicalIndex: 36,
      price: 100,
      bars: [fridayLastFiveMinute],
      displayIntervalSeconds: 300,
      sourceIntervalSeconds: 60,
      session: rthSession,
    });
    expect(anchor.timestamp).toBe("2026-06-22T16:25:00.000Z");

    const fridayLastTwoHour: AggregatedMarketBarData = {
      ...fridayLastFiveMinute,
      timestamp: "2026-06-19T19:30:00.000Z",
      firstSequence: 960,
      expectedCount: 45,
      sourceCount: 45,
    };
    expect(logicalIndexForAnchor(anchor, [fridayLastTwoHour], 7_200, {
      sourceIntervalSeconds: 60,
      session: rthSession,
    })).toBe(2);
  });

  it("validates styles and maps line dash patterns", () => {
    expect(createMarketDrawingSchema.safeParse({
      type: "TREND_LINE",
      geometry: {
        start: { timestamp: bars[0].timestamp, sourceSequence: 0, price: 100 },
        end: { timestamp: bars[1].timestamp, sourceSequence: 5, price: 101 },
      },
      style: {
        color: "#2962FF",
        opacity: 100,
        width: 2,
        lineStyle: "DASHED",
        showStartPrice: false,
        showEndPrice: true,
      },
    }).success).toBe(true);
    expect(trendLineDashArray("SOLID")).toBeUndefined();
    expect(trendLineDashArray("DASHED")).toBe("8 6");
    expect(trendLineDashArray("DOTTED")).toBe("2 5");
    expect(trendLineCanvasDashArray("SOLID")).toEqual([]);
    expect(trendLineCanvasDashArray("DASHED")).toEqual([8, 6]);
    expect(trendLineCanvasDashArray("DOTTED")).toEqual([2, 5]);
  });

  it("validates a Fibonacci retracement with at most ten configurable levels", () => {
    const candidate = {
      type: "FIB_RETRACEMENT",
      geometry: {
        start: { timestamp: bars[0].timestamp, sourceSequence: 0, price: 100 },
        end: { timestamp: bars[1].timestamp, sourceSequence: 5, price: 120 },
      },
      style: DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
    };
    expect(createMarketDrawingSchema.safeParse(candidate).success).toBe(true);
    expect(fibonacciPriceAtLevel(candidate.geometry, 0.618)).toBeCloseTo(112.36);
    expect(createMarketDrawingSchema.safeParse({
      ...candidate,
      style: { ...candidate.style, levels: [...candidate.style.levels, { value: 3, enabled: false, color: "#000000" }] },
    }).success).toBe(false);
    expect(createMarketDrawingSchema.safeParse({
      ...candidate,
      style: { ...candidate.style, levels: candidate.style.levels.map((level, index) => index === 1 ? { ...level, value: 0 } : level) },
    }).success).toBe(false);
  });

  it("loads valid template preferences and falls back from invalid storage", () => {
    const stored = {
      defaultStyle: {
        color: "#F23645",
        opacity: 60,
        width: 3,
        lineStyle: "DOTTED",
        showStartPrice: true,
        showEndPrice: false,
      },
      templates: [{
        id: "template-1",
        name: "回调线",
        style: {
          color: "#2962FF",
          opacity: 100,
          width: 2,
          lineStyle: "SOLID",
          showStartPrice: false,
          showEndPrice: false,
        },
      }],
    };
    expect(parseTrendLinePreferences(JSON.stringify(stored))).toEqual(stored);
    expect(parseTrendLinePreferences("{broken")).toMatchObject({
      defaultStyle: { color: "#2962FF", width: 2 },
      templates: [],
    });
  });

  it("loads Fibonacci template preferences and isolates invalid storage", () => {
    const stored = {
      defaultStyle: DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
      templates: [{ id: "fib-template-1", name: "常用回撤", style: DEFAULT_FIBONACCI_RETRACEMENT_STYLE }],
    };
    expect(parseFibonacciRetracementPreferences(JSON.stringify(stored))).toEqual(stored);
    expect(parseFibonacciRetracementPreferences("{broken")).toEqual({
      defaultStyle: DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
      templates: [],
    });
  });
});
