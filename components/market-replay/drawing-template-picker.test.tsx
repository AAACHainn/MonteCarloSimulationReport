import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingTemplatePicker } from "./drawing-template-picker";
import { copy } from "@/lib/i18n";

const rt = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], stop: vi.fn(), bind: vi.fn(),
  onKey: null as ((event: object) => void) | null, onCancel: null as (() => void) | null,
  bindings: {} as Record<string, Record<string, object>>, cleanups: [] as (() => void)[] }));
vi.mock("react", async original => ({ ...await original<object>(),
  useId: () => "picker-error", useEffect: (effect: () => void | (() => void)) => { const cleanup = effect(); if (cleanup) rt.cleanups.push(cleanup); },
  useRef: (initial: unknown) => { const index = rt.index++; if (!(index in rt.slots)) rt.slots[index] = { current: initial }; return rt.slots[index]; },
  useState: (initial: unknown) => { const index = rt.index++; if (!(index in rt.slots)) rt.slots[index] = initial;
    return [rt.slots[index], (next: unknown) => { rt.slots[index] = next; }]; },
}));
vi.mock("./use-replay-shortcuts", () => ({ useReplayShortcuts: () => ({ platform: "windows" }) }));
vi.mock("./drawing-shortcut-recorder", () => ({ recordDrawingShortcut: (key: typeof rt.onKey, cancel: typeof rt.onCancel) => {
  rt.onKey = key; rt.onCancel = cancel; return rt.stop;
} }));
vi.mock("./use-drawing-template-bindings", () => ({ useDrawingTemplateBindings: () => rt.bindings,
  setDrawingTemplateBinding: (...args: unknown[]) => rt.bind(...args) }));
