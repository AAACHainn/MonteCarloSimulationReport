import { describe, expect, it } from "vitest";
import {
  DEFAULT_CANDLESTICK_STYLE,
  CANDLESTICK_COLOR_PRESETS, applyCandlestickColorPreset, matchingCandlestickColorPreset,
  candlestickSeriesStyleOptions,
  parseCandlestickStyle,
} from "@/lib/market-replay/candlestick-style";

describe("candlestick style preferences", () => {
  it.each(CANDLESTICK_COLOR_PRESETS)("applies $id colors without changing visibility or mutating the original", preset => {
    const original = { ...DEFAULT_CANDLESTICK_STYLE, bodyVisible: false, borderVisible: false, wickVisible: false };
    const updated = applyCandlestickColorPreset(original, preset);
    expect(updated).toMatchObject({ ...preset.colors, bodyVisible: false, borderVisible: false, wickVisible: false });
    expect(original).toEqual({ ...DEFAULT_CANDLESTICK_STYLE, bodyVisible: false, borderVisible: false, wickVisible: false });
    expect(parseCandlestickStyle(JSON.stringify(updated))).toEqual(updated);
    expect(matchingCandlestickColorPreset(updated)?.id).toBe(preset.id);
  });

  it("uses the requested sequence colors, including a white body with dark monochrome outlines", () => {
    expect(CANDLESTICK_COLOR_PRESETS.map(preset => [preset.colors.upColor, preset.colors.downColor])).toEqual([
      ["#FFFFFF", "#334155"], ["#26A69A", "#EF5350"], ["#E53935", "#26A69A"], ["#7C3AED", "#B45309"],
    ]);
    expect(CANDLESTICK_COLOR_PRESETS[0].colors).toMatchObject({
      borderUpColor: "#334155", borderDownColor: "#334155", wickUpColor: "#334155", wickDownColor: "#334155",
    });
  });

  it("recognizes colors regardless of case and visibility, and detects individual custom colors", () => {
    const style = applyCandlestickColorPreset(DEFAULT_CANDLESTICK_STYLE, CANDLESTICK_COLOR_PRESETS[3]);
    expect(matchingCandlestickColorPreset({ ...style, upColor: "#7c3aed", wickVisible: false })?.id).toBe("purple-gold");
    expect(matchingCandlestickColorPreset({ ...style, borderDownColor: "#123456" })).toBeUndefined();
    expect(matchingCandlestickColorPreset(DEFAULT_CANDLESTICK_STYLE)).toBeUndefined();
  });

  it("loads valid stored preferences and falls back from invalid storage", () => {
    const style = { ...DEFAULT_CANDLESTICK_STYLE, upColor: "#FFFFFF", wickVisible: false };
    expect(parseCandlestickStyle(JSON.stringify(style))).toEqual(style);
    expect(parseCandlestickStyle("{broken")).toEqual(DEFAULT_CANDLESTICK_STYLE);
    expect(parseCandlestickStyle(JSON.stringify({ ...style, upColor: "red" }))).toEqual(DEFAULT_CANDLESTICK_STYLE);
  });

  it("maps visibility and bullish/bearish colors to Lightweight Charts options", () => {
    expect(candlestickSeriesStyleOptions({
      ...DEFAULT_CANDLESTICK_STYLE,
      bodyVisible: false,
      borderVisible: false,
      wickVisible: false,
      upColor: "#FFFFFF",
      downColor: "#000000",
    })).toMatchObject({
      upColor: "rgba(0, 0, 0, 0)",
      downColor: "rgba(0, 0, 0, 0)",
      borderVisible: false,
      wickVisible: false,
      borderUpColor: "#16A34A",
      wickDownColor: "#DC2626",
    });
  });
});
