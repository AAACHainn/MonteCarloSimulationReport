import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarketDrawingSchema, DEFAULT_ARROW_STYLES, drawingGeometryMatchesType, drawingStyleMatchesType,
  parseArrowPreferences, serializeMarketDrawing, updateMarketDrawingSchema, type ArrowDrawing } from "./chart-drawings";
import { ArrowPrimitive, arrowPoints } from "./arrow-primitive";
import { DrawingTimelineLocator } from "./drawing-timeline";
import { drawingDeleteLabel, drawingObjectColor, drawingObjectName, drawingSettingsLabel } from "./drawing-presentation";

const anchor = { timestamp: "2026-10-01T00:00:00.000Z", sourceSequence: 0, price: 100 };
const up: ArrowDrawing = { id: "up", datasetId: "dataset", type: "ARROW_UP", geometry: { anchor },
  style: DEFAULT_ARROW_STYLES.ARROW_UP, createdAt: "", updatedAt: "" };
const down: ArrowDrawing = { ...up, id: "down", type: "ARROW_DOWN", style: DEFAULT_ARROW_STYLES.ARROW_DOWN };
afterEach(() => vi.restoreAllMocks());

describe("arrow persistence and templates", () => {
  it.each([up, down])("round-trips $type through the existing string fields with direction-specific defaults", drawing => {
    expect(createMarketDrawingSchema.parse({ type: drawing.type, geometry: drawing.geometry }).style).toEqual(drawing.style);
    expect(serializeMarketDrawing({ ...drawing, geometry: JSON.stringify(drawing.geometry), style: JSON.stringify(drawing.style),
      createdAt: new Date(0), updatedAt: new Date(0) })).toMatchObject({ type: drawing.type, geometry: drawing.geometry, style: drawing.style });
    expect(drawingObjectColor(drawing)).toBe(drawing.style.color);
    expect(drawingObjectName(drawing, 2)).toContain("2");
    expect(drawingSettingsLabel(drawing)).toContain("设置");
    expect(drawingDeleteLabel(drawing)).toContain("删除");
  });
  it("validates geometry and color without admitting another object's fields", () => {
    for (const geometry of [{ anchor: { ...anchor, price: Infinity } }, { anchor: { ...anchor, sourceSequence: -1 } },
      { anchor: { ...anchor, timestamp: "bad" } }, { start: anchor, end: anchor }, { anchor, text: "text" }]) {
      expect(createMarketDrawingSchema.safeParse({ type: "ARROW_UP", geometry }).success).toBe(false);
    }
    for (const style of [{ color: "green" }, { color: "#123456", borderWidth: 2 }]) {
      expect(createMarketDrawingSchema.safeParse({ type: "ARROW_DOWN", geometry: up.geometry, style }).success).toBe(false);
    }
    expect(drawingStyleMatchesType("ARROW_UP", { color: "#123456" })).toBe(true);
    expect(drawingGeometryMatchesType("TEXT", up.geometry)).toBe(false);
    expect(drawingGeometryMatchesType("TREND_LINE", up.geometry)).toBe(false);
    expect(drawingGeometryMatchesType("ARROW_UP", up.geometry)).toBe(true);
    expect(updateMarketDrawingSchema.safeParse({ geometry: up.geometry, style: { color: "#123456" } }).success).toBe(true);
  });
  it("keeps default colors and templates independent and rejects invalid or oversized storage", () => {
    expect(parseArrowPreferences(null, "ARROW_UP").defaultStyle).toEqual(up.style);
    expect(parseArrowPreferences("broken", "ARROW_DOWN").defaultStyle).toEqual(down.style);
    const template = { id: "t", name: "关注", style: { color: "#123456" } };
    const preferences = { defaultStyle: template.style, templates: [template] };
    expect(parseArrowPreferences(JSON.stringify(preferences), "ARROW_UP")).toEqual(preferences);
    expect(parseArrowPreferences(JSON.stringify({ ...preferences, templates: Array(51).fill(template) }), "ARROW_UP").templates).toEqual([]);
    expect(parseArrowPreferences(JSON.stringify({ ...preferences, defaultStyle: { ...template.style, size: 40 } }), "ARROW_DOWN").defaultStyle).toEqual(down.style);
  });
});

function setup(drawings = [up, down]) {
  const timeline = new DrawingTimelineLocator();
  timeline.setTimeline([{ timestamp: anchor.timestamp, bucketEnd: "2026-10-01T00:05:00.000Z", firstSequence: 0, lastSequence: 4 }], 300);
  let offsetX = 100, offsetY = 0;
  const toX = vi.fn((index: number) => index * 10 + offsetX);
  const toY = vi.fn((price: number) => price + offsetY);
  const primitive = new ArrowPrimitive();
  primitive.attached({ chart: { timeScale: () => ({ logicalToCoordinate: toX, width: () => 500 }),
    panes: () => [{ getHeight: () => 300 }] }, series: { priceToCoordinate: toY }, requestUpdate: vi.fn() } as never);
  const snapshot = { drawings, timeline, selectedDrawingId: null, preview: null };
  primitive.setDrawings(snapshot); primitive.updateAllViews();
  return { primitive, snapshot, toX, toY, move: (x: number, y: number) => { offsetX = x; offsetY = y; } };
}

