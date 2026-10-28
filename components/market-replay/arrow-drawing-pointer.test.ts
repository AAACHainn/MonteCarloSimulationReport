import { afterEach, describe, expect, it, vi } from "vitest";
import { useReplayChartDrawingPointer } from "./use-replay-chart-drawing-pointer";
import type { useReplayChartCore } from "./use-replay-chart-core";
import { DEFAULT_ABCD_STYLE, DEFAULT_ARROW_STYLES, type AbcdDrawing, type MarketDrawing, type ArrowDrawing, type DrawingTool } from "@/lib/market-replay/chart-drawings";
import type { AbcdHit, AbcdPreview } from "@/lib/market-replay/abcd-primitive";
import type { AbcdDraft } from "@/lib/market-replay/abcd-interaction";
import { DrawingTimelineLocator } from "@/lib/market-replay/drawing-timeline";

const effects = vi.hoisted(() => ({ cleanup: null as (() => void) | null }));
vi.mock("react", () => ({ useEffect: (effect: () => () => void) => { effects.cleanup = effect(); } }));
vi.mock("@/lib/market-replay/keyboard-shortcuts", async importOriginal => ({
  ...await importOriginal<object>(), hasVisibleReplayDialog: () => false, isReplayShortcutInputTarget: () => false,
}));

const anchor = { timestamp: "2026-10-01T00:02:15.000Z", sourceSequence: 2, price: 100 };
const drawing: ArrowDrawing = { id: "arrow", datasetId: "dataset", type: "ARROW_UP", geometry: { anchor },
  style: DEFAULT_ARROW_STYLES.ARROW_UP, createdAt: "", updatedAt: "" };
const ref = <T,>(current: T) => ({ current });
afterEach(() => { effects.cleanup?.(); effects.cleanup = null; vi.unstubAllGlobals(); });

