import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/i18n";
import { DEFAULT_ABCD_STYLE } from "@/lib/market-replay/chart-drawings";
import { AbcdSettingsDialog } from "./abcd-settings-dialog";

const rt = vi.hoisted(() => ({ index: 0, slots: [] as unknown[] }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useId: () => "abcd-settings-test",
    useRef: (value: unknown) => { const index = rt.index++; if (!(index in rt.slots)) rt.slots[index] = { current: value }; return rt.slots[index]; },
    useState: (initial: unknown) => {
      const index = rt.index++;
      if (!(index in rt.slots)) rt.slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [rt.slots[index], (next: unknown) => { rt.slots[index] = typeof next === "function"
        ? (next as (previous: unknown) => unknown)(rt.slots[index]) : next; }];
    },
  };
});
vi.mock("lucide-react", () => ({ Loader2: "loader" }));
vi.mock("@/components/ui/button", () => ({ Button: (props: object) => (globalThis as typeof globalThis & { React: typeof React }).React.createElement("button", props) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: (props: object) => (globalThis as typeof globalThis & { React: typeof React }).React.createElement("dialog", props) }));
vi.mock("@/components/ui/input", () => ({ Input: (props: object) => (globalThis as typeof globalThis & { React: typeof React }).React.createElement("input", props) }));
vi.mock("@/components/ui/label", () => ({ Label: (props: object) => (globalThis as typeof globalThis & { React: typeof React }).React.createElement("label", props) }));
vi.mock("@/components/ui/style-controls", () => {
  const element = (type: string) => (props: object) => (globalThis as typeof globalThis & { React: typeof React }).React.createElement(type, props);
  return { LINE_STYLE_OPTIONS: [], StyleChoiceField: element("choice-field"), StyleColorField: element("color-field"),
    StyleLineWidthField: element("line-width-field"), StyleTemplateField: element("template-field") };
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
  if (node && typeof node === "object") return textOf((node as Element).props?.children);
  return "";
}

type Template = { id: string; name: string; style: typeof DEFAULT_ABCD_STYLE };
let draft: typeof DEFAULT_ABCD_STYLE;
let templates: Template[];
let onSave: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
let onDraftChange: ReturnType<typeof vi.fn>;
let onTemplatesChange: ReturnType<typeof vi.fn>;
function render() {
  rt.index = 0;
  return AbcdSettingsDialog({ draft, templates, onSave, onClose, onDraftChange, onTemplatesChange });
}
function elements(type: string, tree = render()) { return all(tree).filter(element => element.type === type); }
function button(label: string, tree = render()) {
  return all(tree).find(element => element.type === "button" && textOf(element.props.children) === label)!;
}
function template(style: typeof DEFAULT_ABCD_STYLE, id = "template", name = "样式") { return { id, name, style }; }
function changeName(name: string) {
  let tree = render();
  (button(copy.marketReplay.saveDrawingTemplate, tree).props.onClick as () => void)();
  tree = render();
  (elements("input", tree).find(element => element.props.id === "abcd-settings-test-name")!.props.onChange as (event: unknown) => void)({ target: { value: name } });
  tree = render();
  return elements("form", tree)[0];
}

beforeEach(() => {
  rt.index = 0; rt.slots = [];
  draft = { ...DEFAULT_ABCD_STYLE, levels: DEFAULT_ABCD_STYLE.levels.map(level => ({ ...level })) };
  templates = [];
  onSave = vi.fn(async () => true); onClose = vi.fn(); onDraftChange = vi.fn(); onTemplatesChange = vi.fn(next => { templates = next; });
  vi.stubGlobal("React", React);
});
afterEach(() => vi.unstubAllGlobals());

describe("AB=CD settings dialog", () => {
  it("exposes only shared color, line, price and C/D label controls", () => {
    const tree = render();
    expect(elements("color-field", tree)).toHaveLength(1);
    expect(elements("line-width-field", tree)).toHaveLength(1);
    expect(elements("choice-field", tree).map(field => field.props.label)).toEqual([copy.marketReplay.lineStyle]);
    expect(elements("input", tree).map(field => field.props.type)).toEqual(["checkbox", "checkbox", undefined]);
    expect(all(tree).some(element => element.props.type === "number")).toBe(false);
    expect(all(tree).some(element => element.props.children === copy.marketReplay.fibonacciLevels)).toBe(false);
    expect(all(tree).some(element => element.props.label === copy.marketReplay.fibonacciSingleColor)).toBe(false);
  });

  it("creates a normalized template, applies it to the draft and deletes it", () => {
    const selectedStyle = { ...DEFAULT_ABCD_STYLE, singleColor: "#123456", width: 3, showPrices: true,
      levels: [{ value: 0, enabled: false, color: "#FF0000" }, { value: 0.5, enabled: true, color: "#00FF00" }, { value: 1, enabled: false, color: "#0000FF" }] };
    draft = selectedStyle;
    const form = changeName("  我的 AB 样式  ");
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
    expect(onTemplatesChange).toHaveBeenCalledOnce();
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ name: "我的 AB 样式", style: { singleColor: "#123456", width: 3,
      levels: [{ value: 0, enabled: true, color: "#123456" }, { value: 1, enabled: true, color: "#123456" }] } });

    const templateField = elements("template-field")[0];
    (templateField.props.onChange as (id: string) => void)(templates[0].id);
    expect(onDraftChange).toHaveBeenLastCalledWith(templates[0].style);
    (elements("template-field")[0].props.onDelete as () => void)();
    expect(templates).toEqual([]);
  });

  it("overwrites a same-name template while preserving its identity", () => {
    templates = [template(DEFAULT_ABCD_STYLE, "existing", "已有")];
    draft = { ...DEFAULT_ABCD_STYLE, singleColor: "#456789", width: 4 };
    const form = changeName(" 已有 ");
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
    expect(onTemplatesChange).toHaveBeenCalledOnce();
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ id: "existing", name: "已有", style: { singleColor: "#456789", width: 4 } });
  });

  it("reports the template limit without mutating templates", () => {
    templates = Array.from({ length: 50 }, (_, index) => template(DEFAULT_ABCD_STYLE, `id-${index}`, `样式 ${index}`));
    const form = changeName("新样式");
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
    expect(onTemplatesChange).not.toHaveBeenCalled();
    expect(elements("p").some(element => element.props.role === "alert" && element.props.children === copy.marketReplay.drawingTemplateLimit)).toBe(true);
  });

  it("keeps the dialog open after a failed save and blocks repeated confirmation", async () => {
    let resolveSave!: (saved: boolean) => void;
    onSave.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
    const tree = render();
    const confirm = button(copy.marketReplay.drawingConfirm, tree);
    const first = (confirm.props.onClick as () => Promise<void>)();
    const repeated = (confirm.props.onClick as () => Promise<void>)();
    expect(onSave).toHaveBeenCalledOnce();
    resolveSave(false);
    await Promise.all([first, repeated]);
    expect(onClose).not.toHaveBeenCalled();
    expect(elements("p").some(element => element.props.role === "alert" && element.props.children === copy.marketReplay.drawingSaveError)).toBe(true);
  });

  it("converts a rejected save into an inline error and leaves the dialog open", async () => {
    onSave.mockRejectedValue(new Error("offline"));
    await (button(copy.marketReplay.drawingConfirm).props.onClick as () => Promise<void>)();
    expect(onClose).not.toHaveBeenCalled();
    expect(elements("p").some(element => element.props.role === "alert" && element.props.children === copy.marketReplay.drawingSaveError)).toBe(true);
  });

  it("closes only after a successful save and normalizes compatibility style", async () => {
    draft = { ...DEFAULT_ABCD_STYLE, singleColor: "#ABCDEF",
      levels: [{ value: 0, enabled: false, color: "#111111" }, { value: 0.5, enabled: true, color: "#222222" }, { value: 1, enabled: false, color: "#333333" }] };
    const tree = render();
    await (button(copy.marketReplay.drawingConfirm, tree).props.onClick as () => Promise<void>)();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ singleColor: "#ABCDEF", levels: [
      { value: 0, enabled: true, color: "#ABCDEF" }, { value: 1, enabled: true, color: "#ABCDEF" },
    ] }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
