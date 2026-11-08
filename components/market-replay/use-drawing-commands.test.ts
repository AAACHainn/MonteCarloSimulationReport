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
  useCallback: (callback: unknown) => callback,
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
beforeEach(() => {
  rt.index = 0; rt.slots = []; rt.effects = []; rt.input = rt.dialog = rt.menu = rt.recording = false; rt.history = new DrawingHistory(); listeners = new Map();
  vi.stubGlobal("window", { addEventListener: (name: string, callback: (event: never) => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) });
  vi.stubGlobal("document", { visibilityState: "visible", querySelector: () => rt.menu ? {} : null });
  vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
});
afterEach(() => { for (const value of rt.slots) (value as EffectSlot | null)?.cleanup?.(); vi.unstubAllGlobals(); });
function keyboard(code: string, extra = {}) {
  const event = { code, key: code === "Escape" ? "Escape" : code.slice(3).toLowerCase(), altKey: false, ctrlKey: true, shiftKey: false, metaKey: false,
    isComposing: false, defaultPrevented: false, repeat: false, keyCode: 0, target: null, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...extra };
  listeners.get("keydown")?.(event as never); return event;
}
function setup() {
  const fetched: RequestInit[] = [], selected = vi.fn(); let drawings: MarketDrawing[] = [structuredClone(drawing)];
  const options = { datasetId: "dataset", scope: "dataset:session:projection", drawings, selectedDrawingId: drawing.id,
    select: selected, disabled: false, editor: null,
    chartApi: { current: { previewText: vi.fn(), subscribePosition: vi.fn(), positionCopy: vi.fn((source: MarketDrawing) => structuredClone(source) as MarketDrawing | null) } },
    setDrawings: (next: MarketDrawing[] | ((old: MarketDrawing[]) => MarketDrawing[])) => { drawings = typeof next === "function" ? next(drawings) : next; options.drawings = drawings; },
    fetch: vi.fn<typeof fetch>(async (_url, init) => { fetched.push(init!); const body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ drawing: { ...drawing, ...body, id: body.clientId } }), { status: 201 }); }) };
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
    app.options.fetch.mockImplementationOnce(() => new Promise(() => {}));
    keyboard("KeyV"); keyboard("KeyV"); await flush(); expect(app.options.fetch).toHaveBeenCalledOnce();
  });
  it("does not copy without a selection, while disabled, composing or holding a pointer", () => {
    const app = setup(); listeners.get("pointerdown")?.({} as never);
    expect(keyboard("KeyC").preventDefault).not.toHaveBeenCalled(); listeners.get("pointerup")?.({} as never);
    expect(keyboard("KeyC", { isComposing: true }).preventDefault).not.toHaveBeenCalled();
    app.options.disabled = true; app.render(); expect(keyboard("KeyC").preventDefault).not.toHaveBeenCalled();
  });
});
