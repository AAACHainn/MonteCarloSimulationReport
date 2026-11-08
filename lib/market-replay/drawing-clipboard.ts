import { createMarketDrawingSchema, type DrawingAnchor, type MarketDrawing } from "./chart-drawings";
import { cloneDrawingValue } from "./drawing-history";
import type { DrawingTimelineLocator } from "./drawing-timeline";

export function drawingAnchors(drawing: MarketDrawing): DrawingAnchor[] {
  if ("anchor" in drawing.geometry) return [drawing.geometry.anchor];
  if ("a" in drawing.geometry) return [drawing.geometry.a, drawing.geometry.b, drawing.geometry.c];
  return [drawing.geometry.start, drawing.geometry.end];
}

/** Use one whole-bar translation for every point, including odd-length segments.
 * Elapsed time is not distance on a chart that compresses closed/missing periods.
 * Keep price differences intact instead of rounding each point independently. */
export function positionDrawingCopy(source: MarketDrawing, target: { logicalIndex: number; price: number },
  timeline: DrawingTimelineLocator, anchorAt: (index: number, price: number) => DrawingAnchor | null): MarketDrawing | null {
  const drawing = cloneDrawingValue(source), anchors = drawingAnchors(drawing);
  const indices = anchors.map(anchor => timeline.logicalIndexForAnchor(anchor));
  if (indices.some(index => index === null || !Number.isFinite(index)) || !Number.isFinite(target.logicalIndex) || !Number.isFinite(target.price)) return null;
  const positions = indices as number[], prices = anchors.map(anchor => anchor.price);
  const offset = Math.round(target.logicalIndex - (Math.min(...positions) + Math.max(...positions)) / 2);
  const priceDelta = target.price - (Math.min(...prices) + Math.max(...prices)) / 2;
  for (let i = 0; i < anchors.length; i++) {
    let anchor = anchorAt(positions[i] + offset, anchors[i].price + priceDelta);
    const origin = anchorAt(positions[i], anchors[i].price);
    if (anchor && origin) {
      // Several source anchors can occupy one aggregate. Preserve their offsets
      // inside that candle instead of collapsing them to one persisted timestamp.
      const time = Date.parse(anchor.timestamp) + Date.parse(anchors[i].timestamp) - Date.parse(origin.timestamp);
      if (Number.isFinite(time) && Math.abs(time) <= 8.64e15) {
        const precise = { ...anchor, timestamp: new Date(time).toISOString(), sourceSequence: null };
        if (Math.abs((timeline.logicalIndexForAnchor(precise) ?? Infinity) - positions[i] - offset) <= 1e-6) anchor = precise;
      }
    }
    // A legacy interpolated anchor may have no exact representation in the new
    // window. Do not silently shorten a drawing by rounding individual points.
    if (!anchor || Math.abs((timeline.logicalIndexForAnchor(anchor) ?? Infinity) - positions[i] - offset) > 1e-6) return null;
    Object.assign(anchors[i], anchor);
  }
  // Some partial-session buckets cannot represent every original offset. Never
  // send a degenerate rectangle or AB=CD that the create API must reject.
  return createMarketDrawingSchema.safeParse({ type: drawing.type, geometry: drawing.geometry, style: drawing.style }).success ? drawing : null;
}
