import { afterEach, describe, expect, it, vi } from "vitest";
import { abcdGeometrySchema, abcdPriceAtLevel, createMarketDrawingSchema, DEFAULT_ABCD_STYLE, drawingGeometryMatchesType,
  parseAbcdPreferences, serializeMarketDrawing, type AbcdDrawing, type AbcdGeometry } from "./chart-drawings";
import { advanceAbcdDraft, moveAbcdGeometry, previewAbcdDraft } from "./abcd-interaction";
import { AbcdPrimitive, type AbcdSnapshot } from "./abcd-primitive";
import { DrawingTimelineLocator } from "./drawing-timeline";

const anchor = (sequence: number, price: number) => ({ timestamp: new Date(Date.UTC(2026, 9, 1, 0, sequence)).toISOString(), sourceSequence: sequence, price });
const geometry: AbcdGeometry = { a: anchor(0, 100), b: anchor(2, 160), c: anchor(4, 120) };
const drawing: AbcdDrawing = { id: "abcd", datasetId: "dataset", type: "AB_CD", geometry, style: DEFAULT_ABCD_STYLE, createdAt: "", updatedAt: "" };
afterEach(() => vi.restoreAllMocks());

describe("AB=CD geometry and validation", () => {
  it("projects the signed AB price difference from C in both directions", () => {
    expect(abcdPriceAtLevel(geometry)).toBe(180);
    expect(abcdPriceAtLevel(geometry, 0)).toBe(120);
    expect(abcdPriceAtLevel({ ...geometry, b: anchor(2, 80), c: anchor(4, 90) })).toBe(70);
    expect(abcdPriceAtLevel(geometry, 0.5)).toBe(150);
  });
  it("accepts three points and keeps default lines/templates independent from Fibonacci", () => {
    const created = createMarketDrawingSchema.parse({ type: "AB_CD", geometry });
    expect(created.style).toEqual(DEFAULT_ABCD_STYLE);
    expect(DEFAULT_ABCD_STYLE.levels.filter(level => level.enabled).map(level => level.value)).toEqual([0, 1]);
    expect(serializeMarketDrawing({ ...drawing, geometry: JSON.stringify(geometry), style: JSON.stringify(drawing.style),
      createdAt: new Date(0), updatedAt: new Date(0) })).toMatchObject({ type: "AB_CD", geometry, style: drawing.style });
    const preferences = { defaultStyle: drawing.style, templates: [{ id: "t", name: "等幅", style: drawing.style }] };
    expect(parseAbcdPreferences(JSON.stringify(preferences))).toEqual(preferences);
    const fallback = parseAbcdPreferences("bad"); fallback.defaultStyle.levels[0].color = "#000000";
    expect(parseAbcdPreferences(null).defaultStyle).toEqual(DEFAULT_ABCD_STYLE);
    expect(drawingGeometryMatchesType("AB_CD", geometry)).toBe(true);
    expect(drawingGeometryMatchesType("TREND_LINE", geometry)).toBe(false);
  });
  it.each([
    { ...geometry, b: { ...geometry.b, price: 100 } }, { ...geometry, c: { ...geometry.c, timestamp: geometry.b.timestamp } },
    { ...geometry, a: { ...geometry.a, price: NaN } }, { ...geometry, a: { ...geometry.a, price: -Number.MAX_VALUE }, b: { ...geometry.b, price: Number.MAX_VALUE } },
    { ...geometry, c: { ...geometry.c, sourceSequence: -1 } }, { start: geometry.a, end: geometry.b },
  ])("rejects degenerate, mismatched or unbounded geometry", candidate => {
    expect(abcdGeometrySchema.safeParse(candidate).success).toBe(false);
  });
  it("places exactly A, B and C, with preview and retries before committing", () => {
    const first = advanceAbcdDraft(null, geometry.a);
    expect(first.complete).toBeNull(); expect(first.draft?.stage).toBe("b");
    const preview = previewAbcdDraft(first.draft!, geometry.b);
    expect(preview.geometry.a).toBe(geometry.a);
    const second = advanceAbcdDraft(preview, geometry.b);
    expect(second.draft?.stage).toBe("c"); expect(second.complete).toBeNull();
    expect(advanceAbcdDraft(second.draft, geometry.b).complete).toBeNull();
    expect(advanceAbcdDraft(second.draft, geometry.c)).toEqual({ draft: null, complete: geometry });
  });
  it("preserves untouched anchors and source timestamps when moving individual points or the whole object", () => {
    const coordinates = { a: { x: 10, y: 100 }, b: { x: 30, y: 160 }, c: { x: 50, y: 120 } };
    const anchorAt = (point: { x: number; y: number }) => ({ anchor: anchor(Math.round((point.x - 10) / 10), point.y), coordinate: point });
    const moved = moveAbcdGeometry(geometry, coordinates, "b", 0, 10, anchorAt)!;
    expect(moved.a).toBe(geometry.a); expect(moved.c).toBe(geometry.c);
    expect(moved.b).toEqual({ ...geometry.b, price: 170 });
    expect(abcdPriceAtLevel(moved)).toBe(190);
    const shifted = moveAbcdGeometry(geometry, coordinates, "line", 10, 0, anchorAt)!;
    expect(shifted.a.price).toBe(geometry.a.price); expect(shifted.b.sourceSequence).toBe(3); expect(shifted.c.sourceSequence).toBe(5);
    expect(moveAbcdGeometry(geometry, coordinates, "b", 0, -60, anchorAt)).toBeNull();
  });
});

