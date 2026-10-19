import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RECTANGLE_STYLE, DEFAULT_TREND_LINE_STYLE, createMarketDrawingSchema, drawingStyleMatchesType,
  parseRectanglePreferences, rectangleStyleSchema, serializeMarketDrawing, type RectangleDrawing } from "./chart-drawings";
import { RectanglePrimitive, hitTestRectangles, rectangleHandles, resizeRectangle, resizeRectangleGeometry } from "./rectangle-primitive";
import { drawingTimelineBars, DrawingTimelineLocator } from "./drawing-timeline";
import type { AggregatedMarketBarData } from "./types";

const geometry = { start: { timestamp: "2026-06-19T20:10:00Z", sourceSequence: 1000, price: 40 },
  end: { timestamp: "2026-07-22T13:30:00Z", sourceSequence: null, price: 140 } };
const drawing: RectangleDrawing = { id: "rect", datasetId: "dataset", type: "RECTANGLE", geometry,
  style: { ...DEFAULT_RECTANGLE_STYLE }, createdAt: "", updatedAt: "" };
const projected = { drawing, start: { x: 20, y: 40 }, end: { x: 220, y: 140 }, selected: false, visible: true };
const session = { mode: "DAILY_SESSION" as const, timezone: "America/Chicago", openMinute: 510, closeMinute: 915, weekdays: [1, 2, 3, 4, 5] };
const bars: AggregatedMarketBarData[] = [{ timestamp: geometry.start.timestamp, bucketEnd: "2026-06-19T20:15:00Z", firstSequence: 1000,
  lastSequence: 1004, expectedCount: 5, sourceCount: 5, status: "COMPLETE", open: 100, high: 110, low: 90, close: 105, volume: 1 }];
function setup() {
  const primitive = new RectanglePrimitive(), timeline = new DrawingTimelineLocator(), metadata = drawingTimelineBars(bars);
  timeline.setTimeline(metadata, 300, { sourceIntervalSeconds: 60, session });
  let offset = 0;
  primitive.attached({ chart: { timeScale: () => ({ logicalToCoordinate: (i: number) => i * 10 + offset, width: () => 500 }),
    panes: () => [{ getHeight: () => 300 }] }, series: { priceToCoordinate: (p: number) => p + offset }, requestUpdate: vi.fn() } as never);
  const snapshot = { drawings: [drawing], selectedDrawingId: null, draft: null, preview: null, draftStyle: drawing.style,
    bars: metadata, timeline, displayIntervalSeconds: 300, sourceIntervalSeconds: 60, session };
  primitive.setDrawings(snapshot); primitive.updateAllViews();
  return { primitive, snapshot, move: () => { offset = 20; } };
}
function render(primitive: RectanglePrimitive) {
  const fillRect = vi.fn(), strokeRect = vi.fn();
  const context = new Proxy({ fillRect, strokeRect }, { get: (o, k) => Reflect.get(o, k) ?? (() => undefined), set: (o,k,v) => Reflect.set(o,k,v) });
  for (const view of primitive.paneViews()) view.renderer()!.draw({ useMediaCoordinateSpace: (draw: (p: unknown) => void) => draw({ context }) } as never);
  return { fillRect, strokeRect };
}
afterEach(() => vi.restoreAllMocks());

