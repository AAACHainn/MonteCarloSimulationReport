import type { MarketDrawing } from "./chart-drawings";
import type { DrawingTimelineLocator } from "./drawing-timeline";
import { drawingAnchors, translateDrawing, type DrawingAnchorAt } from "./drawing-translation";

/** Use one whole-bar translation for every point, including odd-length segments.
 * Elapsed time is not distance on a chart that compresses closed/missing periods.
 * Keep price differences intact instead of rounding each point independently. */
export function positionDrawingCopy(source: MarketDrawing, target: { logicalIndex: number; price: number },
  timeline: DrawingTimelineLocator, anchorAt: DrawingAnchorAt): MarketDrawing | null {
  const anchors = drawingAnchors(source);
  const indices = anchors.map(anchor => timeline.logicalIndexForAnchor(anchor));
  if (indices.some(index => index === null || !Number.isFinite(index)) || !Number.isFinite(target.logicalIndex) || !Number.isFinite(target.price)) return null;
  const positions = indices as number[], prices = anchors.map(anchor => anchor.price);
  const offset = Math.round(target.logicalIndex - (Math.min(...positions) + Math.max(...positions)) / 2);
  const priceDelta = target.price - (Math.min(...prices) + Math.max(...prices)) / 2;
  return translateDrawing(source, { bars: offset, timeline, anchorAt, movePrice: price => price + priceDelta });
}