function setup(drawings = [drawing]) {
  const timeline = new DrawingTimelineLocator();
  const bars = Array.from({ length: 6 }, (_, i) => ({ timestamp: anchor(i, 0).timestamp, bucketEnd: anchor(i + 1, 0).timestamp, firstSequence: i, lastSequence: i }));
  timeline.setTimeline(bars, 60);
  let offset = 10;
  const toX = vi.fn((index: number) => index * 10 + offset), toY = vi.fn((price: number) => 300 - price);
  const primitive = new AbcdPrimitive();
  primitive.attached({ chart: { timeScale: () => ({ width: () => 500, logicalToCoordinate: toX }), panes: () => [{ getHeight: () => 300 }] },
    series: { priceToCoordinate: toY }, requestUpdate: vi.fn() } as never);
  const snapshot: AbcdSnapshot = { drawings, timeline, selectedDrawingId: null, preview: null, draft: null, draftStyle: drawing.style, priceTickSize: 0.25 };
  primitive.setDrawings(snapshot); primitive.updateAllViews();
  const render = () => {
    const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), setLineDash: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), measureText: vi.fn(() => ({ width: 20 })), fillRect: vi.fn(), fillText: vi.fn() };
    primitive.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: (draw: (scope: unknown) => void) => draw({ context }) } as never);
    return context;
  };
  return { primitive, snapshot, timeline, bars, toX, toY, render, pan: (x: number) => { offset = x; } };
}

