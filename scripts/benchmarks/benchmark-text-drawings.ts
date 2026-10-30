import { performance } from "node:perf_hooks";
import { DEFAULT_TEXT_STYLE, DEFAULT_TREND_LINE_STYLE, DEFAULT_FIBONACCI_RETRACEMENT_STYLE, DEFAULT_RECTANGLE_STYLE,
  type TextDrawing, type TrendLineDrawing, type FibonacciRetracementDrawing, type RectangleDrawing } from "../../lib/market-replay/chart-drawings";
import { DrawingTimelineLocator } from "../../lib/market-replay/drawing-timeline";
import { TextDrawingPrimitive } from "../../lib/market-replay/text-drawing-primitive";
import { TrendLinePrimitive } from "../../lib/market-replay/trend-line-primitive";
import { FibonacciRetracementPrimitive } from "../../lib/market-replay/fibonacci-retracement-primitive";
import { RectanglePrimitive } from "../../lib/market-replay/rectangle-primitive";

// Synthetic data and injected text metrics only: no browser, environment, database or network.
const base = Date.parse("2026-10-01T00:00:00Z");
const bars = Array.from({ length: 120 }, (_, i) => ({ timestamp: new Date(base + i * 60000).toISOString(),
  bucketEnd: new Date(base + (i + 1) * 60000).toISOString(), firstSequence: i, lastSequence: i }));
const session = { mode: "TWENTY_FOUR_SEVEN" as const, timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1, 2, 3, 4, 5, 6, 7] };
const time = (run: () => void) => { const before = performance.now(); run(); return performance.now() - before; };
const p95 = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.floor((samples.length - 1) * 0.95)];
const reports = [];
for (const mixed of [false, true]) for (const long of [false, true]) for (const count of [50, 200, 500]) {
  let measurements = 0, offset = 0;
  const text = new TextDrawingPrimitive(value => { measurements++; return { width: Array.from(value).length * 10 }; });
  const trend = new TrendLinePrimitive(), fib = new FibonacciRetracementPrimitive(), rectangle = new RectanglePrimitive();
  const primitives = [text, trend, fib, rectangle], timeline = new DrawingTimelineLocator();
  timeline.setTimeline(bars, 60, { sourceIntervalSeconds: 60, session });
  for (const primitive of primitives) primitive.attached({ chart: { timeScale: () => ({ logicalToCoordinate: (i: number) => i * 12 + offset, width: () => 1440 }),
    panes: () => [{ getHeight: () => 700 }] }, series: { priceToCoordinate: (price: number) => price }, requestUpdate: () => undefined } as never);
  const texts: TextDrawing[] = [], trends: TrendLineDrawing[] = [], fibs: FibonacciRetracementDrawing[] = [], rectangles: RectangleDrawing[] = [];
  for (let i = 0; i < count; i++) {
    const anchor = { timestamp: bars[i % bars.length].timestamp, sourceSequence: i % bars.length, price: 20 + i % 600 };
    const common = { id: String(i), datasetId: "synthetic", createdAt: "", updatedAt: "" };
    const geometry = { start: anchor, end: { ...anchor, timestamp: bars[(i + 1) % bars.length].timestamp, price: anchor.price + 50 } };
    if (!mixed || i % 4 === 0) texts.push({ ...common, type: "TEXT", geometry: { anchor, text: long ? `${i} ` + "长文本 with words ".repeat(150).slice(0, 1900) : `${i} 中文 Text\n第二行` },
      style: { ...DEFAULT_TEXT_STYLE, wrapEnabled: long, wrapWidth: 120 } });
    else if (i % 4 === 1) trends.push({ ...common, type: "TREND_LINE", geometry, style: DEFAULT_TREND_LINE_STYLE });
    else if (i % 4 === 2) fibs.push({ ...common, type: "FIB_RETRACEMENT", geometry, style: DEFAULT_FIBONACCI_RETRACEMENT_STYLE });
    else rectangles.push({ ...common, type: "RECTANGLE", geometry, style: DEFAULT_RECTANGLE_STYLE });
  }
  const shared = { bars, timeline, selectedDrawingId: null, draft: null, preview: null, displayIntervalSeconds: 60, sourceIntervalSeconds: 60, session, priceTickSize: 0.01 };
  text.setDrawings({ drawings: texts, timeline, selectedDrawingId: null, edit: null, drag: null });
  trend.setDrawings({ ...shared, drawings: trends, draftStyle: DEFAULT_TREND_LINE_STYLE });
  fib.setDrawings({ ...shared, drawings: fibs, draftStyle: DEFAULT_FIBONACCI_RETRACEMENT_STYLE });
  rectangle.setDrawings({ ...shared, drawings: rectangles, draftStyle: DEFAULT_RECTANGLE_STYLE });
  const update = () => { for (const primitive of primitives) primitive.updateAllViews(); text.hitTestAt({ x: 100, y: 100 }); };
  const firstMs = time(update), before = measurements;
  const samples = Array.from({ length: 100 }, (_, i) => time(() => { offset = i % 20; update(); }));
  const warmMeasurements = measurements - before;
  if (warmMeasurements !== 0) throw new Error("Warm pan remeasured unchanged text");
  const editMs = time(() => {
    text.setDrawings({ drawings: texts, timeline, selectedDrawingId: null, edit: { id: texts[0].id,
      geometry: { ...texts[0].geometry, text: texts[0].geometry.text + " edit" }, style: texts[0].style }, drag: null });
    text.updateAllViews();
  });
  reports.push({ mixed, long, count, textCount: texts.length, firstMs: +firstMs.toFixed(2), warmP95Ms: +p95(samples).toFixed(2),
    editMs: +editMs.toFixed(2), warmMeasurements, cache: text.cacheStats });
  for (const primitive of primitives) primitive.detached();
}
console.log(JSON.stringify({ scope: "Synthetic layout/projection/hit tests only; excludes real Canvas, React, HTTP and database", reports }, null, 2));
