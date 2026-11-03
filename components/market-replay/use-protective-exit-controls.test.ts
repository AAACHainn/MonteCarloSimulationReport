import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProtectiveExitControls } from "./use-protective-exit-controls";
import type { PaperOrderData, PaperSessionSnapshot } from "@/lib/paper-trading/types";

const rt = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as Array<() => void> }));
vi.mock("react", () => ({
  useRef: (initial: unknown) => { const i = rt.index++; return rt.slots[i] ??= { current: initial }; },
  useState: (initial: unknown) => { const i = rt.index++; if (!(i in rt.slots)) rt.slots[i] = initial;
    return [rt.slots[i], (value: unknown) => { rt.slots[i] = typeof value === "function" ? (value as (old: unknown) => unknown)(rt.slots[i]) : value; }]; },
  useCallback: (fn: unknown, deps: unknown[]) => { const i = rt.index++; const old = rt.slots[i] as { value: unknown; deps: unknown[] } | undefined;
    if (!old || deps.some((d, n) => d !== old.deps[n])) rt.slots[i] = { value: fn, deps }; return (rt.slots[i] as { value: unknown }).value; },
  useEffect: (effect: () => void, deps: unknown[]) => { const i = rt.index++; const old = rt.slots[i] as unknown[] | undefined;
    if (!old || deps.some((d, n) => d !== old[n])) { rt.slots[i] = deps; rt.effects.push(effect); } },
}));
const target: PaperOrderData = { id: "target", side: "SELL", type: "LIMIT", price: 120, quantity: 10, status: "PENDING",
  riskAmount: null, stopLoss: null, takeProfit: null, reduceOnly: true, isProtective: true, ocoGroupId: "main",
  createdSequence: 0, activeFromSequence: 1, filledSequence: null, filledAt: null, filledPrice: null, cancelReason: null };
