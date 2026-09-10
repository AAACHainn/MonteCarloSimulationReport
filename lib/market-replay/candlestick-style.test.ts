import { describe, expect, it } from "vitest";
import {
  DEFAULT_CANDLESTICK_STYLE,
  candlestickSeriesStyleOptions,
  parseCandlestickStyle,
} from "@/lib/market-replay/candlestick-style";

describe("candlestick style preferences", () => {
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
