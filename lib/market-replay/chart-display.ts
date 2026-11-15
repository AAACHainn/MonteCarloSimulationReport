import { z } from "zod";
import type { CandlestickData, LineData, Time, WhitespaceData } from "lightweight-charts";
import { DEFAULT_CANDLESTICK_STYLE, type CandlestickStyle } from "./candlestick-style";

export const CHART_DISPLAY_STORAGE_KEY = "market-replay-chart-display-v1";
export const DEFAULT_LINE_STYLE = { priceSource: "close" as const, color: "#2563EB" };
const chartSelectionSchema = z.object({
  chartType: z.enum(["candlestick", "line"]),
  line: z.object({ priceSource: z.enum(["close", "open"]), color: z.string().regex(/^#[0-9a-f]{6}$/i) }).strict(),
}).strict();
export type ChartSelection = z.infer<typeof chartSelectionSchema>;
export type ChartDisplayConfig = ChartSelection & { candlestickStyle: CandlestickStyle };
export const DEFAULT_CHART_SELECTION: ChartSelection = { chartType: "candlestick", line: DEFAULT_LINE_STYLE };

export function parseChartSelection(value: string | null): ChartSelection {
  try {
    const parsed = chartSelectionSchema.safeParse(JSON.parse(value ?? "null"));
    if (parsed.success) return parsed.data;
  } catch { /* A blocked or invalid preference must not prevent local chart operations. */ }
  return { chartType: "candlestick", line: { ...DEFAULT_LINE_STYLE } };
}
export function chartDisplayConfig(candlestickStyle = DEFAULT_CANDLESTICK_STYLE, selection = DEFAULT_CHART_SELECTION): ChartDisplayConfig {
  return { ...selection, line: { ...selection.line }, candlestickStyle: { ...candlestickStyle } };
}
export function cloneChartDisplay(config: ChartDisplayConfig): ChartDisplayConfig {
  return chartDisplayConfig(config.candlestickStyle, config);
}
export type PriceSeriesPoint = CandlestickData<Time> | WhitespaceData<Time>;

/** Preserve whitespace slots and revealed OHLC; never infer or interpolate missing bars. */
export function lineSeriesPoint(point: PriceSeriesPoint, source: ChartSelection["line"]["priceSource"]): LineData<Time> | WhitespaceData<Time> {
  return "open" in point ? { time: point.time, value: point[source] } : { time: point.time };
}