function setup(tool: DrawingTool | null = null) {
  const windowListeners = new Map<string, (event: never) => void>();
  const listeners = new Map<string, (event: never) => void>();
  const frames = new Map<number, () => void>(); let nextFrame = 0;
  vi.stubGlobal("window", { addEventListener: (type: string, fn: (event: never) => void) => windowListeners.set(type, fn),
    removeEventListener: (type: string) => windowListeners.delete(type) });
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { frames.set(++nextFrame, fn); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
  const interaction = { contains: () => true, setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
    addEventListener: (type: string, fn: (event: never) => void) => listeners.set(type, fn), removeEventListener: (type: string) => listeners.delete(type) };
  const bars = Array.from({ length: 5 }, (_, index) => ({ timestamp: `2026-10-01T00:0${index}:00.000Z`,
    bucketEnd: `2026-10-01T00:0${index + 1}:00.000Z`, firstSequence: index, lastSequence: index }));
  const timeline = new DrawingTimelineLocator(); timeline.setTimeline(bars, 60);
  const chart = { timeScale: () => ({ width: () => 500, coordinateToLogical: (x: number) => (x - 100) / 10,
    logicalToCoordinate: (index: number) => index * 10 + 100 }), panes: () => [{ getHeight: () => 300 }], applyOptions: vi.fn() };
  const arrow = { getDrawingCoordinates: () => ({ x: 120, y: 100 }), hitTestAt: vi.fn(() => ({ drawingId: "arrow", part: "arrow", priority: 1, distance: 0 })) };
  const abcd = { getDrawingCoordinates: () => ({ a: { x: 100, y: 100 }, b: { x: 120, y: 120 }, c: { x: 140, y: 110 } }),
    hitTestAt: vi.fn((): AbcdHit | null => null) };
  const core = {
    visibilityScope: "scope", containerRef: ref({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }), interactionRef: ref(interaction),
    chartRef: ref(chart), candleRef: ref({ coordinateToPrice: (y: number) => y, priceToCoordinate: (price: number) => price }),
    lineTargetsRef: ref(new Map()), rectanglePrimitiveRef: ref(null), trendLinePrimitiveRef: ref(null), fibonacciPrimitiveRef: ref(null),
    textPrimitiveRef: ref(null), textEditRef: ref(null), textClicks: ref({ clear: vi.fn(), released: vi.fn() }), textDragRef: ref(null),
    onPlaceTextRef: ref(vi.fn()), arrowPrimitiveRef: ref(arrow), arrowDragRef: ref<unknown>(null), onPlaceArrowRef: ref(vi.fn()),
    abcdPrimitiveRef: ref(abcd), abcdDraftRef: ref<AbcdDraft | null>(null), abcdPreviewRef: ref<AbcdPreview | null>(null), onCreateAbcdRef: ref(vi.fn()),
    barsRef: ref(bars), drawingTimelineRef: ref(timeline), drawingSessionRef: ref({ mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [0, 1, 2, 3, 4, 5, 6] }),
    measurementArmedRef: ref(false), drawingToolRef: ref<DrawingTool | null>(tool), drawingsRef: ref<MarketDrawing[]>([drawing]), drawingGroupsRef: ref({ text: [] }),
    selectedDrawingIdRef: ref<string | null>(null), onDrawingToolChangeRef: ref(vi.fn()), onSelectedDrawingIdChangeRef: ref(vi.fn()),
    onCreateDrawingRef: ref(vi.fn()), onUpdateDrawingRef: ref(vi.fn()), onDeleteDrawingRef: ref(vi.fn()), onOpenDrawingStyleRef: ref(vi.fn()),
    displayIntervalSecondsRef: ref(60), sourceIntervalSecondsRef: ref(60), setContextMenu: vi.fn(), drawingDraftRef: ref(null),
    drawingDraftCoordinateRef: ref(null), drawingPreviewRef: ref(null), syncDrawingPrimitive: vi.fn(), setChartCursor: vi.fn(), priceTickSize: 0.25,
  };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useReplayChartDrawingPointer(core as unknown as ReturnType<typeof useReplayChartCore>);
  const event = (x = 120, y = 100) => ({ clientX: x, clientY: y, pointerType: "mouse", button: 0, pointerId: 1,
    shiftKey: false, timeStamp: 100, target: { closest: () => null }, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
  const emit = (type: string, value: object) => { const fn = listeners.get(type) ?? windowListeners.get(type); if (!fn) throw new Error(`Missing listener ${type}`); fn(value as never); };
  return { core, chart, arrow, abcd, event, emit, flush, frames };
}

describe("arrow pointer interactions", () => {
  it.each(["ARROW_UP", "ARROW_DOWN"] as const)("places %s on one click and exits the tool", type => {
    const s = setup(type); s.emit("pointerdown", s.event());
    expect(s.core.onPlaceArrowRef.current).toHaveBeenCalledWith(type, { ...anchor, timestamp: "2026-10-01T00:02:00.000Z" });
    expect(s.core.drawingToolRef.current).toBeNull();
    expect(s.core.onCreateDrawingRef.current).not.toHaveBeenCalled();
  });
  it("selects on click, opens settings only on double click, and uses existing deletion", () => {
    const s = setup(); s.emit("pointerdown", s.event()); s.emit("pointerup", s.event());
    expect(s.core.onSelectedDrawingIdChangeRef.current).toHaveBeenCalledWith("arrow");
    expect(s.core.onUpdateDrawingRef.current).not.toHaveBeenCalled();
    expect(s.core.onOpenDrawingStyleRef.current).not.toHaveBeenCalled();
    s.emit("dblclick", s.event()); expect(s.core.onOpenDrawingStyleRef.current).toHaveBeenCalledWith("arrow");
    s.emit("keydown", { ...s.event(), key: "Delete", defaultPrevented: false, isComposing: false });
    expect(s.core.onDeleteDrawingRef.current).toHaveBeenCalledWith("arrow");
  });
  it("coalesces pointer moves and persists only the final geometry on release", () => {
    const s = setup(); s.emit("pointerdown", s.event());
    for (let i = 1; i <= 100; i++) s.emit("pointermove", s.event(120, 100 + i));
    expect(s.frames.size).toBe(1); expect(s.core.onUpdateDrawingRef.current).not.toHaveBeenCalled();
    s.flush();
    expect(s.core.arrowDragRef.current).toEqual({ id: "arrow", geometry: { anchor: { ...anchor, price: 200 } } });
    s.emit("pointerup", s.event(120, 205));
    expect(s.core.onUpdateDrawingRef.current).toHaveBeenCalledTimes(1);
    expect(s.core.onUpdateDrawingRef.current).toHaveBeenCalledWith("arrow", { anchor: { ...anchor, price: 205 } });
    s.flush(); expect(s.core.arrowDragRef.current).toBeNull();
  });
  it.each(["pointercancel", "blur", "Escape"])("cancels a drag on %s and restores scrolling without saving", reason => {
    const s = setup(); s.emit("pointerdown", s.event()); s.emit("pointermove", s.event(120, 160)); s.flush();
    if (reason === "Escape") s.emit("keydown", { ...s.event(), key: "Escape" }); else s.emit(reason, s.event());
    expect(s.core.arrowDragRef.current).toBeNull(); expect(s.core.onUpdateDrawingRef.current).not.toHaveBeenCalled();
    s.emit("pointerup", s.event(120, 160)); expect(s.core.onUpdateDrawingRef.current).not.toHaveBeenCalled();
    expect(s.chart.applyOptions).toHaveBeenLastCalledWith({ handleScroll: true });
  });
  it("does not schedule idle mouse movement work for arrow-only charts", () => {
    const s = setup(); for (let i = 0; i < 1000; i++) s.emit("pointermove", s.event(i, 100));
    expect(s.frames.size).toBe(0); expect(s.arrow.hitTestAt).not.toHaveBeenCalled();
  });
});

describe("AB=CD pointer interactions", () => {
  const source = (index: number, price: number) => ({ timestamp: `2026-10-01T00:0${index}:00.000Z`, sourceSequence: index, price });
  const abcdDrawing: AbcdDrawing = { ...drawing, id: "abcd", type: "AB_CD", style: DEFAULT_ABCD_STYLE,
    geometry: { a: source(0, 100), b: source(2, 120), c: source(4, 110) } };
  const dragSetup = () => {
    const s = setup(); s.core.drawingsRef.current = [abcdDrawing];
    s.arrow.hitTestAt.mockReturnValue(null as never);
    s.abcd.hitTestAt.mockReturnValue({ drawingId: "abcd", part: "line", priority: 1, distance: 0 });
    return s;
  };
  it("previews A-B and then C, creating only on the third click", () => {
    const s = setup("AB_CD"); s.emit("pointerdown", s.event(100, 100));
    for (let i = 0; i < 100; i++) s.emit("pointermove", s.event(120, 120));
    expect(s.frames.size).toBe(1); s.flush();
    expect(s.core.abcdDraftRef.current?.stage).toBe("b");
    expect(s.core.onCreateAbcdRef.current).not.toHaveBeenCalled();
    s.emit("pointerdown", s.event(120, 120));
    expect(s.core.abcdDraftRef.current?.stage).toBe("c");
    s.emit("pointermove", s.event(140, 110)); s.flush();
    expect(s.core.onCreateAbcdRef.current).not.toHaveBeenCalled();
    s.emit("pointerdown", s.event(140, 110));
    expect(s.core.onCreateAbcdRef.current).toHaveBeenCalledTimes(1);
    expect(s.core.onCreateAbcdRef.current).toHaveBeenCalledWith(abcdDrawing.geometry);
    expect(s.core.abcdDraftRef.current).toBeNull(); expect(s.core.drawingToolRef.current).toBeNull();
    expect(s.core.onCreateDrawingRef.current).not.toHaveBeenCalled();
  });
  it("cancels either placement stage on Escape without creating an object", () => {
    const s = setup("AB_CD"); s.emit("pointerdown", s.event(100, 100)); s.emit("pointerdown", s.event(120, 120));
    s.emit("keydown", { ...s.event(), key: "Escape" });
    expect(s.core.abcdDraftRef.current).toBeNull(); expect(s.core.drawingToolRef.current).toBeNull();
    expect(s.core.onCreateAbcdRef.current).not.toHaveBeenCalled();
  });
  it("does not save on selection, opens settings on double click, and commits one final drag update", () => {
    const s = dragSetup(); s.emit("pointerdown", s.event(130, 110)); s.emit("pointerup", s.event(130, 110)); s.flush();
    expect(s.core.onUpdateDrawingRef.current).not.toHaveBeenCalled();
    s.emit("dblclick", s.event()); expect(s.core.onOpenDrawingStyleRef.current).toHaveBeenCalledWith("abcd");
    s.emit("pointerdown", s.event(130, 110));
    for (let i = 1; i <= 100; i++) s.emit("pointermove", s.event(130, 110 + i));
    expect(s.frames.size).toBe(1); s.flush();
    expect(s.core.onUpdateDrawingRef.current).not.toHaveBeenCalled();
    s.emit("pointerup", s.event(130, 215));
    expect(s.core.onUpdateDrawingRef.current).toHaveBeenCalledTimes(1);
    expect(s.core.onUpdateDrawingRef.current).toHaveBeenCalledWith("abcd", {
      a: source(0, 205), b: source(2, 225), c: source(4, 215),
    });
    s.flush(); expect(s.core.abcdPreviewRef.current).toBeNull();
  });
  it.each(["Escape", "blur", "pointercancel"])("cancels dragging on %s", key => {
    const s = dragSetup(); s.emit("pointerdown", s.event()); s.emit("pointermove", s.event(120, 170)); s.flush();
    if (key === "Escape") s.emit("keydown", { ...s.event(), key }); else s.emit(key, s.event());
    expect(s.core.abcdPreviewRef.current).toBeNull();
    s.emit("pointerup", s.event(120, 170)); expect(s.core.onUpdateDrawingRef.current).not.toHaveBeenCalled();
  });
  it("moves one selected control point, preserving the other two, and uses existing Delete", () => {
    const s = dragSetup(); s.abcd.hitTestAt.mockReturnValue({ drawingId: "abcd", part: "b", priority: 2, distance: 0 });
    s.emit("pointerdown", s.event(120, 120)); s.emit("pointerup", s.event(120, 130));
    expect(s.core.onUpdateDrawingRef.current).toHaveBeenCalledWith("abcd", { ...abcdDrawing.geometry, b: source(2, 130) });
    s.emit("keydown", { ...s.event(), key: "Delete" }); expect(s.core.onDeleteDrawingRef.current).toHaveBeenCalledWith("abcd");
    effects.cleanup?.(); effects.cleanup = null; expect(s.frames.size).toBe(0);
  });
  it("leaves idle pointer movement unscheduled", () => {
    const s = dragSetup(); for (let i = 0; i < 1000; i++) s.emit("pointermove", s.event());
    expect(s.frames.size).toBe(0); expect(s.abcd.hitTestAt).not.toHaveBeenCalled();
  });
});
