import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TEXT_STYLE, DEFAULT_TREND_LINE_STYLE, createMarketDrawingSchema, drawingGeometryMatchesType,
  parseTextPreferences, serializeMarketDrawing, textGeometrySchema, type TextDrawing } from "./chart-drawings";
import { layoutDrawingText, TextLayoutCache, textGraphemes } from "./text-layout";
import { TextDrawingPrimitive } from "./text-drawing-primitive";
import { DrawingTimelineLocator } from "./drawing-timeline";

const anchor = { timestamp: "2026-10-01T00:00:00.000Z", sourceSequence: 0, price: 100 };
const geometry = { anchor, text: "中文 Text\n价格 100" };
const style = { ...DEFAULT_TEXT_STYLE };
const drawing: TextDrawing = { id: "text", datasetId: "dataset", type: "TEXT", geometry, style, createdAt: "", updatedAt: "" };
const measure = (text: string) => ({ width: Array.from(text).length * 10 });

describe("text drawing validation and persistence", () => {
  it("normalizes line endings and round-trips stored objects and style-only templates", () => {
    expect(textGeometrySchema.parse({ anchor, text: " a\r\nb\rc " }).text).toBe(" a\nb\nc ");
    expect(createMarketDrawingSchema.parse({ type: "TEXT", geometry }).style).toEqual(DEFAULT_TEXT_STYLE);
    expect(serializeMarketDrawing({ ...drawing, geometry: JSON.stringify(geometry), style: JSON.stringify(style),
      createdAt: new Date(0), updatedAt: new Date(0) })).toMatchObject({ type: "TEXT", geometry, style });
    const stored = { defaultStyle: style, templates: [{ id: "t", name: "文字", style }] };
    expect(parseTextPreferences(JSON.stringify(stored))).toEqual(stored);
    expect(parseTextPreferences("broken").templates).toEqual([]);
    expect(parseTextPreferences(JSON.stringify({ ...stored, defaultStyle: { ...style, text: "must not persist" } })).templates).toEqual([]);
  });
  it.each(["", " \t\n", "a".repeat(2001), Array(51).fill("a").join("\n")])("rejects invalid contents", text => {
    expect(textGeometrySchema.safeParse({ anchor, text }).success).toBe(false);
  });
  it("accepts exact resource boundaries and keeps geometry types separate", () => {
    expect(textGeometrySchema.safeParse({ anchor, text: "a".repeat(2000) }).success).toBe(true);
    expect(textGeometrySchema.safeParse({ anchor, text: Array(50).fill("a").join("\n") }).success).toBe(true);
    expect(drawingGeometryMatchesType("TREND_LINE", geometry)).toBe(false);
    expect(drawingGeometryMatchesType("TEXT", { start: anchor, end: anchor })).toBe(false);
    expect(createMarketDrawingSchema.safeParse({ type: "TEXT", geometry, style: DEFAULT_TREND_LINE_STYLE }).success).toBe(false);
  });
  it.each([{ fontSize: 11 }, { fontSize: 49 }, { wrapWidth: 119 }, { wrapWidth: 801 }, { wrapWidth: 120.5 },
    { backgroundOpacity: 101 }, { color: "red" }])("rejects invalid style %j", patch => {
    expect(createMarketDrawingSchema.safeParse({ type: "TEXT", geometry, style: { ...style, ...patch } }).success).toBe(false);
  });
});

