import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FIBONACCI_RETRACEMENT_STYLE, DEFAULT_TREND_LINE_STYLE, type TrendLineDrawing } from "./chart-drawings";
import { DrawingTimelineLocator, drawingTimelineBars } from "./drawing-timeline";
import { TrendLinePrimitive } from "./trend-line-primitive";
import { FibonacciRetracementPrimitive } from "./fibonacci-retracement-primitive";
import type { AggregatedMarketBarData } from "./types";
const session = { mode: "DAILY_SESSION" as const, timezone: "America/Chicago",
  openMinute: 510, closeMinute: 915, weekdays: [1, 2, 3, 4, 5] };
const bars: AggregatedMarketBarData[] = [{ timestamp: "2026-06-19T20:10:00Z", bucketEnd: "2026-06-19T20:15:00Z",
  firstSequence: 1000, lastSequence: 1004, sourceCount: 5, expectedCount: 5, status: "COMPLETE",
  open: 100, high: 110, low: 90, close: 105, volume: 1 }];
const drawing: TrendLineDrawing = { id: "line", datasetId: "dataset", type: "TREND_LINE",
  geometry: { start: { timestamp: bars[0].timestamp, sourceSequence: 1000, price: 100 },
    end: { timestamp: "2026-07-22T13:30:00Z", sourceSequence: null, price: 110 } },
  style: DEFAULT_TREND_LINE_STYLE, createdAt: "", updatedAt: "" };
function setup() {
  const timeline = new DrawingTimelineLocator();
  const metadata = drawingTimelineBars(bars);
  timeline.setTimeline(metadata, 300, { sourceIntervalSeconds: 60, session });
  let xOffset = 0, priceOffset = 0;
  const chart = { timeScale: () => ({ logicalToCoordinate: (index: number) => index * 10 + xOffset, width: () => 500 }),
    panes: () => [{ getHeight: () => 300 }] };
  const series = { priceToCoordinate: (price: number) => price + priceOffset };
  const trend = new TrendLinePrimitive(), fib = new FibonacciRetracementPrimitive();
  for (const primitive of [trend, fib]) primitive.attached({ chart, series, requestUpdate: vi.fn() } as never);
  const snapshot = { bars: metadata, timeline, displayIntervalSeconds: 300, sourceIntervalSeconds: 60,
    session, priceTickSize: 0.25, selectedDrawingId: null, preview: null, draft: null };
  const update = () => {
    trend.setDrawings({ ...snapshot, drawings: [drawing], draftStyle: drawing.style });
    fib.setDrawings({ ...snapshot, drawings: [{ ...drawing, type: "FIB_RETRACEMENT", style: DEFAULT_FIBONACCI_RETRACEMENT_STYLE }],
      draftStyle: DEFAULT_FIBONACCI_RETRACEMENT_STYLE });
  };
  update();
  return { trend, fib, snapshot, update, move: () => { xOffset = 20; priceOffset = 30; } };
}
afterEach(() => vi.restoreAllMocks());

describe("shared drawing projection", () => {
  it("shares endpoint locations across primitives, style changes and screen-only updates", () => {
    const { trend, fib, update, move, snapshot } = setup();
    trend.updateAllViews();
    const conversions = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    fib.updateAllViews();
    const before = trend.getDrawingCoordinates("line")!;
    move(); update();
    trend.setDrawings({ ...snapshot, drawings: [{ ...drawing, style: { ...drawing.style, color: "#F23645", opacity: 60 } }],
      selectedDrawingId: drawing.id, draftStyle: drawing.style });
    for (let i = 0; i < 100; i++) { trend.updateAllViews(); fib.updateAllViews(); }
    expect(conversions).not.toHaveBeenCalled();
    expect(trend.getDrawingCoordinates("line")!.start.x).toBe(before.start.x + 20);
    expect(trend.getDrawingCoordinates("line")!.end.y).toBe(before.end.y + 30);
    expect(fib.getDrawingCoordinates("line")!.end).toEqual(trend.getDrawingCoordinates("line")!.end);
  });

  it("updates only a moved endpoint while preserving selection, preview geometry and level prices", () => {
    const { trend, fib, snapshot } = setup();
    trend.updateAllViews(); fib.updateAllViews();
    const conversions = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const geometry = { start: drawing.geometry.start, end: { ...drawing.geometry.end, timestamp: "2026-07-23T13:30:00Z", price: 120 } };
    trend.setDrawings({ ...snapshot, drawings: [drawing], selectedDrawingId: drawing.id,
      preview: { id: drawing.id, geometry }, draftStyle: drawing.style });
    trend.updateAllViews();
    expect(conversions.mock.calls.length).toBe(1);
    conversions.mockClear();
    fib.setDrawings({ ...snapshot, drawings: [{ ...drawing, type: "FIB_RETRACEMENT", style: DEFAULT_FIBONACCI_RETRACEMENT_STYLE }],
      preview: { id: drawing.id, geometry }, draft: geometry, draftStyle: DEFAULT_FIBONACCI_RETRACEMENT_STYLE });
    fib.updateAllViews();
    expect(conversions).not.toHaveBeenCalled();
    expect(trend.getDrawingCoordinates("line")!.selected).toBe(true);
    expect(trend.getDrawingCoordinates("line")!.drawing.geometry).toEqual(geometry);
    expect(fib.getDrawingCoordinates("line")!.levels.find(level => level.value === 0.5)?.price).toBe(110);
    expect(drawing.geometry.end.price).toBe(110);
  });

  it("keeps crossing segments and skips offscreen line bodies without losing coordinates or price labels", () => {
    const { trend, snapshot } = setup();
    const offscreen = { ...drawing, geometry: { start: { ...drawing.geometry.start, price: -100 },
      end: { ...drawing.geometry.end, price: -50 } }, style: { ...drawing.style, showStartPrice: true, showEndPrice: true } };
    trend.setDrawings({ ...snapshot, drawings: [offscreen], draftStyle: drawing.style });
    trend.updateAllViews();
    expect(trend.getDrawingCoordinates("line")!.lineVisible).toBe(false);
    expect(trend.hitTestAt({ x: 0, y: -100 })).toBeNull();
    const stroke = vi.fn(), text = vi.fn();
    const context = new Proxy({ stroke, fillText: text, measureText: () => ({ width: 20 }) }, {
      get: (object, key) => Reflect.get(object, key) ?? (() => undefined),
      set: (object, key, value) => Reflect.set(object, key, value),
    });
    trend.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: (draw: (scope: unknown) => void) => draw({ context }) } as never);
    expect(stroke).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(2);
  });

  it("keeps selected endpoint hit priority and drafts after culling line bodies", () => {
    const { trend, snapshot } = setup();
    const geometry = { start: { ...drawing.geometry.start, price: -100 }, end: { ...drawing.geometry.end, price: -50 } };
    trend.setDrawings({ ...snapshot, drawings: [{ ...drawing, geometry }], selectedDrawingId: drawing.id,
      draft: drawing.geometry, draftStyle: drawing.style });
    trend.updateAllViews();
    expect(trend.hitTestAt({ x: 0, y: -100 })).toMatchObject({ part: "start", priority: 2 });
    const projected = trend as unknown as { projected: { draft: unknown } };
    expect(projected.projected.draft).not.toBeNull();
  });
});
