import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReplayChartOrderInteractions } from "./use-replay-chart-order-interactions";
vi.mock("react", () => ({ useEffect: (work: () => unknown) => work() }));

function setup() {
  const events = new Map<string, (event: unknown) => void>();
  const keys = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("window", { addEventListener: (name: string, fn: never) => keys.set(name, fn), removeEventListener: vi.fn() });
  const target = { key: "exit", price: 110, kind: "order", field: "price", orderId: "exit", rReference: { side: "BUY", entryPrice: 100, unitRisk: 5 } };
  let options = { price: 110, title: "TP1 · 4 份 · 2.00R" };
  let actions = [{ key: "exit", price: 110, y: 90, label: "4 份 · 2.00R" }];
  const line = { options: () => options, applyOptions: vi.fn(next => { options = { ...options, ...next }; }) };
  const ref = <T,>(current: T) => ({ current });
  const core = {
    containerRef: ref({ getBoundingClientRect: () => ({ top: 0 }) }),
    interactionRef: ref({ addEventListener: (name: string, fn: never) => events.set(name, fn), removeEventListener: vi.fn(), setPointerCapture: vi.fn() }),
    chartRef: ref(null), candleRef: ref({ priceToCoordinate: (price: number) => 200 - price, coordinateToPrice: (y: number) => 200 - y }),
    priceLinesRef: ref(new Map([["exit", line]])), lineTargetsRef: ref(new Map([["exit", target]])),
    lineActionsRef: ref(actions), measurementArmedRef: ref(false), drawingToolRef: ref(null), drawingDraftRef: ref(null),
    drawingPreviewRef: ref(null), measurementRef: ref(null), readOnly: false, paperBusy: false, entryCheckOpen: false, priceTickSize: 1,
    setAbrTooltip: vi.fn(), setContextMenu: vi.fn(), setChartCursor: vi.fn(), syncLineActionCoordinates: vi.fn(),
    onOrderPriceChangeRef: ref(vi.fn(async () => true)), setLineActions: (update: (old: typeof actions) => typeof actions) => { actions = update(actions); },
  };
  const RenderHook = () => useReplayChartOrderInteractions(core as unknown as Parameters<typeof useReplayChartOrderInteractions>[0], {} as Parameters<typeof useReplayChartOrderInteractions>[1]);
  RenderHook();
  const event = (y: number, button = false) => ({ clientY: y, pointerId: 1, button: 0, shiftKey: false, preventDefault: vi.fn(),
    target: { closest: (selector: string) => selector === "[data-line-drag-key]" ? { dataset: { lineDragKey: "exit" } } : button ? {} : null } });
  return { events, keys, event, line, core, options: () => options, actions: () => actions };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("moving existing order lines", () => {
  it("moves relative to the actual price when the badge was separated from a nearby line", () => {
    const s = setup();
    s.events.get("pointerdown")!(s.event(124));
    s.events.get("pointermove")!(s.event(134));
    s.events.get("pointerup")!(s.event(134));
    expect(s.core.onOrderPriceChangeRef.current).toHaveBeenCalledWith("exit", { price: 100 });
    expect(s.options().price).toBe(100);
    expect(s.actions()[0]).toMatchObject({ price: 100, y: 100 });
    expect(s.actions()[0].label).toContain("4 份");
  });
  it("restores the original price and label on pointer cancellation", () => {
    const s = setup(); s.events.get("pointerdown")!(s.event(124)); s.events.get("pointermove")!(s.event(134)); s.events.get("pointercancel")!(s.event(134));
    expect(s.options()).toEqual({ price: 110, title: "TP1 · 4 份 · 2.00R" });
    expect(s.actions()[0].label).toBe("4 份 · 2.00R");
    expect(s.core.onOrderPriceChangeRef.current).not.toHaveBeenCalled();
  });
  it("does not move an order when interacting with its TP/SL or settings buttons", () => {
    const s = setup(); s.events.get("pointerdown")!(s.event(124, true)); s.events.get("pointermove")!(s.event(134)); s.events.get("pointerup")!(s.event(134));
    expect(s.core.onOrderPriceChangeRef.current).not.toHaveBeenCalled();
  });
});