describe("bounded text layout", () => {
  it("preserves whitespace and manual lines, wrapping long words without losing content", () => {
    expect(layoutDrawingText(" a\t\n\n末行 ", style, measure).lines).toEqual([" a    ", "", "末行 "]);
    const text = "这是中文 text without spaces".repeat(8);
    const wrapped = layoutDrawingText(text, { ...style, wrapEnabled: true, wrapWidth: 120 }, measure);
    expect(wrapped.lines.join("")).toBe(text);
    expect(wrapped.lines.every(line => measure(line).width <= 120)).toBe(true);
  });
  it("keeps emoji and combining graphemes whole, including the fallback", () => {
    const text = "中👩‍👩‍👧‍👦a\u0301🇨🇳👍🏽";
    const expected = ["中", "👩‍👩‍👧‍👦", "a\u0301", "🇨🇳", "👍🏽"];
    expect(textGraphemes(text)).toEqual(expected);
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter")!;
    Object.defineProperty(Intl, "Segmenter", { value: undefined, configurable: true });
    try { expect(textGraphemes(text)).toEqual(expected); }
    finally { Object.defineProperty(Intl, "Segmenter", descriptor); }
  });
  it("does not remeasure on colors, position-independent access or inactive wrap width changes", () => {
    const measured = vi.fn(measure), cache = new TextLayoutCache(measured);
    const first = cache.get("one", geometry.text, style); measured.mockClear();
    expect(cache.get("one", geometry.text, { ...style, color: "#123456", borderEnabled: true, wrapWidth: 600 })).toBe(first);
    expect(measured).not.toHaveBeenCalled();
    cache.get("two", "second", style); measured.mockClear();
    cache.get("one", "new", style); const calls = measured.mock.calls.length;
    cache.get("two", "second", style); expect(measured).toHaveBeenCalledTimes(calls);
    expect(cache.stats.entries).toBe(2);
  });
  it("bounds entries, memory and obsolete input versions", () => {
    const cache = new TextLayoutCache(measure, 2, 1024);
    for (let i = 0; i < 100; i++) cache.get(String(i), "text", style);
    expect(cache.stats.entries).toBeLessThanOrEqual(2); expect(cache.stats.bytes).toBeLessThanOrEqual(1024);
    for (let i = 0; i < 100; i++) cache.get("editor", "text" + i, style);
    expect(cache.stats.entries).toBeLessThanOrEqual(2);
    cache.retain(new Set(["editor"])); expect(cache.stats.entries).toBe(1);
    cache.clear(); expect(cache.stats).toEqual({ entries: 0, bytes: 0 });
  });
  it("limits prefix measurement work on long paragraphs", () => {
    let measuredCharacters = 0;
    layoutDrawingText("a".repeat(2000), { ...style, wrapEnabled: true, wrapWidth: 120 }, text => {
      measuredCharacters += text.length; return measure(text);
    });
    expect(measuredCharacters).toBeLessThan(50_000);
  });
  it("retains 500 maximum-size paragraphs using compact line offsets without warm remeasurement", () => {
    const measured = vi.fn(measure), cache = new TextLayoutCache(measured);
    const largeStyle = { ...style, fontSize: 48 as const, wrapEnabled: true, wrapWidth: 120 };
    const notes = Array.from({ length: 500 }, (_, i) => `${i} ` + "长段落".repeat(650));
    notes.forEach((note, i) => cache.get(String(i), note, largeStyle));
    expect(cache.stats.entries).toBe(500); expect(cache.stats.bytes).toBeLessThan(8 * 1024 * 1024);
    measured.mockClear(); notes.forEach((note, i) => cache.get(String(i), note, largeStyle));
    expect(measured).not.toHaveBeenCalled();
  });
});

