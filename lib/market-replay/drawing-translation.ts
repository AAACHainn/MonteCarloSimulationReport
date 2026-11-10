import { createMarketDrawingSchema, type DrawingAnchor, type MarketDrawing } from "./chart-drawings";
import { cloneDrawingValue } from "./drawing-history";
import type { DrawingTimelineLocator } from "./drawing-timeline";
import type { DrawingNudgeKey } from "./keyboard-shortcuts";
import { offsetPriceByTicks } from "./price-ticks";

export type DrawingAnchorAt = (index: number, price: number) => DrawingAnchor | null;

export function drawingAnchors(drawing: MarketDrawing): DrawingAnchor[] {
  if ("anchor" in drawing.geometry) return [drawing.geometry.anchor];
  if ("a" in drawing.geometry) return [drawing.geometry.a, drawing.geometry.b, drawing.geometry.c];
  return [drawing.geometry.start, drawing.geometry.end];
}

export function translateDrawing(source: MarketDrawing, options: {
  bars: number;
  timeline: DrawingTimelineLocator;
  anchorAt: DrawingAnchorAt;
  movePrice?: (price: number) => number;
  keepCandleOffsets?: boolean;
}): MarketDrawing | null {
  const { bars, timeline, anchorAt, movePrice, keepCandleOffsets } = options;
  const drawing = cloneDrawingValue(source);
  for (const anchor of drawingAnchors(drawing)) {
    if (bars) {
      const index = timeline.logicalIndexForAnchor(anchor);
      if (index === null) return null;
      const target = index + bars;
      const origin = anchorAt(index, anchor.price);
      let moved = anchorAt(target, anchor.price);
      if (!moved) return null;
      if (origin) {
        // Aggregated candles can contain several distinct source anchors.
        const offset = Date.parse(anchor.timestamp) - Date.parse(origin.timestamp);
        if (offset !== 0) {
          const date = new Date(Date.parse(moved.timestamp) + offset);
          const precise = timeline.containsTimestampInBucket(target, date.getTime())
            ? { ...moved, timestamp: date.toISOString(), sourceSequence: null } : null;
          if (precise && timeline.logicalIndexForAnchor(precise) === target) moved = precise;
          else if (keepCandleOffsets) return null;
        }
      }
      // A legacy interpolated anchor may not have an exact target position.
      const projected = timeline.logicalIndexForAnchor(moved);
      if (projected === null || Math.abs(projected - target) > 1e-6) return null;
      Object.assign(anchor, moved);
    }
    if (movePrice) anchor.price = movePrice(anchor.price);
  }
  const { type, geometry, style } = drawing;
  return createMarketDrawingSchema.safeParse({ type, geometry, style }).success ? drawing : null;
}

export function nudgeDrawing(source: MarketDrawing, key: DrawingNudgeKey, steps: number,
  tickSize: number, timeline: DrawingTimelineLocator, anchorAt: DrawingAnchorAt) {
  if (key === "ArrowLeft" || key === "ArrowRight") {
    return translateDrawing(source, { bars: key === "ArrowLeft" ? -1 : 1, timeline, anchorAt, keepCandleOffsets: true });
  }
  if (!Number.isFinite(tickSize) || tickSize <= 0) return null;
  const ticks = key === "ArrowUp" ? steps : -steps;
  return translateDrawing(source, {
    bars: 0, timeline, anchorAt,
    movePrice(price) {
      // Retain legacy prices between ticks and avoid rounding each anchor to a different grid point.
      const next = offsetPriceByTicks(price, tickSize, ticks);
      return next === price ? NaN : next;
    },
  });
}
