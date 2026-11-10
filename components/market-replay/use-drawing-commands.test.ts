import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DrawingHistory } from "@/lib/market-replay/drawing-history";
import { DEFAULT_TREND_LINE_STYLE, type MarketDrawing, type TrendLineDrawing } from "@/lib/market-replay/chart-drawings";
import { useDrawingCommands } from "./use-drawing-commands";
const rt = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as (() => void)[], input: false, dialog: false, menu: false, recording: false,
  history: null as DrawingHistory | null }));
type EffectSlot = { deps: unknown[]; cleanup?: () => void };
vi.mock("react", async original => ({ ...await original<object>(),
  useRef: (initial: unknown) => { const index = rt.index++; if (!(index in rt.slots)) rt.slots[index] = { current: initial }; return rt.slots[index]; },
  useState: (initial: unknown) => { const index = rt.index++; if (!(index in rt.slots)) rt.slots[index] = initial;
    return [rt.slots[index], (value: unknown) => { rt.slots[index] = typeof value === "function" ? value(rt.slots[index]) : value; }]; },
  useMemo: (factory: () => unknown) => { const index = rt.index++; if (!(index in rt.slots)) rt.slots[index] = factory(); return rt.slots[index]; },
  useCallback: (callback: unknown, deps: unknown[]) => {
    const index = rt.index++;
    const old = rt.slots[index] as { callback: unknown; deps: unknown[] } | undefined;
    if (old && deps.every((dep, i) => dep === old.deps[i])) return old.callback;
    rt.slots[index] = { callback, deps };
    return callback;
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useLayoutEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const index = rt.index++, old = rt.slots[index] as EffectSlot | undefined;
    if (!old || deps.some((dep, i) => dep !== old.deps[i])) rt.effects.push(() => { old?.cleanup?.(); rt.slots[index] = { deps, cleanup: effect() } });
  },
  useEffect: () => undefined,
}));
vi.mock("./replay-session-context", () => ({ useDrawingHistory: () => rt.history }));
vi.mock("./use-replay-shortcuts", () => ({ useReplayShortcuts: () => ({ platform: "windows" }) }));
vi.mock("./drawing-shortcut-recorder", () => ({ isDrawingShortcutRecording: () => rt.recording }));
vi.mock("@/lib/market-replay/keyboard-shortcuts", async original => ({ ...await original<object>(), hasVisibleReplayDialog: () => rt.dialog, isReplayShortcutInputTarget: () => rt.input }));
const drawing = { id: "source", datasetId: "dataset", type: "TREND_LINE", style: DEFAULT_TREND_LINE_STYLE,
  geometry: { start: { timestamp: "2026-11-08T00:00:00.000Z", sourceSequence: 0, price: 100 }, end: { timestamp: "2026-11-08T00:01:00.000Z", sourceSequence: 1, price: 102 } }, createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z" } as TrendLineDrawing;
let listeners: Map<string, (event: never) => void>;
class FocusTarget {
  constructor(private attributes: Record<string, string> = {}) {}
  hasAttribute(name: string) { return name in this.attributes; }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
}
const chartFocus = new FocusTarget({ "data-drawing-nudge-chart": "" });
beforeEach(() => {
  rt.index = 0; rt.slots = []; rt.effects = []; rt.input = rt.dialog = rt.menu = rt.recording = false; rt.history = new DrawingHistory(); listeners = new Map();
  vi.stubGlobal("window", { addEventListener: (name: string, callback: (event: never) => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) });
  vi.stubGlobal("document", { visibilityState: "visible", querySelector: () => rt.menu ? {} : null,
    addEventListener: (name: string, callback: (event: never) => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) });
  vi.stubGlobal("Element", FocusTarget);
  vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
});
afterEach(() => { for (const value of rt.slots) (value as EffectSlot | null)?.cleanup?.(); vi.unstubAllGlobals(); });
function keyboard(code: string, extra = {}) {
  const event = { code, key: code.startsWith("Key") ? code.slice(3).toLowerCase() : code, altKey: false, ctrlKey: true, shiftKey: false, metaKey: false,
    isComposing: false, defaultPrevented: false, repeat: false, keyCode: 0, target: null, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...extra };
  listeners.get("keydown")?.(event as never); return event;
}
function arrow(key = "ArrowUp", extra = {}) {
  return keyboard(key, { target: chartFocus, ctrlKey: false, ...extra });
}
function release(key = "ArrowUp") { listeners.get("keyup")?.({ key } as never); }
function setup() {
  const fetched: RequestInit[] = [], selected = vi.fn(); let drawings: MarketDrawing[] = [structuredClone(drawing)];
  const options = { datasetId: "dataset", scope: "dataset:session:projection", drawings, selectedDrawingId: drawing.id,
    select: selected, disabled: false, editor: null, displayKey: "60:RTH", onNudgeError: vi.fn(),
    chartApi: { current: {
      previewText: vi.fn(), subscribePosition: vi.fn(), positionCopy: vi.fn((source: MarketDrawing) => structuredClone(source) as MarketDrawing | null),
      nudgeDrawing: vi.fn((source: MarketDrawing, key: string, steps: number) => {
        if (source.type !== "TREND_LINE") return null;
        const moved = structuredClone(source);
        const delta = (key === "ArrowDown" ? -1 : 1) * steps * 0.25;
        moved.geometry.start.price += delta;
        moved.geometry.end.price += delta;
        return moved;
      }),
    } },
    setDrawings: (next: MarketDrawing[] | ((old: MarketDrawing[]) => MarketDrawing[])) => { drawings = typeof next === "function" ? next(drawings) : next; options.drawings = drawings; },
    fetch: vi.fn<typeof fetch>(async (_url, init) => {
      fetched.push(init!);
      const body = JSON.parse(String(init?.body));
      if (body.changes) return new Response(JSON.stringify({ drawings: body.changes.map((change: { after: MarketDrawing }) => change.after), deletedIds: [] }));
      return new Response(JSON.stringify({ drawing: { ...drawing, ...body, id: body.clientId } }), { status: 201 });
    }) };
  function RenderCommands() { rt.index = 0; const result = useDrawingCommands(options); const effects = rt.effects.splice(0); effects.forEach(effect => effect()); return result; }
  RenderCommands(); return { render: RenderCommands, options, fetched, selected };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
describe("drawing edit keyboard and clipboard lifecycle", () => {
  it("copies without creating and pastes immediately only at a valid pointer position", async () => {
    const app = setup(); expect(keyboard("KeyC").preventDefault).toHaveBeenCalledOnce();
    await flush(); expect(app.fetched).toHaveLength(0);
    app.options.chartApi.current.positionCopy.mockReturnValueOnce(null);
    expect(keyboard("KeyV").preventDefault).not.toHaveBeenCalled();
    await flush(); expect(app.fetched).toHaveLength(0);
    app.render(); await flush(); expect(app.fetched).toHaveLength(0);
    expect(keyboard("KeyV").preventDefault).toHaveBeenCalledOnce();
    await flush(); expect(app.fetched).toHaveLength(1); expect(app.selected).toHaveBeenCalledOnce();
    keyboard("KeyV"); await flush(); expect(app.fetched).toHaveLength(2);
    expect(JSON.parse(String(app.fetched[0].body)).clientId).not.toBe(JSON.parse(String(app.fetched[1].body)).clientId);
  });
  it("clears the internal clipboard on scope changes", async () => {
    const app = setup(); keyboard("KeyC");
    app.options.scope = "different-session"; app.render(); app.render();
    expect(keyboard("KeyV").preventDefault).not.toHaveBeenCalled();
    await flush(); expect(app.fetched).toHaveLength(0);
  });
  it.each(["input", "dialog", "menu", "recording"] as const)("preserves %s controls and never steals native copy/paste", state => {
    const app = setup(); rt[state] = true;
    expect(keyboard("KeyC").preventDefault).not.toHaveBeenCalled();
    rt[state] = false; keyboard("KeyV"); expect(app.fetched).toHaveLength(0);
  });
  it("submits a copied object's full style/content with a fresh HTTP-compatible ID and reuses it on retry", async () => {
    const app = setup(); keyboard("KeyC");
    app.options.fetch.mockRejectedValueOnce(new Error("offline"));
    keyboard("KeyV"); await flush(); expect(app.render().pasteUnconfirmed).toBe(true);
    const first = JSON.parse(String(app.options.fetch.mock.calls[0][1]?.body));
    app.options.chartApi.current.positionCopy.mockReturnValueOnce({ ...drawing, style: { ...DEFAULT_TREND_LINE_STYLE, width: 4 } });
    keyboard("KeyV"); await flush();
    const second = JSON.parse(String(app.options.fetch.mock.calls[1][1]?.body));
    expect(second).toEqual(first); expect(first.clientId).toMatch(/^[0-9a-f-]{36}$/); expect(first.clientId).not.toBe(drawing.id);
    expect(second.style).toEqual(DEFAULT_TREND_LINE_STYLE); expect(app.render().pasteUnconfirmed).toBe(false);
  });
  it("keeps the copied snapshot when the source is edited or deleted", async () => {
    const app = setup(); keyboard("KeyC");
    app.options.drawings = [{ ...drawing, style: { ...DEFAULT_TREND_LINE_STYLE, width: 4 } }]; app.render();
    app.options.drawings = []; app.render(); keyboard("KeyV"); await flush();
    const body = JSON.parse(String(app.fetched[0].body)); expect(body.style).toEqual(drawing.style); expect(body.geometry).toEqual(drawing.geometry);
  });
  it.each([400, 403, 404, 422])("releases an explicitly rejected paste (%i) so subsequent copy/paste and history are usable", async status => {
    const app = setup(); keyboard("KeyC");
    app.options.fetch.mockResolvedValueOnce(new Response("rejected", { status }));
    keyboard("KeyV"); await flush();
    expect(app.render().pasteUnconfirmed).toBe(false); expect(app.render().historyDisabled).toBe(false);
    expect(keyboard("KeyC").preventDefault).toHaveBeenCalledOnce(); keyboard("KeyV"); await flush();
    expect(app.options.fetch).toHaveBeenCalledTimes(2); expect(app.selected).toHaveBeenCalledOnce();
    const [first, second] = app.options.fetch.mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(second.clientId).not.toBe(first.clientId);
  });
  it.each([408, 425, 429, 500])("preserves the frozen paste across an ambiguous or temporary response (%i)", async status => {
    const app = setup(); keyboard("KeyC");
    app.options.fetch.mockResolvedValueOnce(new Response("temporary failure", { status }));
    keyboard("KeyV"); await flush(); expect(app.render().pasteUnconfirmed).toBe(true);
    keyboard("KeyV"); await flush(); expect(app.render().pasteUnconfirmed).toBe(false);
    const [first, second] = app.options.fetch.mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(second).toEqual(first);
  });
  it("does not paste without copying, while disabled or while a write is pending", async () => {
    const app = setup(); keyboard("KeyV"); await flush(); expect(app.fetched).toHaveLength(0);
    keyboard("KeyC"); app.options.disabled = true; app.render(); keyboard("KeyV"); await flush(); expect(app.fetched).toHaveLength(0);
    app.options.disabled = false; app.render();
    let acknowledge!: (response: Response) => void;
    app.options.fetch.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    keyboard("KeyV"); keyboard("KeyV"); await flush(); expect(app.options.fetch).toHaveBeenCalledOnce();
    acknowledge(new Response(JSON.stringify({ drawing }), { status: 201 }));
    await flush();
  });
  it("does not copy without a selection, while disabled, composing or holding a pointer", () => {
    const app = setup(); listeners.get("pointerdown")?.({} as never);
    expect(keyboard("KeyC").preventDefault).not.toHaveBeenCalled(); listeners.get("pointerup")?.({} as never);
    expect(keyboard("KeyC", { isComposing: true }).preventDefault).not.toHaveBeenCalled();
    app.options.disabled = true; app.render(); expect(keyboard("KeyC").preventDefault).not.toHaveBeenCalled();
  });
});

describe("drawing arrow gestures", () => {
  it("moves on initial press and repeat, then saves and undoes the whole hold as one step", async () => {
    const app = setup();
    expect(arrow().preventDefault).toHaveBeenCalledOnce();
    arrow("ArrowUp", { repeat: true });
    arrow("ArrowUp", { repeat: true });
    expect((app.render().nudgePreviews.get(drawing.id) as TrendLineDrawing).geometry.start.price).toBe(100.75);
    expect(app.options.fetch).not.toHaveBeenCalled();
    release("ArrowDown");
    expect(app.options.fetch).not.toHaveBeenCalled();
    release(); await flush();
    expect(app.options.fetch).toHaveBeenCalledOnce();
    expect(app.render().undoLabel).toContain("微调位置");
    expect(app.options.drawings[0].geometry).toEqual({ start: { ...drawing.geometry.start, price: 100.75 }, end: { ...drawing.geometry.end, price: 102.75 } });
    app.render().undo(); await flush();
    expect(app.options.drawings[0].geometry).toEqual(drawing.geometry);
    expect(app.render().undoLabel).toBeNull();
  });

  it("keeps separate undo steps for quick taps while the first write is pending", async () => {
    const app = setup();
    let acknowledge!: (response: Response) => void;
    app.options.fetch.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    const row = new FocusTarget({ "data-drawing-nudge-id": drawing.id });
    arrow("ArrowUp", { target: row }); release();
    arrow("ArrowUp", { target: row }); release();
    const first = JSON.parse(String(app.options.fetch.mock.calls[0][1]?.body)).changes[0];
    expect(app.options.fetch).toHaveBeenCalledOnce();
    expect((app.render().nudgePreviews.get(drawing.id) as TrendLineDrawing).geometry.start.price).toBe(100.5);
    const saved = vi.fn();
    const drained = app.render().flushNudges().then(saved);
    await flush();
    expect(saved).not.toHaveBeenCalled();
    acknowledge(new Response(JSON.stringify({ drawings: [first.after], deletedIds: [] })));
    await drained;
    expect(saved).toHaveBeenCalledWith(true);
    const second = JSON.parse(String(app.options.fetch.mock.calls[1][1]?.body)).changes[0];
    expect(second.before).toEqual(first.after);
    expect(second.after.geometry.start.price).toBe(100.5);
    app.render().undo(); await flush();
    expect((app.options.drawings[0] as TrendLineDrawing).geometry.start.price).toBe(100.25);
    app.render().undo(); await flush();
    expect(app.options.drawings[0].geometry).toEqual(drawing.geometry);
  });

  it("leaves modified arrows, foreign focus, editor controls and orphan repeats to their existing handlers", () => {
    const app = setup();
    for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(arrow("ArrowRight", modifiers).preventDefault).not.toHaveBeenCalled();
    }
    expect(arrow("ArrowUp", { target: new FocusTarget() }).preventDefault).not.toHaveBeenCalled();
    expect(arrow("ArrowUp", { target: new FocusTarget({ "data-drawing-nudge-id": "other" }) }).preventDefault).not.toHaveBeenCalled();
    rt.input = true;
    expect(arrow().preventDefault).not.toHaveBeenCalled();
    rt.input = false;
    arrow("ArrowUp", { repeat: true }); release();
    expect(app.options.chartApi.current.nudgeDrawing).not.toHaveBeenCalled();
  });

  it.each(["blur", "focusout", "visibilitychange", "period"])("ends a hold when interrupted by %s", async interruption => {
    const app = setup();
    arrow();
    if (interruption === "period") {
      app.options.displayKey = "300:RTH";
      app.render();
    } else {
      if (interruption === "visibilitychange") vi.stubGlobal("document", { ...document, visibilityState: "hidden" });
      listeners.get(interruption)?.({} as never);
    }
    await flush();
    expect(app.options.fetch).toHaveBeenCalledOnce();
    arrow("ArrowUp", { repeat: true }); release();
    expect(app.options.chartApi.current.nudgeDrawing).toHaveBeenCalledOnce();
    expect(app.render().nudging).toBe(false);
  });

  it("retries ambiguous delivery with the same snapshots and confirms from a refresh if needed", async () => {
    const app = setup();
    app.options.fetch.mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce(new Response(null, { status: 500 }));
    const saved = structuredClone(drawing);
    saved.geometry.start.price += 0.25;
    saved.geometry.end.price += 0.25;
    app.options.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ drawings: [saved] })));
    arrow(); release(); await flush();
    expect(app.options.fetch).toHaveBeenCalledTimes(3);
    expect(app.options.fetch.mock.calls[1][1]).toEqual(app.options.fetch.mock.calls[0][1]);
    expect(app.options.drawings[0]).toEqual(saved);
    expect(app.render().undoLabel).toContain("微调位置");
  });

  it("refreshes after a concurrent edit and discards dependent moves", async () => {
    const app = setup();
    const remote = { ...drawing, style: { ...drawing.style, width: 4 } };
    app.options.fetch.mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ drawings: [remote] })));
    arrow(); release(); arrow(); release();
    await expect(app.render().flushNudges()).resolves.toBe(false);
    expect(app.options.fetch).toHaveBeenCalledTimes(2);
    expect(app.options.fetch.mock.calls[1][0]).toBe("/api/market-datasets/dataset/drawings");
    expect(app.options.drawings[0]).toEqual(remote);
    expect(app.render().undoLabel).toBeNull();
    expect(app.render().nudgePreviews.size).toBe(0);
    expect(app.options.onNudgeError).toHaveBeenLastCalledWith(expect.stringContaining("重新读取"));
    await expect(app.render().flushNudges()).resolves.toBe(true);
  });

  it("keeps late responses and queued moves out of a new scope", async () => {
    const app = setup();
    let acknowledge!: (response: Response) => void;
    app.options.fetch.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    arrow(); release(); arrow(); release();
    app.options.scope = "another-scope";
    app.render();
    const first = JSON.parse(String(app.options.fetch.mock.calls[0][1]?.body)).changes[0];
    acknowledge(new Response(JSON.stringify({ drawings: [first.after], deletedIds: [] })));
    await flush();
    expect(app.options.fetch).toHaveBeenCalledOnce();
    expect(app.options.drawings[0]).toEqual(drawing);
    expect(app.render().undoLabel).toBeNull();
    expect(app.render().nudgePreviews.size).toBe(0);
  });
});
