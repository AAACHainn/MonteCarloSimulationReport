import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/i18n";
import { CANDLESTICK_COLOR_PRESETS, DEFAULT_CANDLESTICK_STYLE, applyCandlestickColorPreset, type CandlestickStyle } from "@/lib/market-replay/candlestick-style";
import { CandlestickSettingsDialog } from "./candlestick-settings-dialog";

vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useId: () => "candle-test" }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: (props: object) => React.createElement("dialog", props) }));

type Element = { type: unknown; props: Record<string, unknown> };
function all(node: unknown): Element[] {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(all);
  const element = node as Element;
  if (typeof element.type === "function") return [element, ...all((element.type as (props: Record<string, unknown>) => unknown)(element.props))];
  // Button and Input use forwardRef; keep their props available for interaction checks.
  return [element, ...all(element.props?.children)];
}
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return node && typeof node === "object" ? textOf((node as Element).props?.children) : "";
}
let draft: CandlestickStyle;
let onConfirm: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
function render() {
  return all(CandlestickSettingsDialog({ open: true, draft, onDraftChange: next => { draft = next; }, onConfirm, onClose }));
}
function button(label: string) {
  return render().find(element => element.props.onClick && textOf(element.props.children) === label)!;
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  draft = { ...DEFAULT_CANDLESTICK_STYLE };
  onConfirm = vi.fn(); onClose = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("candlestick settings dialog", () => {
  it("updates only the draft from presets and visibility controls until confirmation", () => {
    draft.wickVisible = false;
    (button(copy.marketReplay.candlestickPresetNames.monochrome).props.onClick as () => void)();
    expect(draft).toMatchObject({ upColor: "#FFFFFF", borderUpColor: "#334155", wickVisible: false });
    const checkbox = render().find(element => element.props.id === "candle-test-bodyVisible" && element.props.type === "checkbox")!;
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: false } });
    expect(draft.bodyVisible).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
    (button(copy.marketReplay.drawingConfirm).props.onClick as () => void)();
    expect(onConfirm).toHaveBeenCalledWith(draft);
    expect(onConfirm.mock.calls[0][0]).not.toBe(draft);
  });

  it("shows matching selection and switches to custom after an individual color change", () => {
    draft = applyCandlestickColorPreset(draft, CANDLESTICK_COLOR_PRESETS[1]);
    expect(button(copy.marketReplay.candlestickPresetNames["green-up"]).props["aria-pressed"]).toBe(true);
    const color = render().find(element => element.props.id === "candle-test-upColor" && element.props.type === "color")!;
    (color.props.onInput as (event: unknown) => void)({ currentTarget: { value: "#abcdef" } });
    expect(draft.upColor).toBe("#ABCDEF");
    expect(render().filter(element => element.props["aria-pressed"] === true)).toHaveLength(0);
    expect(render().some(element => element.props.role === "status" && textOf(element.props.children) === copy.marketReplay.candlestickCurrentStyle(copy.marketReplay.candlestickCustomColors))).toBe(true);
  });

  it("reflects hidden parts in the preview and labels all six color controls", () => {
    draft.bodyVisible = false; draft.borderVisible = false; draft.wickVisible = false;
    const nodes = render();
    const svgs = nodes.filter(element => element.type === "svg");
    expect(svgs).toHaveLength(5);
    const preview = all(svgs[4]);
    expect(preview.filter(element => element.type === "path")).toHaveLength(0);
    expect(preview.filter(element => element.type === "rect").every(element => element.props.fill === "none" && element.props.stroke === "none")).toBe(true);
    const colors = nodes.filter(element => element.props.type === "color");
    expect(colors).toHaveLength(6);
    expect(colors.every(color => nodes.some(element => element.type === "label" && element.props.htmlFor === color.props.id && textOf(element.props.children)))).toBe(true);
  });

  it("routes cancel and dialog dismissal to close without persisting the draft", () => {
    (button(copy.marketReplay.candlestickPresetNames["purple-gold"]).props.onClick as () => void)();
    (button(copy.marketReplay.drawingCancel).props.onClick as () => void)();
    const dialog = render().find(element => element.type === "dialog")!;
    (dialog.props.onClose as () => void)();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
