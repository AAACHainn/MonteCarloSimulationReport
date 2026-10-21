import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogLifecycle } from "./use-dialog-lifecycle";

// Exercise document-level focus and keyboard behavior without a browser runtime.
const hooks = vi.hoisted(() => ({ id: 0, effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", () => ({
  useState: () => [true, () => undefined],
  useId: () => `dialog-${++hooks.id}`,
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));

let body: { style: { overflow: string } };
let activeElement: unknown;
let listeners: Set<(event: KeyboardEvent) => void>;
let cleanups: Array<() => void>;

function control() {
  const element = { tagName: "BUTTON", initialFocus: false, hasAttribute: (name: string) => name === "data-dialog-initial-focus" && element.initialFocus,
    isConnected: true, getClientRects: () => [1], focus: vi.fn(() => { activeElement = element; }) };
  return element;
}

function DialogLifecycleHarness(modal: boolean, explicitFocus = false) {
  const previous = control();
  activeElement = previous;
  const first = control();
  const last = control();
  last.initialFocus = explicitFocus;
  const panel = {
    contains: (element: unknown) => element === first || element === last,
    querySelectorAll: () => [first, last],
    focus: vi.fn(),
  };
  const onClose = vi.fn();
  useDialogLifecycle(true, { current: panel as unknown as HTMLElement }, onClose, { modal });
  const cleanup = hooks.effects.splice(0).map((effect) => effect()).find((result) => typeof result === "function")!;
  cleanups.push(cleanup);
  return { first, last, previous, onClose, close: () => {
    const index = cleanups.indexOf(cleanup);
    if (index >= 0) { cleanups.splice(index, 1); cleanup(); }
  } };
}

function key(key: string, shiftKey = false, defaultPrevented = false, isComposing = false) {
  const event = { key, shiftKey, defaultPrevented, isComposing, preventDefault: vi.fn(() => { event.defaultPrevented = true; }) };
  for (const listener of listeners) listener(event as unknown as KeyboardEvent);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  hooks.effects = [];
  body = { style: { overflow: "auto" } };
  listeners = new Set();
  cleanups = [];
  vi.stubGlobal("document", {
    body,
    get activeElement() { return activeElement; },
    addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => listeners.delete(listener),
  });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});

afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("modal and floating dialog lifecycle", () => {
  it("focuses the explicitly marked text editor instead of the first control", () => {
    const dialog = DialogLifecycleHarness(true, true);
    vi.runAllTimers(); expect(activeElement).toBe(dialog.last);
  });
  it("keeps the dialog open while Escape belongs to the composing input method", () => {
    const dialog = DialogLifecycleHarness(true);
    key("Escape", false, false, true); expect(dialog.onClose).not.toHaveBeenCalled();
    key("Escape"); expect(dialog.onClose).toHaveBeenCalledOnce();
  });
  it("allows chart scrolling and keyboard focus outside a floating window", () => {
    const dialog = DialogLifecycleHarness(false);
    vi.runAllTimers();
    expect(activeElement).toBe(dialog.first);
    expect(body.style.overflow).toBe("auto");
    activeElement = dialog.last;
    expect(key("Tab").preventDefault).not.toHaveBeenCalled();
    const chart = control();
    activeElement = chart;
    expect(key("Tab", true).preventDefault).not.toHaveBeenCalled();
    dialog.close();
    expect(activeElement).toBe(chart);
    expect(body.style.overflow).toBe("auto");
  });

  it("restores the trigger focus when closing from inside the floating window", () => {
    const dialog = DialogLifecycleHarness(false);
    vi.runAllTimers();
    dialog.close();
    expect(activeElement).toBe(dialog.previous);
  });

  it("restores focus after the removed window has returned focus to the body", () => {
    const dialog = DialogLifecycleHarness(false);
    activeElement = body;
    dialog.close();
    expect(activeElement).toBe(dialog.previous);
  });

  it("retains scroll locking and focus trapping for ordinary dialogs", () => {
    const dialog = DialogLifecycleHarness(true);
    vi.runAllTimers();
    expect(body.style.overflow).toBe("hidden");
    activeElement = dialog.last;
    expect(key("Tab").preventDefault).toHaveBeenCalled();
    expect(activeElement).toBe(dialog.first);
    expect(key("Tab", true).preventDefault).toHaveBeenCalled();
    expect(activeElement).toBe(dialog.last);
    dialog.close();
    expect(body.style.overflow).toBe("auto");
  });

  it("releases background scrolling when a modal is hidden beneath a floating window", () => {
    const account = DialogLifecycleHarness(true);
    const check = DialogLifecycleHarness(false);
    expect(body.style.overflow).toBe("hidden");
    account.close();
    expect(body.style.overflow).toBe("auto");
    key("Escape");
    expect(check.onClose).toHaveBeenCalledOnce();
    expect(account.onClose).not.toHaveBeenCalled();
    check.close();
    expect(body.style.overflow).toBe("auto");
  });

  it("closes only the top dialog and respects Escape handled by a child control", () => {
    const check = DialogLifecycleHarness(false);
    const nested = DialogLifecycleHarness(true);
    key("Escape", false, true);
    expect(nested.onClose).not.toHaveBeenCalled();
    key("Escape");
    expect(nested.onClose).toHaveBeenCalledOnce();
    expect(check.onClose).not.toHaveBeenCalled();
    nested.close();
    key("Escape");
    expect(check.onClose).toHaveBeenCalledOnce();
  });
});
