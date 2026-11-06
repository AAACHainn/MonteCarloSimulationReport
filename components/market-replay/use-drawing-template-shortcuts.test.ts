import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ABCD_STYLE, DEFAULT_ARROW_STYLES, DEFAULT_FIBONACCI_RETRACEMENT_STYLE, DEFAULT_RECTANGLE_STYLE, DEFAULT_TEXT_STYLE, DEFAULT_TREND_LINE_STYLE, type DrawingType, type MarketDrawing, type MarketDrawingStyle } from "@/lib/market-replay/chart-drawings";
import { useDrawingTemplateShortcuts } from "./use-drawing-template-shortcuts";

const rt = vi.hoisted(() => ({ cleanup: null as (() => void) | null, dialog: false, input: false, overlay: false, recording: false,
  bindings: {} as Record<string, Record<string, object>> }));
vi.mock("react", () => ({ useRef: (current: unknown) => ({ current }), useLayoutEffect: (effect: () => () => void) => { rt.cleanup = effect(); } }));
vi.mock("./use-replay-shortcuts", () => ({ useReplayShortcuts: () => ({ platform: "windows" }) }));
vi.mock("./use-drawing-template-bindings", () => ({ useDrawingTemplateBindings: () => rt.bindings }));
vi.mock("./drawing-shortcut-recorder", () => ({ isDrawingShortcutRecording: () => rt.recording }));
vi.mock("@/lib/market-replay/keyboard-shortcuts", async original => ({ ...await original<object>(),
  hasVisibleReplayDialog: () => rt.dialog, isReplayShortcutInputTarget: () => rt.input }));
const binding = { code: "Digit1", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false };
let listeners: Map<string, (event: never) => void>;
beforeEach(() => {
  rt.dialog = rt.input = rt.overlay = rt.recording = false; rt.bindings = {};
  listeners = new Map();
  vi.stubGlobal("window", { addEventListener: (name: string, fn: (event: never) => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) });
  vi.stubGlobal("document", { visibilityState: "visible", querySelector: () => rt.overlay ? {} : null });
});
afterEach(() => { rt.cleanup?.(); vi.unstubAllGlobals(); });
const event = (extra = {}) => ({ ...binding, key: "1", target: null, defaultPrevented: false, isComposing: false, keyCode: 49,
  repeat: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...extra });
const emit = (name: string, e: object = {}) => listeners.get(name)?.(e as never);
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function Setup(extra: Partial<Parameters<typeof useDrawingTemplateShortcuts>[0]> = {}, type: DrawingType = "TREND_LINE", style: MarketDrawingStyle = DEFAULT_TREND_LINE_STYLE) {
  rt.bindings[type] = { template: binding };
  const apply = vi.fn(async () => true);
  const drawing = { id: "drawing", type, geometry: { untouched: true }, style } as unknown as MarketDrawing;
  const options = { drawings: [drawing], selectedDrawingId: drawing.id, templates: { [type]: [{ id: "template", name: "样式", style }] },
    scope: "dataset:session:projection", disabled: false, drawingTool: null, apply, ...extra };
  useDrawingTemplateShortcuts(options);
  return { apply, drawing };
}
describe("selected drawing template application", () => {
  it.each([
    ["TREND_LINE", DEFAULT_TREND_LINE_STYLE], ["RECTANGLE", DEFAULT_RECTANGLE_STYLE], ["TEXT", DEFAULT_TEXT_STYLE],
    ["FIB_RETRACEMENT", DEFAULT_FIBONACCI_RETRACEMENT_STYLE], ["AB_CD", DEFAULT_ABCD_STYLE],
    ["ARROW_UP", DEFAULT_ARROW_STYLES.ARROW_UP], ["ARROW_DOWN", DEFAULT_ARROW_STYLES.ARROW_DOWN],
  ] as const)("applies only the selected %s object's style", async (type, style) => {
    const { apply, drawing } = Setup({}, type, style); const key = event(); emit("keydown", key); await flush();
    expect(apply).toHaveBeenCalledOnce(); expect(apply.mock.calls[0]).toEqual(["drawing", style]);
    expect(key.preventDefault).toHaveBeenCalledOnce(); expect(key.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(drawing.geometry).toEqual({ untouched: true });
  });
  it.each(["dialog", "input", "overlay", "recording"] as const)("keeps %s controls in charge", async state => {
    const { apply } = Setup(); rt[state] = true; const key = event(); emit("keydown", key); await flush();
    expect(apply).not.toHaveBeenCalled(); expect(key.preventDefault).not.toHaveBeenCalled();
  });
  it.each([{ disabled: true }, { selectedDrawingId: null }, { drawingTool: "RECTANGLE" as const }, { templates: {} }])("does not apply outside the active selection: %j", async extra => {
    const { apply } = Setup(extra); emit("keydown", event()); await flush(); expect(apply).not.toHaveBeenCalled();
  });
  it.each([{ repeat: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { altKey: false }, { code: "Digit2" }])("ignores repeats, IME and nonmatches: %j", async extra => {
    const { apply } = Setup(); emit("keydown", event(extra)); await flush(); expect(apply).not.toHaveBeenCalled();
  });
  it("protects a drag, releases on pointerup and submits only once while saving", async () => {
    let finish!: (ok: boolean) => void;
    const apply = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })); Setup({ apply });
    emit("pointerdown"); emit("keydown", event()); await flush(); expect(apply).not.toHaveBeenCalled();
    emit("pointerup"); emit("keydown", event()); emit("keydown", event()); await flush(); expect(apply).toHaveBeenCalledOnce();
    finish(false); await flush(); emit("keydown", event()); await flush(); expect(apply).toHaveBeenCalledTimes(2);
    finish(true); await flush();
  });
  it("ignores a reserved stale binding and a mismatched template style", async () => {
    const { apply } = Setup(); rt.bindings.TREND_LINE.template = { ...binding, code: "KeyT" };
    emit("keydown", event({ code: "KeyT", key: "t" })); await flush(); expect(apply).not.toHaveBeenCalled();
    rt.cleanup?.(); Setup({}, "RECTANGLE", DEFAULT_TREND_LINE_STYLE); emit("keydown", event()); await flush(); expect(apply).not.toHaveBeenCalled();
  });
  it("cleans listeners when a session/projection scope is replaced", () => {
    Setup(); rt.cleanup?.(); expect(listeners.size).toBe(0);
  });
});
