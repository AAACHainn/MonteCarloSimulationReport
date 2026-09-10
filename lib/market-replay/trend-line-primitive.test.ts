import { describe, expect, it } from "vitest";
import {
  decodeTrendLineHitId,
  encodeTrendLineHitId,
  hitTestTrendLines,
  type TrendLineProjectedDrawing,
} from "@/lib/market-replay/trend-line-primitive";
import type { TrendLineDrawing } from "@/lib/market-replay/chart-drawings";

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
});
