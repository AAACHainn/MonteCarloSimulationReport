import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDrawingShortcutRecording, recordDrawingShortcut } from "./drawing-shortcut-recorder";

let listeners: Map<string, Set<(event: never) => void>>;
let cleanup: (() => void) | undefined;
beforeEach(() => {
  listeners = new Map();
  const surface = { addEventListener: (name: string, callback: (event: never) => void) => {
    if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback);
  }, removeEventListener: (name: string, callback: (event: never) => void) => listeners.get(name)?.delete(callback) };
  vi.stubGlobal("window", surface); vi.stubGlobal("document", { ...surface, visibilityState: "visible" });
});
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });
const emit = (name: string, event: object = {}) => [...listeners.get(name) ?? []].forEach(fn => fn(event as never));
const key = (extra = {}) => ({ key: "1", code: "Digit1", repeat: false, isComposing: false, keyCode: 49,
  preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...extra });
describe("drawing shortcut recorder lifecycle", () => {
  it("captures and suppresses both phases without running page/menu shortcuts", () => {
    const onKey = vi.fn(); cleanup = recordDrawingShortcut(onKey, vi.fn());
    const event = key(); emit("keydown", event); emit("keyup", event);
    expect(onKey).toHaveBeenCalledOnce(); expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(2);
    cleanup(); expect(isDrawingShortcutRecording()).toBe(false);
  });
  it.each(["Escape", "Tab"])("cancels %s while retaining the previous binding", name => {
    const cancel = vi.fn(), onKey = vi.fn(); cleanup = recordDrawingShortcut(onKey, cancel);
    emit("keydown", key({ key: name }));
    expect(cancel).toHaveBeenCalledOnce(); expect(onKey).not.toHaveBeenCalled(); expect(isDrawingShortcutRecording()).toBe(false);
  });
  it("ignores composition, legacy IME events and repeats", () => {
    const onKey = vi.fn(); cleanup = recordDrawingShortcut(onKey, vi.fn());
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) emit("keydown", key(extra));
    expect(onKey).not.toHaveBeenCalled();
  });
  it.each(["blur", "visibilitychange"])("cancels on %s and removes listeners", reason => {
    const cancel = vi.fn(); cleanup = recordDrawingShortcut(vi.fn(), cancel);
    if (reason === "visibilitychange") Object.assign(document, { visibilityState: "hidden" });
    emit(reason); expect(cancel).toHaveBeenCalledOnce(); expect(isDrawingShortcutRecording()).toBe(false);
    expect([...listeners.values()].every(set => !set.size)).toBe(true);
  });
  it("allows only one recorder across template lists", () => {
    const oldCancel = vi.fn(); recordDrawingShortcut(vi.fn(), oldCancel);
    const next = vi.fn(); cleanup = recordDrawingShortcut(next, vi.fn());
    expect(oldCancel).toHaveBeenCalledOnce(); emit("keydown", key()); expect(next).toHaveBeenCalledOnce();
  });
});
