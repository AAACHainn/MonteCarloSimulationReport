import { z } from "zod";
import { candlestickStyleSchema, DEFAULT_CANDLESTICK_STYLE } from "@/lib/market-replay/candlestick-style";
import { DEFAULT_BAR_COUNT_CONFIG } from "@/lib/market-replay/bar-count";
import type { PdfChartPreferences } from "@/lib/paper-trading/pdf-types";
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const chartPreferencesSchema = z.object({
  barCountConfig: z.object({ enabled: z.boolean(), interval: z.number().int().min(1).max(100), recentTradingDays: z.number().int().min(1).max(30), regularColor: color, bar18Color: color, hourCloseColor: color }).strict(),
  candlestickStyle: candlestickStyleSchema, emaEnabled: z.boolean(),
  emaIndicators: z.array(z.object({ id: z.string().max(100), length: z.number().int().min(2).max(1000), color, lineWidth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), lineStyle: z.enum(["SOLID", "DASHED", "DOTTED"]), visible: z.boolean() }).strict()).max(5),
  gridVisible: z.boolean(), volumeVisible: z.boolean(), displayUtcOffsetMinutes: z.number().int().min(-720).max(840),
}).strict();
export const defaultChartPreferences = (offset: number): PdfChartPreferences => ({ barCountConfig: { ...DEFAULT_BAR_COUNT_CONFIG }, candlestickStyle: { ...DEFAULT_CANDLESTICK_STYLE }, emaEnabled: false, emaIndicators: [], gridVisible: true, volumeVisible: true, displayUtcOffsetMinutes: offset });