function setup() {
  const measured = vi.fn(measure), primitive = new TextDrawingPrimitive(measured), timeline = new DrawingTimelineLocator();
  timeline.setTimeline([{ timestamp: anchor.timestamp, bucketEnd: "2026-10-01T00:01:00Z", firstSequence: 0, lastSequence: 0 }], 60);
  let x = 20, y = 100;
  primitive.attached({ chart: { timeScale: () => ({ logicalToCoordinate: () => x, width: () => 500 }), panes: () => [{ getHeight: () => 300 }] },
    series: { priceToCoordinate: () => y }, requestUpdate: vi.fn() } as never);
  const snapshot = { drawings: [drawing], timeline, edit: null, drag: null, selectedDrawingId: null, paneHeight: 300 };
  primitive.setDrawings(snapshot); primitive.updateAllViews();
  return { primitive, measured, snapshot, move: (nextX: number, nextY: number) => { x = nextX; y = nextY; primitive.updateAllViews(); } };
}
function render(primitive: TextDrawingPrimitive) {
  const fillText = vi.fn(), fillRect = vi.fn(), strokeRect = vi.fn();
  const context = new Proxy({ fillText, fillRect, strokeRect }, { get: (object, key) => Reflect.get(object, key) ?? (() => undefined), set: Reflect.set });
  const target = { useMediaCoordinateSpace: (draw: (scope: unknown) => void) => draw({ context }) } as never;
  for (const view of primitive.paneViews()) { view.renderer().drawBackground!(target); view.renderer().draw(target); }
  return { fillText, fillRect, strokeRect };
}
describe("text primitive projection and rendering", () => {
  it("hands an existing text object to the one inline editor without painting or hitting a duplicate, and restores on cancel", () => {
    const { primitive, measured, snapshot } = setup(); measured.mockClear();
    primitive.setDrawings({ ...snapshot, selectedDrawingId: drawing.id,
      edit: { id: drawing.id, inline: true, geometry: { ...geometry, text: "draft" }, style } });
    primitive.updateAllViews();
    const result = render(primitive);
    expect(result.fillText).not.toHaveBeenCalled(); expect(result.strokeRect).not.toHaveBeenCalled();
    expect(primitive.hitTest(40, 110)).toBeNull(); expect(measured).not.toHaveBeenCalled();
    primitive.setDrawings(snapshot); primitive.updateAllViews();
    expect(render(primitive).fillText).toHaveBeenCalledTimes(2); expect(measured).not.toHaveBeenCalled();
  });
  it("does not lay out or paint an inline placement draft before it is committed", () => {
    const { primitive, measured, snapshot } = setup(); measured.mockClear();
    primitive.setDrawings({ ...snapshot, drawings: [], edit: { id: null, inline: true, geometry, style } });
    primitive.updateAllViews();
    expect(render(primitive).fillText).not.toHaveBeenCalled(); expect(measured).not.toHaveBeenCalled();
    expect(primitive.cacheStats.entries).toBe(0);
  });
  it("reuses layout through pan and color changes, and keeps screen-off anchors with visible text", () => {
    const { primitive, measured, snapshot, move } = setup(); measured.mockClear();
    move(-20, 100);
    expect(primitive.hitTestAt({ x: 2, y: 110 })).toMatchObject({ drawingId: "text", part: "text" });
    primitive.setDrawings({ ...snapshot, drawings: [{ ...drawing, style: { ...style, color: "#FF0000" } }] }); primitive.updateAllViews();
    expect(measured).not.toHaveBeenCalled(); expect(render(primitive).fillText).toHaveBeenCalledTimes(2);
    move(-2000, -2000); expect(render(primitive).fillText).not.toHaveBeenCalled(); expect(measured).not.toHaveBeenCalled();
  });
  it("replaces one saved object during editing and uses foreground anchor hits", () => {
    const { primitive, snapshot } = setup();
    primitive.setDrawings({ ...snapshot, selectedDrawingId: drawing.id,
      edit: { id: drawing.id, geometry: { ...geometry, text: "edited" }, style: { ...style, backgroundEnabled: true, borderEnabled: true } } });
    primitive.updateAllViews(); const result = render(primitive);
    expect(result.fillText).toHaveBeenCalledTimes(1); expect(result.fillText.mock.calls[0][0]).toBe("edited");
    expect(primitive.hitTest(20, 100)).toMatchObject({ hitTestPriority: 2, isBackground: false });
    expect(primitive.hitTest(40, 110)).toMatchObject({ isBackground: true });
    primitive.setDrawings({ ...snapshot, drawings: [] }); primitive.updateAllViews();
    expect(primitive.cacheStats.entries).toBe(0); expect(render(primitive).fillText).not.toHaveBeenCalled();
  });
  it("only paints vertically visible rows, never creates autoscale data and clears on detach", () => {
    const { primitive, snapshot, move } = setup();
    primitive.setDrawings({ ...snapshot, drawings: [{ ...drawing, geometry: { ...geometry, text: Array(50).fill("line").join("\n") } }] });
    move(20, -500); const painted = render(primitive).fillText.mock.calls.length;
    expect(painted).toBeGreaterThan(0); expect(painted).toBeLessThan(15);
    expect("autoscaleInfo" in primitive).toBe(false);
    primitive.detached(); expect(primitive.cacheStats).toEqual({ entries: 0, bytes: 0 });
  });
});
