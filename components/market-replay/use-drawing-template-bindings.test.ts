import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rt = vi.hoisted(() => ({ subscribe: null as ((fn: () => void) => () => void) | null }));
vi.mock("react", () => ({ useSyncExternalStore: (subscribe: typeof rt.subscribe, get: () => unknown) => { rt.subscribe = subscribe; return get(); } }));
const shortcut = { code: "Digit1", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false };
let stored: Map<string, string>;
let listeners: Map<string, (event: object) => void>;
let write: ReturnType<typeof vi.fn>;
let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules(); stored = new Map(); listeners = new Map();
  write = vi.fn((key: string, value: string) => stored.set(key, value));
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: write },
    addEventListener: (key: string, fn: (event: object) => void) => listeners.set(key, fn), removeEventListener: (key: string) => listeners.delete(key) });
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); });
describe("drawing shortcut browser preferences", () => {
  it("loads without writing and persists separate type/ID bindings immediately", async () => {
    const api = await import("./use-drawing-template-bindings");
    stored.set(api.DRAWING_TEMPLATE_SHORTCUTS_KEY, JSON.stringify({ version: 1, bindings: { TREND_LINE: { a: shortcut } } }));
    expect(api.useDrawingTemplateBindings().TREND_LINE?.a).toEqual(shortcut); expect(write).not.toHaveBeenCalled();
    api.setDrawingTemplateBinding("RECTANGLE", "b", shortcut);
    expect(JSON.parse(stored.get(api.DRAWING_TEMPLATE_SHORTCUTS_KEY)!).bindings).toEqual({ TREND_LINE: { a: shortcut }, RECTANGLE: { b: shortcut } });
    api.setDrawingTemplateBinding("TREND_LINE", "a", null);
    expect(api.useDrawingTemplateBindings().TREND_LINE?.a).toBeUndefined();
    expect(api.useDrawingTemplateBindings().RECTANGLE?.b).toEqual(shortcut);
  });
  it("updates subscribers for storage changes and releases the last listener", async () => {
    const api = await import("./use-drawing-template-bindings"); api.useDrawingTemplateBindings();
    const changed = vi.fn(); cleanup = rt.subscribe!(changed);
    stored.set(api.DRAWING_TEMPLATE_SHORTCUTS_KEY, JSON.stringify({ version: 1, bindings: { ARROW_UP: { a: shortcut } } }));
    listeners.get("storage")!({ key: api.DRAWING_TEMPLATE_SHORTCUTS_KEY });
    expect(changed).toHaveBeenCalledOnce(); expect(api.useDrawingTemplateBindings().ARROW_UP?.a).toEqual(shortcut);
    cleanup(); expect(listeners.size).toBe(0);
  });
  it("retains an in-page binding if browser storage is blocked", async () => {
    const api = await import("./use-drawing-template-bindings");
    write.mockImplementation(() => { throw new Error("quota"); });
    expect(api.setDrawingTemplateBinding("TREND_LINE", "a", shortcut)).toBe(false);
    expect(api.useDrawingTemplateBindings().TREND_LINE?.a).toEqual(shortcut);
  });
  it("refreshes changes made while no replay/picker was mounted", async () => {
    const api = await import("./use-drawing-template-bindings"); api.useDrawingTemplateBindings();
    cleanup = rt.subscribe!(vi.fn()); cleanup();
    stored.set(api.DRAWING_TEMPLATE_SHORTCUTS_KEY, JSON.stringify({ version: 1, bindings: { RECTANGLE: { external: shortcut } } }));
    cleanup = rt.subscribe!(vi.fn());
    expect(api.useDrawingTemplateBindings().RECTANGLE?.external).toEqual(shortcut);
  });
});
