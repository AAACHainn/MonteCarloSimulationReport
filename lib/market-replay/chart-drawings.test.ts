import { describe, expect, it } from "vitest";
import {
  anchorForLogicalIndex,
  createMarketDrawingSchema,
  distanceToSegment,
  logicalIndexForAnchor,
  snapScreenPointTo45,
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

  it("interpolates timestamps inside a market gap", () => {
    const gapBars = [bars[0], { ...bars[1], timestamp: new Date(Date.UTC(2026, 0, 1, 10, 0)).toISOString() }];
    const anchor = { timestamp: new Date(Date.UTC(2026, 0, 1, 9, 30)).toISOString(), sourceSequence: null, price: 100 };
    expect(logicalIndexForAnchor(anchor, gapBars, 300)).toBeCloseTo(0.5);
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
  });
});
