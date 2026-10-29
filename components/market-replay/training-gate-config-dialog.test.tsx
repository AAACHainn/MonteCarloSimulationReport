import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/i18n";
import { defaultTrainingGate, type TrainingGateState } from "@/lib/paper-trading/training-gate";
import { TrainingGateConfigDialog } from "./training-gate-config-dialog";

const rt = vi.hoisted(() => ({ index: 0, slots: [] as unknown[] }));
vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"),
  useRef: (value: unknown) => {
    const index = rt.index++;
    if (!(index in rt.slots)) rt.slots[index] = { current: value };
    return rt.slots[index];
  },
  useState: (initial: unknown) => {
    const index = rt.index++;
    if (!(index in rt.slots)) rt.slots[index] = initial;
    return [rt.slots[index], (next: unknown) => { rt.slots[index] = next; }];
  },
}));
vi.mock("@/components/ui/dialog", () => ({ Dialog: (props: object) => React.createElement("dialog", props) }));
vi.mock("@/components/ui/select", () => {
  const element = (tag: string) => function MockSelectElement(props: object) { return React.createElement(tag, props); };
  return { Select: element("select"), SelectContent: element("select-content"), SelectItem: element("option"), SelectTrigger: element("select-trigger"), SelectValue: element("select-value") };
});

type Element = { type: unknown; props: Record<string, unknown> };
function all(node: unknown): Element[] {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(all);
  const element = node as Element;
  if (typeof element.type === "function") return [element, ...all((element.type as (props: Record<string, unknown>) => unknown)(element.props))];
  return [element, ...all(element.props?.children)];
}
function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return node && typeof node === "object" ? textOf((node as Element).props?.children) : "";
}
let gate: TrainingGateState;
let busy: boolean;
let error: string | null;
let onSave: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
function render() {
  rt.index = 0;
  return all(TrainingGateConfigDialog({ gate, busy, error, onSave, onClose }));
}
function input(id: string) { return render().find(element => element.props.id === id && element.props.type === "number")!; }
function toggle() { return render().find(element => element.props.id === "gate-auto-enabled" && element.props.onCheckedChange)!; }
function button(label: string) { return render().find(element => element.props.onClick && textOf(element.props.children) === label)!; }
function change(id: string, value: string) { (input(id).props.onChange as (event: unknown) => void)({ target: { value } }); }
function setAuto(value: boolean) { (toggle().props.onCheckedChange as (value: boolean) => void)(value); }

beforeEach(() => {
  vi.stubGlobal("React", React); rt.index = 0; rt.slots = [];
  gate = defaultTrainingGate(); busy = false; error = null;
  onSave = vi.fn(async () => undefined); onClose = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("training gate configuration", () => {
  it("opens with automation off and plan selected, without saving or changing gate state", () => {
    expect(toggle().props.checked).toBe(false);
    expect(input("gate-loss-threshold").props.disabled).toBe(true);
    expect(render().find(element => element.type === "select")!.props.value).toBe("PLAN");
    expect(onSave).not.toHaveBeenCalled();
    expect(gate).toEqual(defaultTrainingGate());
  });

  it("keeps explicitly saved automatic checklist settings", () => {
    gate = { ...gate, autoEnabled: true, nextMode: "CHECKLIST", tradeCount: 5, lossThreshold: 4 };
    expect(toggle().props.checked).toBe(true);
    expect(input("gate-trade-count").props.value).toBe("5");
    expect(input("gate-loss-threshold").props.value).toBe("4");
    expect(render().find(element => element.type === "select")!.props.value).toBe("CHECKLIST");
  });

  it("submits only the edited configuration and distinguishes save from start", async () => {
    const original = { ...gate };
    change("gate-trade-count", "5"); setAuto(true); change("gate-loss-threshold", "3");
    (render().find(element => element.type === "select")!.props.onValueChange as (value: string) => void)("CHECKLIST");
    await (button(copy.trainingGate.save).props.onClick as () => Promise<void>)();
    expect(onSave).toHaveBeenLastCalledWith({ tradeCount: 5, autoEnabled: true, lossThreshold: 3, nextMode: "CHECKLIST" }, false);
    await (button(copy.trainingGate.start).props.onClick as () => Promise<void>)();
    expect(onSave).toHaveBeenLastCalledWith({ tradeCount: 5, autoEnabled: true, lossThreshold: 3, nextMode: "CHECKLIST" }, true);
    expect(gate).toEqual(original);
  });

  it("validates counts and enabled thresholds and retains the saved threshold when switched off", async () => {
    change("gate-trade-count", "0");
    expect(input("gate-trade-count").props["aria-invalid"]).toBe(true);
    expect(button(copy.trainingGate.start).props.disabled).toBe(true);
    change("gate-trade-count", "3"); setAuto(true); change("gate-loss-threshold", "");
    expect(input("gate-loss-threshold").props["aria-invalid"]).toBe(true);
    expect(button(copy.trainingGate.save).props.disabled).toBe(true);
    await (button(copy.trainingGate.save).props.onClick as () => Promise<void>)();
    expect(onSave).not.toHaveBeenCalled();
    setAuto(false);
    expect(input("gate-loss-threshold").props.disabled).toBe(true);
    expect(input("gate-loss-threshold").props["aria-invalid"]).toBe(false);
    expect(button(copy.trainingGate.save).props.disabled).toBe(false);
    await (button(copy.trainingGate.save).props.onClick as () => Promise<void>)();
    expect(onSave).toHaveBeenCalledWith({ tradeCount: 3, autoEnabled: false, lossThreshold: 2, nextMode: "PLAN" }, false);
  });

  it("locks a running gate, preserves its progress and prevents a programmatic save", () => {
    gate = { ...gate, active: true, activeMode: "CHECKLIST", targetCount: 5, completedCount: 2 };
    expect(toggle().props.disabled).toBe(true);
    expect(input("gate-trade-count").props.disabled).toBe(true);
    expect(render().find(element => element.type === "select")!.props.disabled).toBe(true);
    expect(render().some(element => element.props.onClick && textOf(element.props.children) === copy.trainingGate.start)).toBe(false);
    expect(render().some(element => textOf(element.props.children) === copy.trainingGate.progress(2, 5))).toBe(true);
  });

  it("prevents duplicate saves and dismissal while awaiting the parent save", async () => {
    let resolve!: () => void;
    onSave.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const save = button(copy.trainingGate.start);
    (save.props.onClick as () => void)(); (save.props.onClick as () => void)();
    (render().find(element => element.type === "dialog")!.props.onClose as () => void)();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    resolve(); await Promise.resolve(); await Promise.resolve();
    (button(copy.common.cancel).props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks edits and closing while busy, and exposes server errors without discarding the draft", () => {
    change("gate-trade-count", "5"); busy = true; error = copy.trainingGate.failed;
    expect(toggle().props.disabled).toBe(true);
    expect(button(copy.common.cancel).props.disabled).toBe(true);
    (render().find(element => element.type === "dialog")!.props.onClose as () => void)();
    expect(onClose).not.toHaveBeenCalled();
    expect(render().some(element => element.props.role === "alert" && element.props.children === error)).toBe(true);
    busy = false;
    expect(input("gate-trade-count").props.value).toBe("5");
  });

  it("cancels a modified draft without saving", () => {
    setAuto(true); change("gate-trade-count", "5");
    (button(copy.common.cancel).props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledOnce(); expect(onSave).not.toHaveBeenCalled();
    expect(gate).toEqual(defaultTrainingGate());
  });
});
