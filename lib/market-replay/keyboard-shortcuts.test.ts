import { afterEach, describe, expect, it, vi } from "vitest";
import { hasVisibleReplayDialog, replayDrawingShortcutKey } from "./keyboard-shortcuts";

afterEach(() => vi.unstubAllGlobals());
describe("rectangle shortcut", () => {
  const key = { key: "r", code: "KeyR", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, defaultPrevented: false };
  it("uses the physical key with Option and supports unidentified keyboards", () => {
    expect(replayDrawingShortcutKey({ ...key, key: "®" })).toBe("r");
    expect(replayDrawingShortcutKey({ ...key, code: "Unidentified" })).toBe("r");
    expect(replayDrawingShortcutKey({ ...key, code: "KeyT" })).toBe("t");
    expect(replayDrawingShortcutKey({ ...key, code: "KeyF" })).toBe("f");
  });
  it.each(["ctrlKey", "shiftKey", "metaKey", "isComposing", "defaultPrevented"])("ignores %s", modifier => {
    expect(replayDrawingShortcutKey({ ...key, [modifier]: true })).toBeNull();
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
