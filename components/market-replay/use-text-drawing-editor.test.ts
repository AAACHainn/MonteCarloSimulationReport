import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { useTextDrawingEditor } from "./use-text-drawing-editor";
import { DEFAULT_TEXT_STYLE, type MarketDrawing, type TextDrawing } from "@/lib/market-replay/chart-drawings";

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], pending: [] as Array<() => void> }));
vi.mock("react", () => ({
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.slots)) hooks.slots[i] = initial; return [hooks.slots[i], (value: unknown) => { hooks.slots[i] = typeof value === "function" ? value(hooks.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.index++; hooks.slots[i] ??= { current: initial }; return hooks.slots[i]; },
  useCallback: (callback: unknown, dependencies: unknown[]) => {
    const i = hooks.index++, previous = hooks.slots[i] as { dependencies: unknown[]; callback: unknown } | undefined;
    if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) hooks.slots[i] = { callback, dependencies };
    return (hooks.slots[i] as { callback: unknown }).callback;
  },
  useEffect: (callback: () => (() => void) | void, dependencies: unknown[]) => {
    const i = hooks.index++, previous = hooks.slots[i] as { dependencies: unknown[]; cleanup?: () => void } | undefined;
    if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) {
      const slot = { dependencies, cleanup: undefined as (() => void) | undefined }; hooks.slots[i] = slot;
      hooks.pending.push(() => { previous?.cleanup?.(); slot.cleanup = callback() || undefined; });
    }
  },
}));
const drawing: TextDrawing = { id: "text", type: "TEXT", datasetId: "test", geometry: { anchor: { timestamp: "2026-10-01T00:00:00Z", sourceSequence: 0, price: 100 }, text: "old" }, style: DEFAULT_TEXT_STYLE, createdAt: "", updatedAt: "" };
beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.pending = []; vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }); });
afterEach(() => vi.unstubAllGlobals());
function RenderHook(scope = "A", visible = true, drawings: MarketDrawing[] = [drawing]) {
  hooks.index = 0; const value = useTextDrawingEditor(scope, visible, drawings, DEFAULT_TEXT_STYLE);
  hooks.pending.splice(0).forEach(effect => effect()); return value;
}
it("rejects stale guards after A → B → A as well as close/reopen in the same scope", () => {
  let editor = RenderHook(); editor.open(drawing, true); editor = RenderHook(); const valid = editor.guard(); expect(valid()).toBe(true);
  RenderHook("B"); RenderHook("A"); expect(valid()).toBe(false);
  editor = RenderHook(); editor.open(drawing, true); editor = RenderHook(); const closed = editor.guard(); editor.close();
  editor.open(drawing, true); expect(closed()).toBe(false);
});
it("adopts a saved ID without replacing the editor key or invalidating its pending writer", () => {
  let editor = RenderHook(); editor.place(drawing.geometry.anchor); editor = RenderHook(); const key = editor.editor!.key, guard = editor.guard();
  editor.adopt(drawing.id, key); editor = RenderHook(); expect(editor.editor?.id).toBe(drawing.id); expect(editor.editor?.key).toBe(key); expect(guard()).toBe(true);
});
it("prevents old editor cleanup from clearing a newer preview", () => {
  let editor = RenderHook(); const preview = vi.fn(); editor.apiRef.current = { previewText: preview, subscribePosition: () => () => undefined };
  editor.open(drawing, true); editor = RenderHook(); const oldKey = editor.editor!.key;
  editor.close(); editor.open(drawing, true); editor = RenderHook(); preview.mockClear();
  editor.preview(null, oldKey); expect(preview).not.toHaveBeenCalled();
  editor.preview({ id: drawing.id, geometry: drawing.geometry, style: drawing.style }, editor.editor!.key); expect(preview).toHaveBeenCalledOnce();
});
it("keeps failed exit attempts open, routes settings to the same editor and allows deliberate deletion of invalid input", async () => {
  let editor = RenderHook(); editor.open(drawing, true); editor = RenderHook();
  const control = { finish: vi.fn(async () => false), settings: vi.fn(async () => true), discard: vi.fn(async () => undefined) };
  editor.register(control, editor.editor!.key);
  expect(await editor.beforeExit()).toBe(false); expect(RenderHook().editor?.id).toBe(drawing.id);
  expect(await editor.requestSettings(drawing.id)).toBe(true); expect(control.settings).toHaveBeenCalledOnce();
  await editor.discard(drawing.id); expect(control.discard).toHaveBeenCalledOnce(); expect(RenderHook().editor).toBeNull();
});
