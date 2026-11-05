import { describe, expect, it } from "vitest";
import { DEFAULT_CANDLESTICK_STYLE, CANDLESTICK_COLOR_PRESETS, DARK_CANDLESTICK_COLOR_PRESETS,
  applyCandlestickColorPreset, matchingCandlestickColorPreset, matchingCandlestickPresetVersion, parseCandlestickStyle, resolveSnapshotCandlestickStyle } from "./candlestick-style";
import { chartThemes } from "@/lib/chart-theme";

describe("explicit theme presets and independent snapshots", () => {
  it.each(DARK_CANDLESTICK_COLOR_PRESETS)("maps $id to its light snapshot without changing frozen preferences or visibility", preset => {
    const input = Object.freeze({ ...applyCandlestickColorPreset(DEFAULT_CANDLESTICK_STYLE, preset), bodyVisible: false, wickVisible: false });
    const effective = resolveSnapshotCandlestickStyle(input);
    expect(effective).toEqual({ ...input, ...CANDLESTICK_COLOR_PRESETS.find(p => p.id === preset.id)!.colors });
    expect(effective).not.toBe(input);
    expect(parseCandlestickStyle(JSON.stringify(input))).toEqual(input);
    expect(matchingCandlestickColorPreset(input, "light")).toBeUndefined();
    expect(matchingCandlestickPresetVersion(input)).toMatchObject({ mode: "dark", preset: { id: preset.id } });
  });
  it("uses a hollow rising monochrome candle with visible outlines on the dark chart", () => {
    const p = DARK_CANDLESTICK_COLOR_PRESETS[0].colors;
    expect(p.upColor).toBe(chartThemes.dark.background);
    expect(p.downColor).not.toBe(p.upColor);
    expect(p.wickUpColor).toBe(p.downColor);
    expect(p.borderUpColor).toBe(p.downColor);
  });
  it("matches six colors case-insensitively and preserves all custom colors", () => {
    const p = DARK_CANDLESTICK_COLOR_PRESETS[1];
    const exact = { ...DEFAULT_CANDLESTICK_STYLE, ...Object.fromEntries(Object.entries(p.colors).map(([key, value]) => [key, value.toLowerCase()])) };
    expect(matchingCandlestickColorPreset(exact, "dark")?.id).toBe(p.id);
    const custom = { ...exact, wickUpColor: "#123456" };
    expect(resolveSnapshotCandlestickStyle(custom)).toEqual(custom);
    expect(resolveSnapshotCandlestickStyle(DEFAULT_CANDLESTICK_STYLE)).toEqual(DEFAULT_CANDLESTICK_STYLE);
    for (const light of CANDLESTICK_COLOR_PRESETS) {
      const style = applyCandlestickColorPreset(DEFAULT_CANDLESTICK_STYLE, light);
      expect(resolveSnapshotCandlestickStyle(style)).toEqual(style);
    }
  });
});