describe("arrow projection, hit testing and resource use", () => {
  it("anchors each direction at its tip and preserves screen size during chart zoom/pan", () => {
    expect(arrowPoints("ARROW_UP", { x: 0, y: 0 })[3].y).toBe(19);
    expect(arrowPoints("ARROW_DOWN", { x: 0, y: 0 })[3].y).toBe(-19);
    const { primitive, move } = setup();
    expect(primitive.hitTestAt({ x: 100, y: 120 })?.drawingId).toBe("up");
    expect(primitive.hitTestAt({ x: 100, y: 80 })?.drawingId).toBe("down");
    move(130, 20); primitive.updateAllViews();
    expect(primitive.getDrawingCoordinates("up")).toEqual({ x: 130, y: 120 });
    expect(primitive.hitTestAt({ x: 130, y: 140 })?.drawingId).toBe("up");
    expect("autoscaleInfo" in primitive).toBe(false);
  });
  it("moves a preview without mutating saved geometry, and clears it on cancel or detach", () => {
    const { primitive, snapshot } = setup([up]);
    primitive.setDrawings({ ...snapshot, preview: { id: up.id, geometry: { anchor: { ...anchor, price: 170 } } } });
    primitive.updateAllViews(); expect(primitive.getDrawingCoordinates("up")?.y).toBe(170);
    expect(up.geometry.anchor.price).toBe(100);
    primitive.setDrawings(snapshot); primitive.updateAllViews();
    expect(primitive.getDrawingCoordinates("up")?.y).toBe(100);
    primitive.detached(); expect(primitive.getDrawingCoordinates("up")).toBeNull();
    expect(primitive.hitTestAt({ x: 100, y: 100 })).toBeNull();
  });
  it("reuses timeline projections across screen/style changes and repeated hit tests", () => {
    const { primitive, snapshot, toX, toY, move } = setup([up]);
    const calendar = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    move(110, 10);
    primitive.setDrawings({ ...snapshot, drawings: [{ ...up, style: { color: "#123456" } }] });
    primitive.updateAllViews(); toX.mockClear(); toY.mockClear();
    for (let i = 0; i < 1000; i++) primitive.hitTestAt({ x: 110, y: 130 });
    expect(toX).not.toHaveBeenCalled(); expect(toY).not.toHaveBeenCalled(); expect(calendar).not.toHaveBeenCalled();
  });
  it("culls a large offscreen collection before price projection, drawing and hits", () => {
    const arrows = Array.from({ length: 10_000 }, (_, index) => ({ ...up, id: String(index),
      geometry: { anchor: { ...anchor, sourceSequence: 10_000 + index } } }));
    const { primitive, toY } = setup(arrows);
    expect(toY).not.toHaveBeenCalled();
    expect(primitive.hitTestAt({ x: 100, y: 100 })).toBeNull();
    const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), setLineDash: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn() };
    primitive.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: (draw: (scope: unknown) => void) => draw({ context }) } as never);
    expect(context.fill).not.toHaveBeenCalled();
  });
  it("does not repeat trading-calendar conversion for distant anchors during pan and style updates", () => {
    const { primitive, snapshot } = setup([up]);
    const start = "2026-06-19T20:10:00.000Z";
    const session = { mode: "DAILY_SESSION" as const, timezone: "America/Chicago", openMinute: 510, closeMinute: 915, weekdays: [1, 2, 3, 4, 5] };
    snapshot.timeline.setTimeline([{ timestamp: start, bucketEnd: "2026-06-19T20:15:00.000Z", firstSequence: 1000, lastSequence: 1004 }], 300,
      { sourceIntervalSeconds: 60, session });
    const future = { ...up, geometry: { anchor: { ...anchor, timestamp: "2026-07-22T13:30:00.000Z", sourceSequence: null } } };
    primitive.setDrawings({ ...snapshot, drawings: [future] }); primitive.updateAllViews();
    const conversions = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    primitive.setDrawings({ ...snapshot, drawings: [{ ...future, style: { color: "#123456" } }] });
    for (let i = 0; i < 100; i++) primitive.updateAllViews();
    expect(conversions).not.toHaveBeenCalled();
  });
  it("keeps drawings attached to the same source bucket when the display period changes", () => {
    const { primitive, snapshot } = setup([{ ...up, geometry: { anchor: { ...anchor, sourceSequence: 2, timestamp: "2026-10-01T00:02:00.000Z" } } }]);
    expect(primitive.getDrawingCoordinates("up")?.x).toBe(100);
    snapshot.timeline.setTimeline([
      { timestamp: anchor.timestamp, bucketEnd: "2026-10-01T00:02:00.000Z", firstSequence: 0, lastSequence: 1 },
      { timestamp: "2026-10-01T00:02:00.000Z", bucketEnd: "2026-10-01T00:04:00.000Z", firstSequence: 2, lastSequence: 3 },
    ], 120);
    primitive.updateAllViews(); expect(primitive.getDrawingCoordinates("up")?.x).toBe(110);
  });
});