const snapshot = { session: { netQuantity: 10 }, activeOrders: [target] } as PaperSessionSnapshot;
function setup() {
  const listeners = new Map<string, (event: { key: string; preventDefault: () => void }) => void>();
  vi.stubGlobal("window", { addEventListener: (name: string, fn: never) => listeners.set(name, fn), removeEventListener: vi.fn() });
  // Ordinary HTTP must not need crypto.randomUUID to create an exit.
  vi.stubGlobal("crypto", {});
  const capture = { held: false, setPointerCapture: vi.fn(() => { capture.held = true; }), hasPointerCapture: () => capture.held,
    releasePointerCapture: vi.fn(() => { capture.held = false; }) };
  const core = {
    visibilityScope: "scope", readOnly: false, paperBusy: false, entryCheckOpen: false, draft: null, paperSnapshot: snapshot,
    onCreatePartialExit: vi.fn(async () => true), onPrepareProtectiveEdit: vi.fn(async () => snapshot),
    onOrderPriceChangeRef: { current: vi.fn(async () => true) }, setProtectiveEditing: vi.fn(), setContextMenu: vi.fn(),
    currentPrice: 100, priceTickSize: 1, containerRef: { current: { getBoundingClientRect: () => ({ top: 0, height: 200 }) } },
    candleRef: { current: { coordinateToPrice: (y: number) => 200 - y } }, chartRef: { current: { panes: () => [{ getHeight: () => 200 }] } },
  };
  const RenderHook = () => { rt.index = 0; const result = useProtectiveExitControls(core as unknown as Parameters<typeof useProtectiveExitControls>[0]); rt.effects.splice(0).forEach(effect => effect()); return result; };
  const event = (y: number) => ({ pointerId: 1, button: 0, clientY: y, currentTarget: capture, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as Parameters<ReturnType<typeof RenderHook>["begin"]>[0];
  return { core, listeners, capture, render: RenderHook, event };
}
beforeEach(() => { rt.index = 0; rt.slots = []; rt.effects = []; });
afterEach(() => vi.unstubAllGlobals());

describe("chart partial exit controls", () => {
  it("pauses and synchronizes before opening settings", async () => {
    const s = setup(); await s.render().openSettings("target");
    expect(s.core.onPrepareProtectiveEdit).toHaveBeenCalledOnce();
    expect(s.render().selection).toMatchObject({ order: target, creating: false });
  });
  it("creates half the remaining position by dragging the TP handle, without moving its source", async () => {
    const s = setup(); let view = s.render(); view.begin(s.event(80), "target"); view.move(s.event(90));
    expect(s.render().preview).toMatchObject({ price: 110, quantity: 5, valid: true });
    view = s.render(); await view.end(s.event(90));
    expect(s.core.onCreatePartialExit).toHaveBeenCalledWith({ sourceOrderId: "target", price: 110, quantity: 5 });
    expect(target.price).toBe(120);
    expect(s.core.onOrderPriceChangeRef.current).not.toHaveBeenCalled();
    expect(s.capture.held).toBe(false);
    expect(s.render().preview).toBeNull();
  });
  it("uses the confirmed remaining quantity when an in-flight advance completes during the pause", async () => {
    const s = setup(); s.core.onPrepareProtectiveEdit.mockResolvedValue({ ...snapshot, session: { ...snapshot.session, netQuantity: 6 } });
    const view = s.render(); view.begin(s.event(80), "target"); view.move(s.event(90)); await view.end(s.event(90));
    expect(s.core.onCreatePartialExit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3 }));
  });
  it("opens settings for a click with only small pointer movement", async () => {
    const s = setup(); const view = s.render(); view.begin(s.event(80), "target"); view.move(s.event(83)); await view.end(s.event(83));
    expect(s.core.onCreatePartialExit).not.toHaveBeenCalled();
    expect(s.render().selection).not.toBeNull();
  });
  it("cancels an unfinished drag with Escape or pointer cancellation", async () => {
    for (const how of ["Escape", "pointer"]) {
      rt.index = 0; rt.slots = []; rt.effects = [];
      const s = setup(); const view = s.render(); view.begin(s.event(80), "target"); view.move(s.event(90));
      if (how === "Escape") s.listeners.get("keydown")!({ key: "Escape", preventDefault: vi.fn() }); else view.cancel();
      await view.end(s.event(90));
      expect(s.core.onCreatePartialExit).not.toHaveBeenCalled();
      expect(s.render().preview).toBeNull();
    }
  });
  it.each([110, 250])("does not create an exit at an invalid price or outside the chart: %s", async y => {
    const s = setup(); const view = s.render(); view.begin(s.event(80), "target"); view.move(s.event(y)); await view.end(s.event(y));
    expect(s.core.onCreatePartialExit).not.toHaveBeenCalled();
  });
  it("cancels stale drags on a session switch", async () => {
    const s = setup(); const view = s.render(); view.begin(s.event(80), "target"); view.move(s.event(90));
    s.core.visibilityScope = "other-session"; s.render(); await view.end(s.event(90));
    expect(s.core.onCreatePartialExit).not.toHaveBeenCalled();
    expect(s.render().selection).toBeNull();
  });
  it.each(["readOnly", "paperBusy", "entryCheckOpen"] as const)("blocks protected interactions while %s", async key => {
    const s = setup(); s.core[key] = true; const view = s.render(); view.begin(s.event(80), "target"); await view.openSettings("target");
    expect(s.core.onPrepareProtectiveEdit).not.toHaveBeenCalled();
    expect(s.core.onCreatePartialExit).not.toHaveBeenCalled();
  });
  it("saves quantity mode changes and creates precise partial exits from the settings window", async () => {
    const s = setup(); await s.render().openSettings("target");
    await s.render().save({ price: 120, quantityMode: "FIXED", quantity: 4 });
    expect(s.core.onOrderPriceChangeRef.current).toHaveBeenCalledWith("target", { price: 120, quantityMode: "FIXED", quantity: 4 });
    s.render().add(); await s.render().save({ price: 110, quantityMode: "FIXED", quantity: 3 });
    expect(s.core.onCreatePartialExit).toHaveBeenCalledWith({ sourceOrderId: "target", price: 110, quantity: 3 });
  });
});
