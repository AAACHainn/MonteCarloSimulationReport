import { afterEach, expect, it, vi } from "vitest";
import { createTextClickBridge, listenForTextEditorOutside, textPointerMoved } from "./text-inline-editor-events";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup(controlled = false) {
  const listeners = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("document", {
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const inside = {}, outside = { closest: () => controlled ? {} : null };
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
it("passes settings and delete controls through so their own handlers can flush or discard", () => {
  const { finish, fire } = setup(true);
  expect(fire("pointerdown").preventDefault).not.toHaveBeenCalled();
  expect(fire("click").stopImmediatePropagation).not.toHaveBeenCalled();
  expect(finish).not.toHaveBeenCalled();
});
it("bridges a double-click from canvas to textarea without scheduling a delayed edit", () => {
  vi.useFakeTimers(); const click = createTextClickBridge();
  click.released("text", { clientX: 100, clientY: 100, timeStamp: 1000 });
  expect(vi.getTimerCount()).toBe(0);
  expect(click.consume("text", { clientX: 101, clientY: 100, timeStamp: 1200 })).toBe(true);
  expect(click.consume("text", { clientX: 101, clientY: 100, timeStamp: 1250 })).toBe(false);
});
it.each([
  ["other", 100, 100, 1100], ["text", 104, 100, 1100], ["text", 100, 100, 1501], ["text", 100, 100, 999],
])("does not treat unrelated pointers as the second text click: %j", (id, clientX, clientY, timeStamp) => {
  const click = createTextClickBridge(); click.released("text", { clientX: 100, clientY: 100, timeStamp: 1000 });
  expect(click.consume(String(id), { clientX: Number(clientX), clientY: Number(clientY), timeStamp: Number(timeStamp) })).toBe(false);
});
it("clears the handoff on cancellation or scope cleanup, and separates pointer jitter from dragging", () => {
  const pointer = { clientX: 100, clientY: 100, timeStamp: 1000 }, click = createTextClickBridge();
  click.released("text", pointer); click.clear(); expect(click.consume("text", pointer)).toBe(false);
  expect(textPointerMoved(pointer, { ...pointer, clientX: 102, clientY: 102 })).toBe(false);
  expect(textPointerMoved(pointer, { ...pointer, clientX: 104 })).toBe(true);
});
