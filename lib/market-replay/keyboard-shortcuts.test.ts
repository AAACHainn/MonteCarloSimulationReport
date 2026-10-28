import { afterEach, describe, expect, it, vi } from "vitest";
import { hasVisibleReplayDialog, replayDrawingShortcutKey } from "./keyboard-shortcuts";

afterEach(() => vi.unstubAllGlobals());
describe("AB=CD shortcut", () => {
  const key = { key: "w", code: "KeyW", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, defaultPrevented: false };
  it("uses Alt+W, physical Option+W and the unidentified-key fallback", () => {
    expect(replayDrawingShortcutKey(key)).toBe("AB_CD");
    expect(replayDrawingShortcutKey({ ...key, key: "∑" })).toBe("AB_CD");
    expect(replayDrawingShortcutKey({ ...key, key: "W", code: "Unidentified" })).toBe("AB_CD");
  });
  it("ignores ordinary typing, additional modifiers, composition and handled events", () => {
    expect(replayDrawingShortcutKey({ ...key, altKey: false })).toBeNull();
    for (const flag of ["ctrlKey", "metaKey", "shiftKey", "isComposing", "defaultPrevented"]) {
      expect(replayDrawingShortcutKey({ ...key, [flag]: true })).toBeNull();
    }
  });
});
describe("rectangle shortcut", () => {
  const key = { key: "R", code: "KeyR", altKey: false, ctrlKey: false, metaKey: false, shiftKey: true, isComposing: false, defaultPrevented: false };
  it("uses Shift + R with physical keys and unidentified keyboards", () => {
    expect(replayDrawingShortcutKey(key)).toBe("RECTANGLE");
    expect(replayDrawingShortcutKey({ ...key, code: "Unidentified" })).toBe("RECTANGLE");
    expect(replayDrawingShortcutKey({ ...key, code: "" })).toBe("RECTANGLE");
  });
  it.each(["altKey", "ctrlKey", "metaKey", "isComposing", "defaultPrevented"])("ignores %s", modifier => {
    expect(replayDrawingShortcutKey({ ...key, [modifier]: true })).toBeNull();
  });
  it("releases Alt + R, assigns Shift + T, and ignores Shift + F", () => {
    expect(replayDrawingShortcutKey({ ...key, shiftKey: false, altKey: true })).toBeNull();
    expect(replayDrawingShortcutKey({ ...key, shiftKey: false })).toBeNull();
    expect(replayDrawingShortcutKey({ ...key, code: "KeyT" })).toBe("TEXT");
    expect(replayDrawingShortcutKey({ ...key, code: "KeyF" })).toBeNull();
    expect(replayDrawingShortcutKey({ ...key, code: "KeyA" })).toBeNull();
  });
  it("preserves Alt + T/F, including Option-modified keys on macOS", () => {
    const alt = { ...key, altKey: true, shiftKey: false, key: "†" };
    expect(replayDrawingShortcutKey({ ...alt, code: "KeyT" })).toBe("TREND_LINE");
    expect(replayDrawingShortcutKey({ ...alt, code: "KeyF" })).toBe("FIB_RETRACEMENT");
    expect(replayDrawingShortcutKey({ ...alt, code: "Unidentified", key: "t" })).toBe("TREND_LINE");
    expect(replayDrawingShortcutKey({ ...alt, code: "KeyT", shiftKey: true })).toBeNull();
  });
  it("handles Shift + T fallbacks and rejects composition or other modifiers", () => {
    expect(replayDrawingShortcutKey({ ...key, key: "T", code: "" })).toBe("TEXT");
    expect(replayDrawingShortcutKey({ ...key, key: "t", code: "Unidentified" })).toBe("TEXT");
    for (const modifier of ["ctrlKey", "altKey", "metaKey", "isComposing", "defaultPrevented"]) {
      expect(replayDrawingShortcutKey({ ...key, code: "KeyT", [modifier]: true })).toBeNull();
    }
  });
});
function dialog({ hidden = false, visible = true } = {}) {
  return { closest: () => hidden ? {} : null, getClientRects: () => visible ? [{}] : [] };
}
function documentWith(dialogs: ReturnType<typeof dialog>[]) {
  const querySelectorAll = vi.fn(() => dialogs);
  vi.stubGlobal("document", { querySelectorAll });
  return querySelectorAll;
}

describe("replay shortcut dialog visibility", () => {
  it("permits numeric shortcuts with the closed retained AI window present", () => {
    documentWith([dialog({ hidden: true, visible: false })]);
    expect(hasVisibleReplayDialog()).toBe(false);
  });
  it("ignores hidden, inert or aria-hidden containers even when geometry remains", () => {
    documentWith([dialog({ hidden: true })]);
    expect(hasVisibleReplayDialog()).toBe(false);
  });
  it("ignores windows hidden by display:none without aria-hidden", () => {
    documentWith([dialog({ visible: false })]);
    expect(hasVisibleReplayDialog()).toBe(false);
  });
  it("blocks shortcuts for a visible dialog after an earlier hidden one", () => {
    documentWith([dialog({ hidden: true, visible: false }), dialog()]);
    expect(hasVisibleReplayDialog()).toBe(true);
  });
  it("includes confirmation dialogs and releases shortcuts when they close", () => {
    const dialogs = [dialog()];
    const query = documentWith(dialogs);
    expect(hasVisibleReplayDialog()).toBe(true);
    expect(query).toHaveBeenCalledWith('[role="dialog"], [role="alertdialog"]');
    dialogs.length = 0;
    expect(hasVisibleReplayDialog()).toBe(false);
  });
});