describe("rectangle validation and preferences", () => {
  it("defaults to a translucent fill without a border", () => {
    expect(createMarketDrawingSchema.parse({ type: "RECTANGLE", geometry }).style).toEqual(DEFAULT_RECTANGLE_STYLE);
    expect(DEFAULT_RECTANGLE_STYLE).toMatchObject({ fillOpacity: 15, borderStyle: "NONE" });
  });
  it.each([0, 1, 2])("rejects collapsed or invalid geometry %s", kind => {
    const bad = kind === 0 ? { ...geometry, end: { ...geometry.end, price: geometry.start.price } }
      : kind === 1 ? { ...geometry, end: { ...geometry.end, timestamp: geometry.start.timestamp } }
      : { ...geometry, end: { ...geometry.end, price: Number.NaN } };
    expect(createMarketDrawingSchema.safeParse({ type: "RECTANGLE", geometry: bad }).success).toBe(false);
  });
  it.each([{ fillOpacity: 0 }, { fillOpacity: 101 }, { borderWidth: 0 }, { fillColor: "red" }, { borderStyle: "bad" }])("rejects invalid/invisible styles %j", patch => {
    expect(rectangleStyleSchema.safeParse({ ...DEFAULT_RECTANGLE_STYLE, ...patch }).success).toBe(false);
  });
  it("allows border-only rectangles and separates drawing types", () => {
    expect(rectangleStyleSchema.safeParse({ ...DEFAULT_RECTANGLE_STYLE, fillOpacity: 0, borderStyle: "DASHED" }).success).toBe(true);
    expect(drawingStyleMatchesType("RECTANGLE", DEFAULT_TREND_LINE_STYLE)).toBe(false);
    expect(drawingStyleMatchesType("TREND_LINE", DEFAULT_RECTANGLE_STYLE)).toBe(false);
  });
  it("round-trips JSON storage and independent template styles", () => {
    const stored = { defaultStyle: drawing.style, templates: [{ id: "template", name: "支撑", style: drawing.style }] };
    const loaded = parseRectanglePreferences(JSON.stringify(stored));
    loaded.templates[0].style.fillOpacity = 30;
    expect(loaded.defaultStyle.fillOpacity).toBe(15);
    expect(parseRectanglePreferences("bad JSON").templates).toEqual([]);
    expect(serializeMarketDrawing({ ...drawing, geometry: JSON.stringify(geometry), style: JSON.stringify(drawing.style),
      createdAt: new Date(0), updatedAt: new Date(0) })).toMatchObject({ type: "RECTANGLE", geometry, style: drawing.style });
  });
  it("limits template resources and rejects corrupt stored styles", () => {
    expect(parseRectanglePreferences(JSON.stringify({ defaultStyle: drawing.style,
      templates: Array.from({ length: 51 }, (_, i) => ({ id: String(i), name: "zone", style: drawing.style })) })).templates).toEqual([]);
    expect(parseRectanglePreferences(JSON.stringify({ defaultStyle: { ...drawing.style, fillOpacity: 0 }, templates: [] })).defaultStyle).toEqual(DEFAULT_RECTANGLE_STYLE);
  });
});

describe("rectangle hit testing and resizing", () => {
  it("selects invisible borders with tolerance but leaves the interior for chart gestures", () => {
    expect(hitTestRectangles([projected], { x: 17, y: 90 })).toMatchObject({ part: "line", priority: 1 });
    expect(hitTestRectangles([projected], { x: 120, y: 90 })).toBeNull();
    expect(hitTestRectangles([{ ...projected, selected: true }], { x: 120, y: 90 })).toMatchObject({ part: "line", priority: 0 });
  });
  it.each(Object.entries(rectangleHandles(projected.start, projected.end)))("prioritizes selected %s handles", (part, point) => {
    expect(hitTestRectangles([{ ...projected, selected: true }], point)).toMatchObject({ part, priority: 2 });
  });
  it("uses the topmost equal-distance object and ignores culled objects", () => {
    const last = { ...projected, drawing: { ...drawing, id: "top" } };
    expect(hitTestRectangles([projected, last], projected.start)?.drawingId).toBe("top");
    expect(hitTestRectangles([{ ...last, visible: false }], projected.start)).toBeNull();
  });
  it("resizes edges independently and supports reversed anchors and crossing", () => {
    expect(resizeRectangle(projected.end, projected.start, "w", { x: 300, y: 200 })).toEqual({ start: { x: 300, y: 40 }, end: { x: 220, y: 140 } });
    expect(resizeRectangle(projected.start, projected.end, "se", { x: 5, y: 10 })).toEqual({ start: projected.start, end: { x: 5, y: 10 } });
    expect(resizeRectangle(projected.start, projected.end, "n", { x: 999, y: 10 })).toEqual({ start: { x: 20, y: 10 }, end: projected.end });
  });
  it("preserves source timestamps when resizing only price after switching display periods", () => {
    const anchorAt = (p: { x: number; y: number }) => ({ timestamp: "2026-06-19T20:00:00Z", sourceSequence: 990, price: p.y });
    const result = resizeRectangleGeometry(geometry, projected.start, projected.end, "n", { x: 999, y: 30 }, anchorAt)!;
    expect(result.start).toEqual({ ...geometry.start, price: 30 });
    expect(result.end).toBe(geometry.end);
    const horizontal = resizeRectangleGeometry(geometry, projected.start, projected.end, "e", { x: 300, y: 999 }, anchorAt)!;
    expect(horizontal.start).toBe(geometry.start);
    expect(horizontal.end.price).toBe(geometry.end.price);
    expect(horizontal.end.sourceSequence).toBe(990);
    const reversed = resizeRectangleGeometry(geometry, projected.end, projected.start, "n", { x: 0, y: 20 }, anchorAt)!;
    expect(reversed.start).toBe(geometry.start);
    expect(reversed.end).toEqual({ ...geometry.end, price: 20 });
  });
});

