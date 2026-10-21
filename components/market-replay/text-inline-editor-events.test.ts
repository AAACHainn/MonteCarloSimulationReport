import { afterEach, expect, it, vi } from "vitest";
import { listenForTextEditorOutside } from "./text-inline-editor-events";

afterEach(() => vi.unstubAllGlobals());
function setup() {
  const listeners = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("document", {
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const inside = {}, outside = {};
  const finish = vi.fn(), cleanup = listenForTextEditorOutside({ contains: node => node === inside } as HTMLElement, finish);
  const fire = (name: string, internal = false) => {
    const event = { target: internal ? inside : outside, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    listeners.get(name)?.(event); return event;
  };
  return { finish, fire, cleanup, listeners };
}
it("ignores the placement click that follows the pointerdown which opened the editor", () => {
  const { finish, fire } = setup();
  expect(fire("click").preventDefault).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
  fire("pointerdown"); fire("click"); expect(finish).toHaveBeenCalledTimes(1);
  fire("click"); expect(finish).toHaveBeenCalledTimes(1);
});
it("preserves input selection and settings clicks, consumes a complete outside click before finishing", () => {
  const { finish, fire } = setup();
  expect(fire("pointerdown", true).preventDefault).not.toHaveBeenCalled(); fire("click", true);
  fire("click"); expect(finish).not.toHaveBeenCalled();
  expect(fire("pointerdown").stopImmediatePropagation).toHaveBeenCalledTimes(1);
  expect(fire("click").stopImmediatePropagation).toHaveBeenCalledTimes(1); expect(finish).toHaveBeenCalledTimes(1);
});
it("cancels interrupted gestures and removes every listener on close", () => {
  const { finish, fire, cleanup, listeners } = setup();
  fire("pointerdown"); fire("pointercancel"); fire("click"); expect(finish).not.toHaveBeenCalled();
  cleanup(); expect(listeners.size).toBe(0);
});
