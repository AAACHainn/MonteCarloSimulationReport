import { performance } from "node:perf_hooks";
import { DEFAULT_RECTANGLE_STYLE, DEFAULT_TREND_LINE_STYLE, DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
  type TrendLineDrawing, type RectangleDrawing, type FibonacciRetracementDrawing } from "../../lib/market-replay/chart-drawings";
import { RectanglePrimitive } from "../../lib/market-replay/rectangle-primitive";
import { TrendLinePrimitive } from "../../lib/market-replay/trend-line-primitive";
import { FibonacciRetracementPrimitive } from "../../lib/market-replay/fibonacci-retracement-primitive";
import { drawingTimelineBars, DrawingTimelineLocator } from "../../lib/market-replay/drawing-timeline";
import type { AggregatedMarketBarData } from "../../lib/market-replay/types";

// Synthetic revealed data only: no environment, database, network or business writes.
const base = Date.parse("2026-06-19T13:30:00Z");
const session = { mode: "DAILY_SESSION" as const, timezone: "America/Chicago", openMinute: 510, closeMinute: 915, weekdays: [1, 2, 3, 4, 5] };
const bars: AggregatedMarketBarData[] = Array.from({ length: 81 }, (_, i) => ({ timestamp: new Date(base + i * 300000).toISOString(),
  bucketEnd: new Date(base + (i+1) * 300000).toISOString(), firstSequence: i*5, lastSequence: i*5+4, expectedCount: 5, sourceCount: 5,
  status: "COMPLETE", open: 100, high: 110, low: 90, close: 105, volume: 1 }));
const coordinateScale = { logicalToCoordinate: (i: number) => i * 10, width: () => 1440 };
const attachment = { chart: { timeScale: () => coordinateScale, panes: () => [{ getHeight: () => 700 }] },
  series: { priceToCoordinate: (p: number) => p }, requestUpdate: () => undefined };
const measure = (run: () => void) => { const before = performance.now(); run(); return performance.now() - before; };
const quantile = (values: number[], q: number) => [...values].sort((a,b) => a-b)[Math.floor((values.length-1)*q)];
let conversions = 0;
const original = Intl.DateTimeFormat.prototype.formatToParts;
Intl.DateTimeFormat.prototype.formatToParts = function (...args) { conversions++; return original.apply(this, args); };
const reports = [];
try {
  for (const count of [50, 200, 500]) {
    const rectangle = new RectanglePrimitive(), trend = new TrendLinePrimitive(), fib = new FibonacciRetracementPrimitive();
    const primitives = [trend, fib, rectangle], timeline = new DrawingTimelineLocator();
    for (const primitive of primitives) primitive.attached(attachment as never);
    const lines: TrendLineDrawing[] = [], rectangles: RectangleDrawing[] = [], retracements: FibonacciRetracementDrawing[] = [];
    for (let i = 0; i < count; i++) {
      const drawing = { id: String(i), datasetId: "synthetic", createdAt: "", updatedAt: "", geometry: {
        start: { timestamp: new Date(base - (i+1)*86400000).toISOString(), sourceSequence: null, price: 30 + i%200 },
        end: { timestamp: new Date(base + (i+1)*86400000).toISOString(), sourceSequence: null, price: 300 + i%200 },
      } };
      if (i%3 === 0) rectangles.push({ ...drawing, type: "RECTANGLE", style: DEFAULT_RECTANGLE_STYLE });
      else if (i%3 === 1) lines.push({ ...drawing, type: "TREND_LINE", style: DEFAULT_TREND_LINE_STYLE });
      else retracements.push({ ...drawing, type: "FIB_RETRACEMENT", style: DEFAULT_FIBONACCI_RETRACEMENT_STYLE });
    }
    const set = (window: AggregatedMarketBarData[], preview = false) => {
      const metadata = drawingTimelineBars(window);
      timeline.setTimeline(metadata, 300, { sourceIntervalSeconds: 60, session });
      const shared = { bars: metadata, timeline, selectedDrawingId: null, draft: null, preview: null,
        displayIntervalSeconds: 300, sourceIntervalSeconds: 60, session, priceTickSize: 0.25 };
      trend.setDrawings({ ...shared, drawings: lines, draftStyle: DEFAULT_TREND_LINE_STYLE });
      fib.setDrawings({ ...shared, drawings: retracements, draftStyle: DEFAULT_FIBONACCI_RETRACEMENT_STYLE });
      rectangle.setDrawings({ ...shared, drawings: rectangles, draftStyle: DEFAULT_RECTANGLE_STYLE,
        preview: preview ? { id: rectangles[0].id, geometry: { ...rectangles[0].geometry, end: { ...rectangles[0].geometry.end, price: 350 } } } : null });
    };
    const update = () => { for (const primitive of primitives) primitive.updateAllViews(); };
    const firstMs = measure(() => { set(bars); update(); });
    const before = conversions;
    const repeat = Array.from({ length: 100 }, () => measure(update));
    const repeatedConversions = conversions - before;
    const dragMs = measure(() => { set(bars, true); update(); });
    const replacementMs = measure(() => { set(bars.slice(1)); update(); });
    reports.push({ count, rectangles: rectangles.length, firstMs, repeatedMedianMs: quantile(repeat, 0.5),
      repeatedP95Ms: quantile(repeat, 0.95), repeatedConversions, dragMs, replacementMs });
    for (const primitive of primitives) primitive.detached();
    if (repeatedConversions !== 0) throw new Error("Repeated projection recomputed the trading calendar");
  }
} finally { Intl.DateTimeFormat.prototype.formatToParts = original; }
console.log(JSON.stringify({ scope: "Synthetic mixed-drawing projection only; excludes real browser Canvas and HTTP", reports }, null, 2));
