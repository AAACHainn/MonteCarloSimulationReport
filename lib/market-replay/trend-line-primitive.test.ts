import { describe, expect, it } from "vitest";
import {
  decodeTrendLineHitId,
  encodeTrendLineHitId,
  hitTestTrendLines,
  TrendLinePrimitive,
  type TrendLineProjectedDrawing,
} from "@/lib/market-replay/trend-line-primitive";
import type { TrendLineDrawing, TrendLineStyle } from "@/lib/market-replay/chart-drawings";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";

function drawing(id: string, width = 2): TrendLineDrawing {
  return {
    id,
    datasetId: "dataset-1",
    type: "TREND_LINE",
    geometry: {
      start: { timestamp: "2026-01-01T00:00:00.000Z", sourceSequence: 0, price: 100 },
      end: { timestamp: "2026-01-01T00:05:00.000Z", sourceSequence: 1, price: 101 },
    },
    style: {
      color: "#2962FF",
      opacity: 100,
      width,
      lineStyle: "SOLID",
      showStartPrice: false,
      showEndPrice: false,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function projected(id: string, selected = false, y = 10): TrendLineProjectedDrawing {
  return {
    drawing: drawing(id),
    start: { x: 10, y },
    end: { x: 110, y },
    selected,
  };
}

describe("trend line primitive hit testing", () => {
  it("round-trips drawing ids and hit parts through the primitive external id", () => {
    const encoded = encodeTrendLineHitId("drawing:带空格/1", "end");
    expect(decodeTrendLineHitId(encoded)).toEqual({ drawingId: "drawing:带空格/1", part: "end" });
    expect(decodeTrendLineHitId("another-primitive")).toBeNull();
  });

  it("hits a line using the same forgiving width as the former SVG overlay", () => {
    expect(hitTestTrendLines([projected("line-1")], { x: 50, y: 15 })).toMatchObject({
      drawingId: "line-1",
      part: "line",
      priority: 1,
    });
    expect(hitTestTrendLines([projected("line-1")], { x: 50, y: 17 })).toBeNull();
  });

  it("gives selected endpoint handles priority over line bodies", () => {
    expect(hitTestTrendLines([projected("line-1", true)], { x: 11, y: 11 })).toMatchObject({
      drawingId: "line-1",
      part: "start",
      priority: 2,
    });
  });

  it("selects the visually topmost line when overlapping distances are equal", () => {
    expect(hitTestTrendLines(
      [projected("first"), projected("last")],
      { x: 50, y: 10 },
    )).toMatchObject({ drawingId: "last", part: "line" });
  });

  it("renders the draft with the configured default style", () => {
    const bars: AggregatedMarketBarData[] = [0, 1].map((index) => ({
      timestamp: `2026-01-01T00:0${index * 5}:00.000Z`,
      bucketEnd: `2026-01-01T00:${String(index * 5 + 5).padStart(2, "0")}:00.000Z`,
      firstSequence: index,
      lastSequence: index,
      open: 100, high: 110, low: 90, close: 105, volume: 1,
      sourceCount: 1, expectedCount: 1, status: "COMPLETE",
    }));
    const draftStyle: TrendLineStyle = {
      color: "#F23645",
      opacity: 45,
      width: 4,
      lineStyle: "DOTTED",
      showStartPrice: true,
      showEndPrice: true,
    };
    const primitive = new TrendLinePrimitive();
    primitive.attached({
      chart: {
        timeScale: () => ({ logicalToCoordinate: (index: number) => index * 100, width: () => 500 }),
        panes: () => [{ getHeight: () => 300 }],
      },
      series: { priceToCoordinate: (price: number) => price },
      requestUpdate: () => undefined,
    } as never);
    primitive.setDrawings({
      drawings: [], selectedDrawingId: null, preview: null,
      draft: {
        start: { timestamp: bars[0].timestamp, sourceSequence: 0, price: 100 },
        end: { timestamp: bars[1].timestamp, sourceSequence: 1, price: 110 },
      },
      draftStyle,
      bars,
      displayIntervalSeconds: 300,
      sourceIntervalSeconds: 60,
      session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1, 2, 3, 4, 5, 6, 7] },
      priceTickSize: 0.01,
    });
    primitive.updateAllViews();
    const snapshot = primitive as unknown as { projected: { draftStyle: TrendLineStyle } };
    expect(snapshot.projected.draftStyle).toEqual(draftStyle);
  });
});
