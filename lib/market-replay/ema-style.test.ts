import { describe, expect, it } from "vitest";
import { LineStyle } from "lightweight-charts";
import {
  DEFAULT_EMA_LINE_STYLE,
  DEFAULT_EMA_LINE_WIDTH,
  emaSeriesStyleOptions,
  normalizeEmaLineStyle,
  normalizeEmaLineWidth,
} from "@/lib/market-replay/ema-style";

describe("EMA line style preferences", () => {
  it("falls back to defaults for old or invalid saved preferences", () => {
    expect(normalizeEmaLineWidth(undefined)).toBe(DEFAULT_EMA_LINE_WIDTH);
    expect(normalizeEmaLineWidth(5)).toBe(DEFAULT_EMA_LINE_WIDTH);
    expect(normalizeEmaLineStyle(undefined)).toBe(DEFAULT_EMA_LINE_STYLE);
    expect(normalizeEmaLineStyle("LARGE_DASHED")).toBe(DEFAULT_EMA_LINE_STYLE);
  });

  it("maps the configured appearance to Lightweight Charts options", () => {
    expect(emaSeriesStyleOptions({
      id: "ema-20",
      length: 20,
      color: "#2563EB",
      lineWidth: 4,
      lineStyle: "DOTTED",
      visible: true,
    })).toEqual({
      color: "#2563EB",
      lineWidth: 4,
      lineStyle: LineStyle.Dotted,
    });
  });
});
