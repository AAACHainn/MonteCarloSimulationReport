import { describe, expect, it } from "vitest";
import { DEFAULT_ABCD_STYLE, DEFAULT_FIBONACCI_RETRACEMENT_STYLE, DEFAULT_TREND_LINE_STYLE } from "./chart-drawings";
import { drawingShortcutConflict, drawingTemplateShortcut, drawingTemplateStyle, formatDrawingTemplateShortcut, parseDrawingTemplateBindings, sameDrawingTemplateShortcut } from "./drawing-template-shortcuts";

const event = { key: "1", code: "Digit1", ctrlKey: false, altKey: true, shiftKey: false, metaKey: false };
const shortcut = drawingTemplateShortcut(event)!;
describe("drawing template shortcut normalization and conflicts", () => {
  it("uses physical keys, separates the keypad and supports nonnumeric combinations", () => {
    expect(drawingTemplateShortcut({ ...event, key: "¡" })).toEqual(shortcut);
    expect(sameDrawingTemplateShortcut(shortcut, drawingTemplateShortcut({ ...event, code: "Numpad1" })!)).toBe(false);
    expect(formatDrawingTemplateShortcut(shortcut, "windows")).toBe("Alt+1");
    expect(formatDrawingTemplateShortcut(shortcut, "mac")).toBe("Option+1");
    const other = drawingTemplateShortcut({ ...event, code: "KeyJ", key: "j", ctrlKey: true, shiftKey: true })!;
    expect(formatDrawingTemplateShortcut(other, "windows")).toBe("Ctrl+Alt+Shift+J");
    expect(drawingShortcutConflict(other, "windows")).toBeNull();
    expect(drawingTemplateShortcut({ ...event, key: "b", code: "Unidentified" })?.code).toBe("KeyB");
  });
  it.each(["Control", "Alt", "Shift", "Meta", "AltGraph", "Dead", "Unidentified"])("waits or rejects %s", key => {
    expect(drawingTemplateShortcut({ ...event, key, code: "Unidentified" })).toBeNull();
  });
  it.each([
    ["KeyT", true, false, "tool"], ["KeyF", true, false, "tool"], ["KeyW", true, false, "tool"],
    ["KeyR", false, true, "tool"], ["KeyT", false, true, "tool"], ["Digit1", false, false, "interval"],
    ["Delete", false, false, "delete"], ["Backspace", false, false, "delete"],
  ])("reserves existing %s bindings", (code, altKey, shiftKey, kind) => {
    expect(drawingShortcutConflict({ ...shortcut, code: String(code), altKey: Boolean(altKey), shiftKey: Boolean(shiftKey) }, "windows")?.kind).toBe(kind);
  });
  it.each(["ArrowRight", "ArrowDown"])("reserves playback %s on both platforms", code => {
    for (const modifier of ["ctrlKey", "metaKey"] as const) expect(drawingShortcutConflict({ ...shortcut, code, altKey: false, [modifier]: true }, "windows")?.kind).toBe("playback");
  });
  it.each([["Minus", false, -1], ["Equal", false, 1], ["Equal", true, 1]] as const)(
    "reserves the fixed line width shortcut %s (shift=%s)", (code, shiftKey, delta) => {
      for (const platform of ["windows", "mac"] as const) {
        expect(drawingShortcutConflict({ ...shortcut, code, shiftKey }, platform)).toEqual({ kind: "lineWidth", delta });
      }
    });
  it("keeps other Alt combinations available for templates", () => {
    for (const candidate of [shortcut, { ...shortcut, code: "Minus", shiftKey: true }, { ...shortcut, code: "Equal", ctrlKey: true }]) {
      expect(drawingShortcutConflict(candidate, "windows")).toBeNull();
    }
  });
  it.each(["Tab", "Escape", "Enter", "F1", "F5", "F12", "Numpad1", "ArrowLeft", "F4"])("reserves browser/OS/navigation %s", code => {
    expect(drawingShortcutConflict({ ...shortcut, code }, "windows")?.kind).toBe("reserved");
  });
  it.each(["KeyW", "KeyR", "KeyL", "KeyP", "Digit1"])("does not offer browser Ctrl+%s", code => {
    expect(drawingShortcutConflict({ ...shortcut, code, altKey: false, ctrlKey: true }, "windows")?.kind).toBe("reserved");
  });
  it("reserves browser inspector, tab search, profile and clear-data combinations", () => {
    for (const code of ["KeyA", "KeyC", "KeyM", "Delete"]) expect(drawingShortcutConflict({ ...shortcut, code, altKey: false, ctrlKey: true, shiftKey: true }, "windows")?.kind).toBe("reserved");
  });
});

describe("drawing template binding preferences", () => {
  it("keeps IDs independent of template order, scopes duplicates by drawing type and ignores corrupt entries", () => {
    const parsed = parseDrawingTemplateBindings(JSON.stringify({ version: 1, bindings: {
      TREND_LINE: { support: shortcut, duplicate: shortcut, broken: { ...shortcut, ctrlKey: "false" }, other: { ...shortcut, code: "KeyJ" } },
      RECTANGLE: { box: shortcut }, TEXT: [], UNKNOWN: { id: shortcut },
    } }));
    expect(parsed.TREND_LINE).toEqual({ support: shortcut, other: { ...shortcut, code: "KeyJ" } });
    expect(parsed.RECTANGLE).toEqual({ box: shortcut });
    expect(parsed.TEXT).toBeUndefined();
    expect(Object.getPrototypeOf(parsed.TREND_LINE)).toBeNull();
  });
  it.each([null, "bad JSON", "null", "{}", '{"version":2,"bindings":{}}'])("ignores incompatible data %s", raw => {
    expect(parseDrawingTemplateBindings(raw)).toEqual({});
  });
  it("clones level styles and normalizes AB=CD without changing a template", () => {
    const fib = drawingTemplateStyle("FIB_RETRACEMENT", DEFAULT_FIBONACCI_RETRACEMENT_STYLE)!;
    expect(fib).toEqual(DEFAULT_FIBONACCI_RETRACEMENT_STYLE);
    expect(fib).not.toBe(DEFAULT_FIBONACCI_RETRACEMENT_STYLE);
    expect("levels" in fib && fib.levels[0]).not.toBe(DEFAULT_FIBONACCI_RETRACEMENT_STYLE.levels[0]);
    const abcd = drawingTemplateStyle("AB_CD", { ...DEFAULT_ABCD_STYLE, levels: [{ value: 0.5, enabled: true, color: "#123456" }] });
    expect(abcd).toMatchObject({ levels: [{ value: 0, enabled: true }, { value: 1, enabled: true }] });
    expect(drawingTemplateStyle("RECTANGLE", DEFAULT_TREND_LINE_STYLE)).toBeNull();
  });
});
