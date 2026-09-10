import { z } from "zod";

export type CandlestickStyle = {
  bodyVisible: boolean;
  upColor: string;
  downColor: string;
  borderVisible: boolean;
  borderUpColor: string;
  borderDownColor: string;
  wickVisible: boolean;
  wickUpColor: string;
  wickDownColor: string;
};

export const DEFAULT_CANDLESTICK_STYLE: CandlestickStyle = {
  bodyVisible: true,
  upColor: "#16A34A",
  downColor: "#DC2626",
  borderVisible: true,
  borderUpColor: "#16A34A",
  borderDownColor: "#DC2626",
  wickVisible: true,
  wickUpColor: "#16A34A",
  wickDownColor: "#DC2626",
};

const color = z.string().regex(/^#[0-9a-f]{6}$/i);

export const candlestickStyleSchema = z.object({
  bodyVisible: z.boolean(),
  upColor: color,
  downColor: color,
  borderVisible: z.boolean(),
  borderUpColor: color,
  borderDownColor: color,
  wickVisible: z.boolean(),
  wickUpColor: color,
  wickDownColor: color,
}).strict();

export function parseCandlestickStyle(value: string | null): CandlestickStyle {
  if (!value) return DEFAULT_CANDLESTICK_STYLE;
  try {
    const parsed = candlestickStyleSchema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch {
    // Invalid browser storage falls back to the application defaults.
  }
  return DEFAULT_CANDLESTICK_STYLE;
}

export function candlestickSeriesStyleOptions(style: CandlestickStyle) {
  return {
    upColor: style.bodyVisible ? style.upColor : "rgba(0, 0, 0, 0)",
    downColor: style.bodyVisible ? style.downColor : "rgba(0, 0, 0, 0)",
    borderVisible: style.borderVisible,
    borderUpColor: style.borderUpColor,
    borderDownColor: style.borderDownColor,
    wickVisible: style.wickVisible,
    wickUpColor: style.wickUpColor,
    wickDownColor: style.wickDownColor,
  };
}