describe("rectangle projection and rendering", () => {
  it("reuses the shared calendar across screen/style updates, previews and drafts", () => {
    const { primitive, snapshot, move } = setup();
    const before = primitive.getDrawingCoordinates(drawing.id)!;
    const conversions = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    move();
    primitive.setDrawings({ ...snapshot, drawings: [{ ...drawing, style: { ...drawing.style, fillColor: "#F23645" } }],
      draft: geometry, preview: { id: drawing.id, geometry }, selectedDrawingId: drawing.id });
    for (let i = 0; i < 100; i++) primitive.updateAllViews();
    expect(conversions).not.toHaveBeenCalled();
    expect(primitive.getDrawingCoordinates(drawing.id)!.start.x).toBe(before.start.x + 20);
    expect(primitive.getDrawingCoordinates(drawing.id)!.end.y).toBe(before.end.y + 20);
    expect(primitive.paneViews().map(v => v.zOrder?.())).toEqual(["bottom", "top"]);
    expect("autoscaleInfo" in primitive).toBe(false);
    expect(render(primitive).strokeRect).toHaveBeenCalled();
  });
  it("retains the original geometry during preview and after detaching releases data", () => {
    const { primitive, snapshot } = setup();
    const preview = { ...geometry, end: { ...geometry.end, price: 190 } };
    primitive.setDrawings({ ...snapshot, preview: { id: drawing.id, geometry: preview } }); primitive.updateAllViews();
    expect(primitive.getDrawingCoordinates(drawing.id)?.drawing.geometry.end.price).toBe(190);
    expect(drawing.geometry.end.price).toBe(140);
    primitive.detached(); expect(primitive.getDrawingCoordinates(drawing.id)).toBeNull();
  });
  it("renders an enclosing rectangle with all corners offscreen and never invents clipped borders", () => {
    const { primitive, snapshot } = setup();
    const enclosing = { ...drawing, geometry: { start: { ...geometry.start, timestamp: "2026-06-18T13:30:00Z", sourceSequence: null, price: -100 },
      end: { ...geometry.end, price: 1000 } } };
    primitive.setDrawings({ ...snapshot, drawings: [enclosing] }); primitive.updateAllViews();
    const { fillRect, strokeRect } = render(primitive);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 500, 300);
    expect(strokeRect).not.toHaveBeenCalled();
    expect(primitive.hitTestAt({ x: 100, y: 100 })).toBeNull();
  });
  it("skips offscreen fill/hits but retains object coordinates", () => {
    const { primitive, snapshot } = setup();
    primitive.setDrawings({ ...snapshot, drawings: [{ ...drawing, geometry: { start: { ...geometry.start, price: -200 }, end: { ...geometry.end, price: -100 } } }] });
    primitive.updateAllViews(); expect(primitive.getDrawingCoordinates(drawing.id)).not.toBeNull();
    expect(render(primitive).fillRect).not.toHaveBeenCalled();
    expect(primitive.hitTestAt({ x: 0, y: -200 })).toBeNull();
  });
});