type Node = { props: Record<string, unknown> };
function nodes(tree: unknown): Node[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  const node = tree as Node; return [node, ...nodes(node.props?.children)];
}
const shortcut = { code: "Digit1", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false };
const templates = [{ id: "a", name: "阻力线" }, { id: "b", name: "支撑线" }];
const onChange = vi.fn();
class TestElement {
  children = new Set<TestElement>();
  control: TestElement | null = null;
  constructor(readonly focusable = false) {}
  contains(target: TestElement) { return target === this || this.children.has(target); }
  closest(selector: string) { return selector === "label" ? this.control ? this : null : selector.includes("role=") ? null : this.focusable ? this : null; }
}
let pointerDown: ((event: object) => void) | null;
function render() { rt.index = 0; return DrawingTemplatePicker({ id: "templates", type: "TREND_LINE", value: "", templates, onChange }); }
function button(label: string) { return nodes(render()).find(node => node.props["aria-label"] === label)!; }
function click(label: string) { (button(label).props.onClick as () => void)(); }
function key(extra = {}) { return { ...shortcut, key: "1", getModifierState: () => false, ...extra }; }
beforeEach(() => {
  rt.index = 0; rt.slots = []; rt.bindings = {}; rt.cleanups = []; rt.bind.mockReset(); rt.stop.mockClear(); onChange.mockClear();
  rt.bind.mockImplementation((type: string, id: string, value: object | null) => {
    const group = rt.bindings[type] ??= {}; if (value) group[id] = value; else delete group[id]; return true;
  });
  vi.stubGlobal("React", React);
  pointerDown = null;
  vi.stubGlobal("Node", TestElement); vi.stubGlobal("Element", TestElement);
  vi.stubGlobal("window", {
    addEventListener: vi.fn((name: string, callback: (event: object) => void) => { if (name === "pointerdown") pointerDown = callback; }),
    removeEventListener: vi.fn((name: string, callback: (event: object) => void) => { if (name === "pointerdown" && pointerDown === callback) pointerDown = null; }),
  });
});
afterEach(() => { rt.cleanups.forEach(fn => fn()); vi.unstubAllGlobals(); });
describe("template picker binding controls", () => {
  it("records a key without selecting/applying the template, and changes plus to minus", () => {
    click("设置快捷键：阻力线"); render();
    rt.onKey!(key());
    expect(rt.bind).toHaveBeenCalledWith("TREND_LINE", "a", shortcut); expect(onChange).not.toHaveBeenCalled();
    expect(button("清除快捷键：阻力线")).toBeTruthy(); expect(rt.stop).toHaveBeenCalled();
    click("清除快捷键：阻力线"); expect(rt.bind).toHaveBeenLastCalledWith("TREND_LINE", "a", null);
    expect(button("设置快捷键：阻力线")).toBeTruthy(); expect(templates).toHaveLength(2);
  });
  it("rejects duplicate bindings only within the current drawing type and keeps recording", () => {
    rt.bindings = { TREND_LINE: { b: shortcut } }; click("设置快捷键：阻力线"); render(); rt.onKey!(key());
    expect(rt.bind).not.toHaveBeenCalled();
    expect(nodes(render()).some(node => node.props.role === "alert" && node.props.children === copy.marketReplay.templateShortcuts.templateConflict("支撑线"))).toBe(true);
    rt.onKey!(key({ code: "Digit2", key: "2" })); expect(rt.bind).toHaveBeenCalledOnce();
  });
  it("retains an old binding until a valid replacement is captured", () => {
    rt.bindings = { TREND_LINE: { a: shortcut } }; click("重新录入快捷键：阻力线"); render();
    rt.onKey!(key({ code: "KeyT", key: "t" })); expect(rt.bind).not.toHaveBeenCalled();
    rt.onCancel!(); render(); expect(rt.bindings.TREND_LINE.a).toEqual(shortcut);
  });
  it("supports free physical combinations and does not bind bare modifiers", () => {
    click("设置快捷键：阻力线"); render(); rt.onKey!(key({ code: "AltLeft", key: "Alt" }));
    expect(rt.bind).not.toHaveBeenCalled();
    rt.onKey!(key({ code: "KeyJ", key: "j", ctrlKey: true, shiftKey: true }));
    expect(rt.bind).toHaveBeenCalledWith("TREND_LINE", "a", { ...shortcut, code: "KeyJ", ctrlKey: true, shiftKey: true });
  });
  it("stops recording when the picker closes and allows selecting a template independently", () => {
    click("设置快捷键：阻力线"); render();
    (nodes(render()).find(node => node.props.onOpenChange)!.props.onOpenChange as (open: boolean) => void)(false);
    expect(rt.stop).toHaveBeenCalled();
    const row = nodes(render()).find(node => node.props.title === "支撑线")!;
    (row.props.onClick as () => void)(); expect(onChange).toHaveBeenCalledWith("b"); expect(rt.bind).not.toHaveBeenCalled();
  });
  it.each([false, true])("dismisses on an outside pointer, cancels recording and preserves a binding (focusable=%s)", focusable => {
    rt.bindings = { TREND_LINE: { a: shortcut } };
    (nodes(render()).find(node => node.props.onOpenChange)!.props.onOpenChange as (open: boolean) => void)(true);
    render(); click("重新录入快捷键：阻力线"); render();
    const event = { target: new TestElement(focusable), preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    pointerDown!(event);
    const tree = nodes(render());
    expect(tree.find(node => node.props.onOpenChange)!.props.open).toBe(false);
    expect(rt.stop).toHaveBeenCalled(); expect(rt.bind).not.toHaveBeenCalled();
    expect(rt.bindings.TREND_LINE.a).toEqual(shortcut);
    expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    const focus = { preventDefault: vi.fn() };
    (tree.find(node => node.props["data-drawing-template-picker"])!.props.onCloseAutoFocus as (event: object) => void)(focus);
    expect(focus.preventDefault).toHaveBeenCalledTimes(focusable ? 1 : 0);
    expect(window.addEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
  });
  it("keeps the list open for pointers inside its content or trigger", () => {
    (nodes(render()).find(node => node.props.onOpenChange)!.props.onOpenChange as (open: boolean) => void)(true);
    const tree = nodes(render());
    const content = new TestElement(), trigger = new TestElement(true), row = new TestElement(); content.children.add(row);
    (tree.find(node => node.props["data-drawing-template-picker"])!.props.ref as { current: unknown }).current = content;
    (tree.find(node => node.props.id === "templates")!.props.ref as { current: unknown }).current = trigger;
    const label = new TestElement(); label.control = trigger;
    pointerDown!({ target: row }); pointerDown!({ target: trigger }); pointerDown!({ target: label });
    expect(nodes(render()).find(node => node.props.onOpenChange)!.props.open).toBe(true);
    expect(rt.bind).not.toHaveBeenCalled();
  });
});
