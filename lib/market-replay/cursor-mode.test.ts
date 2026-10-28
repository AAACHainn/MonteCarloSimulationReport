import { describe, expect, it } from "vitest";
import { parseReplayCursorMode, readReplayCursorMode, writeReplayCursorMode, replayCrosshairVisible, resolveReplayCursor, REPLAY_CURSOR_STORAGE_KEY } from "./cursor-mode";

describe("replay cursor preference", () => {
  it("falls back to the existing crosshair for missing or invalid saved values", () => {
    expect(parseReplayCursorMode(null)).toBe("crosshair");
    expect(parseReplayCursorMode("invalid")).toBe("crosshair");
    expect(parseReplayCursorMode("pointer")).toBe("pointer");
    expect(parseReplayCursorMode("crosshair")).toBe("crosshair");
  });

  it("persists the selection across mounts and tolerates blocked storage", () => {
    const entries = new Map<string, string>();
    const storage = () => ({ getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } });
    writeReplayCursorMode(storage, "pointer");
    expect(entries.get(REPLAY_CURSOR_STORAGE_KEY)).toBe("pointer");
    expect(readReplayCursorMode(storage)).toBe("pointer");
    const blocked = () => { throw new Error("storage denied"); };
    expect(readReplayCursorMode(blocked)).toBe("crosshair");
    expect(() => writeReplayCursorMode(blocked, "pointer")).not.toThrow();
    expect(readReplayCursorMode(() => ({ ...storage(), getItem: () => { throw new Error("read denied"); } }))).toBe("crosshair");
    expect(() => writeReplayCursorMode(() => ({ ...storage(), setItem: () => { throw new Error("write denied"); } }), "pointer")).not.toThrow();
  });

  it("changes the mouse cursor while keeping temporary tool overrides", () => {
    expect(resolveReplayCursor("pointer", "")).toBe("default");
    expect(resolveReplayCursor("crosshair", "")).toBe("crosshair");
    expect(resolveReplayCursor("pointer", "crosshair")).toBe("crosshair");
    expect(resolveReplayCursor("crosshair", "move")).toBe("move");
    expect(resolveReplayCursor("crosshair", "ns-resize")).toBe("ns-resize");
    expect(resolveReplayCursor("pointer", "")).toBe("default");
  });

  it("keeps the chart crosshair visible unless a measurement overlay replaces it", () => {
    expect(replayCrosshairVisible(false)).toBe(true);
    expect(replayCrosshairVisible(true)).toBe(false);
  });
});
