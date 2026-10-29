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

type CandlestickColors = Pick<CandlestickStyle,
  "upColor" | "downColor" | "borderUpColor" | "borderDownColor" | "wickUpColor" | "wickDownColor">;

function solidColors(upColor: string, downColor: string): CandlestickColors {
  return { upColor, downColor, borderUpColor: upColor, borderDownColor: downColor, wickUpColor: upColor, wickDownColor: downColor };
}

// Chart sequence colors shared by the preset thumbnails, preview and live chart.
export const CANDLESTICK_COLOR_PRESETS = [
  { id: "monochrome", colors: { ...solidColors("#334155", "#334155"), upColor: "#FFFFFF" } },
  { id: "green-up", colors: solidColors("#26A69A", "#EF5350") },
  { id: "red-up", colors: solidColors("#E53935", "#26A69A") },
  { id: "purple-gold", colors: solidColors("#7C3AED", "#B45309") },
] as const;

export type CandlestickColorPreset = typeof CANDLESTICK_COLOR_PRESETS[number];

export function applyCandlestickColorPreset(style: CandlestickStyle, preset: CandlestickColorPreset): CandlestickStyle {
  return { ...style, ...preset.colors };
}

export function matchingCandlestickColorPreset(style: CandlestickStyle): CandlestickColorPreset | undefined {
  return CANDLESTICK_COLOR_PRESETS.find(preset => (
    Object.entries(preset.colors).every(([key, value]) => style[key as keyof CandlestickColors].toUpperCase() === value)
  ));
}

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