describe("AB=CD projection and performance", () => {
  it("draws C/D horizontal segments over B-C width and only three handles, never D", () => {
    const s = setup(); s.primitive.setDrawings({ ...s.snapshot, selectedDrawingId: drawing.id }); s.primitive.updateAllViews();
    const context = s.render();
    expect(context.moveTo.mock.calls).toEqual([[10, 200], [30, 140], [30, 180], [30, 120]]);
    expect(context.lineTo.mock.calls).toEqual([[30, 140], [50, 180], [50, 180], [50, 120]]);
    expect(context.arc).toHaveBeenCalledTimes(3);
    expect(context.arc.mock.calls.map(args => args.slice(0, 2))).toEqual([[10, 200], [30, 140], [50, 180]]);
    expect(context.measureText).not.toHaveBeenCalled();
    expect(s.primitive.hitTestAt({ x: 40, y: 120 })?.part).toBe("line");
    expect(s.primitive.hitTestAt({ x: 30, y: 140 })?.part).toBe("b");
    expect("autoscaleInfo" in s.primitive).toBe(false);
  });
  it("preserves source anchors on period changes and recomputes line width on pan", () => {
    const s = setup(); s.pan(40); s.primitive.updateAllViews();
    expect(s.primitive.getDrawingCoordinates("abcd")?.b.x).toBe(60);
    s.timeline.setTimeline([{ timestamp: anchor(0, 0).timestamp, bucketEnd: anchor(3, 0).timestamp, firstSequence: 0, lastSequence: 2 },
      { timestamp: anchor(3, 0).timestamp, bucketEnd: anchor(6, 0).timestamp, firstSequence: 3, lastSequence: 5 }], 180);
    s.primitive.updateAllViews();
    expect(s.primitive.getDrawingCoordinates("abcd")?.b.x).toBe(40);
    expect(s.primitive.getDrawingCoordinates("abcd")?.c.x).toBe(50);
    expect(drawing.geometry).toEqual(geometry);
  });
  it("uses refs for previews and skips all time/price projection during repeated hits", () => {
    const s = setup();
    s.primitive.setDrawings({ ...s.snapshot, preview: { id: "abcd", geometry: { ...geometry, c: { ...geometry.c, price: 130 } } } }); s.primitive.updateAllViews();
    expect(s.primitive.getDrawingCoordinates("abcd")?.c.y).toBe(170);
    expect(drawing.geometry.c.price).toBe(120);
    s.toX.mockClear(); s.toY.mockClear();
    for (let i = 0; i < 1000; i++) s.primitive.hitTestAt({ x: 40, y: 110 });
    expect(s.toX).not.toHaveBeenCalled(); expect(s.toY).not.toHaveBeenCalled();
    s.primitive.detached(); expect(s.primitive.getDrawingCoordinates("abcd")).toBeNull();
  });
  it("keeps crossing segments with endpoints offscreen and skips entirely offscreen objects and labels", () => {
    const crossing = { ...drawing, geometry: { a: anchor(-20, 100), b: anchor(-10, 160), c: anchor(70, 120) } };
    const s = setup([crossing]); expect(s.primitive.hitTestAt({ x: 250, y: 120 })?.drawingId).toBe("abcd");
    const far = Array.from({ length: 10_000 }, (_, i) => ({ ...drawing, id: String(i), geometry: { a: anchor(1000 + i, 100), b: anchor(1001 + i, 160), c: anchor(1002 + i, 120) } }));
    s.toY.mockClear(); s.primitive.setDrawings({ ...s.snapshot, drawings: far }); s.primitive.updateAllViews();
    expect(s.toY).not.toHaveBeenCalled(); expect(s.render().stroke).not.toHaveBeenCalled();
  });
  it("reuses the trading-calendar cache across screen-only and style updates", () => {
    const s = setup(); const session = { mode: "DAILY_SESSION" as const, timezone: "America/Chicago", openMinute: 510, closeMinute: 915, weekdays: [1, 2, 3, 4, 5] };
    s.timeline.setTimeline([{ timestamp: "2026-06-19T20:10:00Z", bucketEnd: "2026-06-19T20:15:00Z", firstSequence: 1000, lastSequence: 1004 }], 300,
      { sourceIntervalSeconds: 60, session });
    const future = { ...drawing, geometry: { a: { ...geometry.a, timestamp: "2026-07-01T13:30:00Z", sourceSequence: null },
      b: { ...geometry.b, timestamp: "2026-07-02T13:30:00Z", sourceSequence: null }, c: { ...geometry.c, timestamp: "2026-07-03T13:30:00Z", sourceSequence: null } } };
    s.primitive.setDrawings({ ...s.snapshot, drawings: [future] }); s.primitive.updateAllViews();
    const conversions = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    s.primitive.setDrawings({ ...s.snapshot, drawings: [{ ...future, style: { ...future.style, singleColor: "#123456" } }] });
    for (let i = 0; i < 100; i++) s.primitive.updateAllViews();
    expect(conversions).not.toHaveBeenCalled();
  });
});
