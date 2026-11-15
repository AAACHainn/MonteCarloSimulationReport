import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ChartStyleSettingsDialog } from "./chart-style-settings-dialog";
import { chartDisplayConfig, cloneChartDisplay, type ChartDisplayConfig } from "@/lib/market-replay/chart-display";
import { copy } from "@/lib/i18n";
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useId: () => "chart-style-test" }));
vi.mock("@/components/appearance-provider", () => ({ useAppearance: () => ({ mode: "light" }) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: (props: object) => React.createElement("dialog", props) }));
vi.mock("@/components/ui/select", () => {
  const mock = (tag: string) => function MockSelect(props: object) { return React.createElement(tag, props); };
  return { Select: mock("select"), SelectContent: mock("options"), SelectTrigger: mock("select-trigger"), SelectValue: mock("select-value"), SelectItem: mock("option") };
});
type Element = { type: unknown; props: Record<string, unknown> };
function nodes(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  const e = node as Element;
  return [e, ...nodes(typeof e.type === "function" ? (e.type as (p: Record<string, unknown>) => unknown)(e.props) : e.props?.children)];
}
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return node && typeof node === "object" ? textOf((node as Element).props?.children) : "";
}
let saved: ChartDisplayConfig, draft: ChartDisplayConfig | null;
let confirm: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>;
function render() {
  return nodes(ChartStyleSettingsDialog({ open: draft !== null, draft, onDraftChange: next => { draft = next; }, onClose: close, onConfirm: confirm }));
}
function choose(type: "candlestick" | "line") {
  const choice = render().find(e => e.props.role === "radio" && textOf(e.props.children) === copy.marketReplay.chartTypes[type])!;
  (choice.props.onClick as () => void)();
}
function button(label: string) { return render().find(e => e.props.onClick && textOf(e.props.children) === label)!; }
beforeEach(() => {
  vi.stubGlobal("React", React);
  saved = chartDisplayConfig(); draft = cloneChartDisplay(saved);
  close = vi.fn(() => { draft = null; });
  confirm = vi.fn((next: ChartDisplayConfig) => { saved = next; draft = null; });
});
afterEach(() => vi.unstubAllGlobals());

describe("complete chart-style preview drafts", () => {
  it("keeps both branches while changing type, and cancels all unsaved edits", () => {
    choose("line");
    const color = render().find(e => e.props.id === "chart-style-test-color" && e.props.type === "color")!;
    (color.props.onInput as (event: unknown) => void)({ currentTarget: { value: "#123456" } });
    (render().find(e => e.type === "select")!.props.onValueChange as (value: string) => void)("open");
    choose("candlestick");
    expect(draft!.line).toEqual({ color: "#123456", priceSource: "open" });
    const up = render().find(e => e.props.id === "chart-style-test-upColor" && e.props.type === "color")!;
    (up.props.onChange as (event: unknown) => void)({ target: { value: "#ABCDEF" } });
    expect(confirm).not.toHaveBeenCalled();
    (button(copy.marketReplay.drawingCancel).props.onClick as () => void)();
    expect(saved).toEqual(chartDisplayConfig());
    expect(draft).toBeNull();
    draft = cloneChartDisplay(saved);
    expect(draft.line.priceSource).toBe("close");
  });
  it("confirms an independent full copy, including the inactive branch", () => {
    draft!.candlestickStyle.wickVisible = false;
    choose("line");
    const before = draft!;
    (button(copy.marketReplay.drawingConfirm).props.onClick as () => void)();
    expect(saved.chartType).toBe("line");
    expect(saved.candlestickStyle.wickVisible).toBe(false);
    expect(saved).not.toBe(before);
    expect(saved.line).not.toBe(before.line);
    expect(saved.candlestickStyle).not.toBe(before.candlestickStyle);
  });
  it("routes close and Escape through the same rollback callback without persisting", () => {
    choose("line");
    const dialog = render().find(e => e.type === "dialog")!;
    (dialog.props.onClose as () => void)();
    expect(close).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    expect(saved.chartType).toBe("candlestick");
  });
});
