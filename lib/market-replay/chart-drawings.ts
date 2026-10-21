import { z } from "zod";
import { drawingTimelineLocator, type DrawingTimelineLocator } from "./drawing-timeline";
import {
  AggregationCalendar,
} from "@/lib/market-replay/aggregation";
import type { AggregatedMarketBarData, TradingSessionConfig } from "@/lib/market-replay/types";

export const DRAWING_TYPE_TREND_LINE = "TREND_LINE" as const;
export const DRAWING_TYPE_FIB_RETRACEMENT = "FIB_RETRACEMENT" as const;
export const DRAWING_TYPE_RECTANGLE = "RECTANGLE" as const;
export const DRAWING_TYPE_TEXT = "TEXT" as const;
export const TREND_LINE_STYLES = ["SOLID", "DASHED", "DOTTED"] as const;
export const DRAWING_TYPES = [DRAWING_TYPE_TREND_LINE, DRAWING_TYPE_FIB_RETRACEMENT, DRAWING_TYPE_RECTANGLE, DRAWING_TYPE_TEXT] as const;

export type DrawingType = (typeof DRAWING_TYPES)[number];
export type DrawingTool = DrawingType;
export type TwoPointDrawingTool = Exclude<DrawingTool, "TEXT">;

export type DrawingAnchor = {
  timestamp: string;
  sourceSequence: number | null;
  price: number;
};

export type TrendLineGeometry = {
  start: DrawingAnchor;
  end: DrawingAnchor;
};

export type TrendLineStyle = {
  color: string;
  opacity: number;
  width: number;
  lineStyle: (typeof TREND_LINE_STYLES)[number];
  showStartPrice: boolean;
  showEndPrice: boolean;
};

export type TrendLineDrawing = {
  id: string;
  datasetId: string;
  type: typeof DRAWING_TYPE_TREND_LINE;
  geometry: TrendLineGeometry;
  style: TrendLineStyle;
  createdAt: string;
  updatedAt: string;
};

export type FibonacciLevel = {
  value: number;
  enabled: boolean;
  color: string;
};

export type FibonacciRetracementStyle = {
  width: number;
  lineStyle: (typeof TREND_LINE_STYLES)[number];
  levels: FibonacciLevel[];
  singleColor: string | null;
  showPrices: boolean;
  showLevels: boolean;
};

export type FibonacciRetracementDrawing = {
  id: string;
  datasetId: string;
  type: typeof DRAWING_TYPE_FIB_RETRACEMENT;
  geometry: TrendLineGeometry;
  style: FibonacciRetracementStyle;
  createdAt: string;
  updatedAt: string;
};

export type RectangleStyle = {
  fillColor: string;
  fillOpacity: number;
  borderStyle: "NONE" | (typeof TREND_LINE_STYLES)[number];
  borderColor: string;
  borderWidth: number;
};
export type RectangleDrawing = Omit<TrendLineDrawing, "type" | "style"> & {
  type: typeof DRAWING_TYPE_RECTANGLE;
  style: RectangleStyle;
};
export type RectangleTemplate = { id: string; name: string; style: RectangleStyle };
export type RectanglePreferences = { defaultStyle: RectangleStyle; templates: RectangleTemplate[] };
export const DEFAULT_RECTANGLE_STYLE: RectangleStyle = {
  fillColor: "#2962FF", fillOpacity: 15, borderStyle: "NONE", borderColor: "#2962FF", borderWidth: 1,
};

export const TEXT_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48] as const;
export const TEXT_MAX_LENGTH = 2000;
export const TEXT_MAX_LINES = 50;
export type TextGeometry = { anchor: DrawingAnchor; text: string };
export type TextDrawingStyle = {
  color: string; fontSize: (typeof TEXT_FONT_SIZES)[number]; bold: boolean; italic: boolean;
  backgroundEnabled: boolean; backgroundColor: string; backgroundOpacity: number;
  borderEnabled: boolean; borderColor: string; wrapEnabled: boolean; wrapWidth: number;
};
export type TextDrawing = Omit<TrendLineDrawing, "type" | "geometry" | "style"> & {
  type: "TEXT"; geometry: TextGeometry; style: TextDrawingStyle;
};
export type TextTemplate = { id: string; name: string; style: TextDrawingStyle };
export type TextPreferences = { defaultStyle: TextDrawingStyle; templates: TextTemplate[] };
export const DEFAULT_TEXT_STYLE: TextDrawingStyle = {
  color: "#2962FF", fontSize: 18, bold: false, italic: false,
  backgroundEnabled: false, backgroundColor: "#FFFFFF", backgroundOpacity: 90,
  borderEnabled: false, borderColor: "#2962FF", wrapEnabled: true, wrapWidth: 240,
};
export function normalizeDrawingText(text: string) { return text.replace(/\r\n?/g, "\n"); }
export type TwoPointDrawing = TrendLineDrawing | FibonacciRetracementDrawing | RectangleDrawing;
export type MarketDrawing = TwoPointDrawing | TextDrawing;
export type DrawingGeometry = TrendLineGeometry | TextGeometry;
export type MarketDrawingStyle = TrendLineStyle | FibonacciRetracementStyle | RectangleStyle | TextDrawingStyle;
type NewDrawing<T> = T extends MarketDrawing ? Omit<T, "id" | "createdAt" | "updatedAt"> : never;
export type NewMarketDrawing = NewDrawing<MarketDrawing>;
export function twoPointDrawingInput(datasetId: string, type: TwoPointDrawingTool, geometry: TrendLineGeometry,
  styles: { rectangle: RectangleStyle; trend: TrendLineStyle; fibonacci: FibonacciRetracementStyle }): NewMarketDrawing {
  const base = { datasetId, geometry };
  switch (type) {
    case "RECTANGLE": return { ...base, type, style: { ...styles.rectangle } };
    case "TREND_LINE": return { ...base, type, style: { ...styles.trend } };
    case "FIB_RETRACEMENT": return { ...base, type, style: { ...styles.fibonacci, levels: styles.fibonacci.levels.map(level => ({ ...level })) } };
  }
}

export type TrendLineTemplate = {
  id: string;
  name: string;
  style: TrendLineStyle;
};

export type TrendLinePreferences = {
  defaultStyle: TrendLineStyle;
  templates: TrendLineTemplate[];
};

export type FibonacciRetracementTemplate = {
  id: string;
  name: string;
  style: FibonacciRetracementStyle;
};

export type FibonacciRetracementPreferences = {
  defaultStyle: FibonacciRetracementStyle;
  templates: FibonacciRetracementTemplate[];
};

export const DEFAULT_TREND_LINE_STYLE: TrendLineStyle = {
  color: "#2962FF",
  opacity: 100,
  width: 2,
  lineStyle: "SOLID",
  showStartPrice: false,
  showEndPrice: false,
};

export const DEFAULT_FIBONACCI_RETRACEMENT_STYLE: FibonacciRetracementStyle = {
  width: 1,
  lineStyle: "SOLID",
  singleColor: null,
  showPrices: true,
  showLevels: true,
  levels: [
    { value: 0, enabled: true, color: "#787B86" },
    { value: 0.236, enabled: true, color: "#F23645" },
    { value: 0.382, enabled: true, color: "#FF9800" },
    { value: 0.5, enabled: true, color: "#4CAF50" },
    { value: 0.618, enabled: true, color: "#089981" },
    { value: 0.786, enabled: true, color: "#2962FF" },
    { value: 1, enabled: true, color: "#787B86" },
    { value: 1.272, enabled: false, color: "#7B1FA2" },
    { value: 1.618, enabled: false, color: "#9C27B0" },
    { value: 2.618, enabled: false, color: "#E91E63" },
  ],
};

const finiteNumber = z.number().finite();
const drawingAnchorSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  sourceSequence: z.number().int().nonnegative().nullable(),
  price: finiteNumber,
}).strict();

export const textGeometrySchema = z.object({
  anchor: drawingAnchorSchema,
  text: z.string().transform(normalizeDrawingText).pipe(z.string().max(TEXT_MAX_LENGTH)
    .refine(text => text.length <= TEXT_MAX_LENGTH && text.trim().length > 0 && text.split("\n").length <= TEXT_MAX_LINES)),
}).strict();
export const textDrawingStyleSchema = z.object({
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  fontSize: z.number().refine((size): size is TextDrawingStyle["fontSize"] => TEXT_FONT_SIZES.includes(size as TextDrawingStyle["fontSize"])),
  bold: z.boolean(), italic: z.boolean(), backgroundEnabled: z.boolean(),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i), backgroundOpacity: z.number().int().min(0).max(100),
  borderEnabled: z.boolean(), borderColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  wrapEnabled: z.boolean(), wrapWidth: z.number().int().min(120).max(800),
}).strict();
const textPreferencesSchema = z.object({ defaultStyle: textDrawingStyleSchema,
  templates: z.array(z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(50), style: textDrawingStyleSchema }).strict()).max(50),
}).strict();
export function parseTextPreferences(value: string | null): TextPreferences {
  try { const parsed = textPreferencesSchema.safeParse(value ? JSON.parse(value) : null); if (parsed.success) return parsed.data; }
  catch { /* Invalid or unavailable storage uses defaults. */ }
  return { defaultStyle: { ...DEFAULT_TEXT_STYLE }, templates: [] };
}

export const trendLineGeometrySchema = z.object({
  start: drawingAnchorSchema,
  end: drawingAnchorSchema,
}).strict();

export const trendLineStyleSchema = z.object({
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  opacity: z.number().int().min(0).max(100),
  width: z.number().int().min(1).max(4),
  lineStyle: z.enum(TREND_LINE_STYLES),
  showStartPrice: z.boolean(),
  showEndPrice: z.boolean(),
}).strict();

export const rectangleStyleSchema = z.object({
  fillColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  fillOpacity: z.number().int().min(0).max(100),
  borderStyle: z.enum(["NONE", ...TREND_LINE_STYLES]),
  borderColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  borderWidth: z.number().int().min(1).max(4),
}).strict().refine(style => style.fillOpacity > 0 || style.borderStyle !== "NONE", {
  message: "Rectangle must have a visible fill or border", path: ["fillOpacity"],
});

export function isValidRectangleGeometry(geometry: TrendLineGeometry) {
  return geometry.start.price !== geometry.end.price
    && Date.parse(geometry.start.timestamp) !== Date.parse(geometry.end.timestamp);
}

export const rectanglePreferencesSchema = z.object({
  defaultStyle: rectangleStyleSchema,
  templates: z.array(z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(50),
    style: rectangleStyleSchema }).strict()).max(50),
}).strict();

export function parseRectanglePreferences(value: string | null): RectanglePreferences {
  try {
    const parsed = rectanglePreferencesSchema.safeParse(value ? JSON.parse(value) : null);
    if (parsed.success) return parsed.data;
  } catch { /* Invalid storage uses defaults. */ }
  return { defaultStyle: { ...DEFAULT_RECTANGLE_STYLE }, templates: [] };
}

export const fibonacciLevelSchema = z.object({
  value: finiteNumber.min(-10).max(10),
  enabled: z.boolean(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
}).strict();

export const fibonacciRetracementStyleSchema = z.object({
  width: z.number().int().min(1).max(4),
  lineStyle: z.enum(TREND_LINE_STYLES),
  levels: z.array(fibonacciLevelSchema).min(1).max(10),
  singleColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().default(null),
  showPrices: z.boolean().default(true),
  showLevels: z.boolean().default(true),
}).strict().refine(
  (style) => !hasDuplicateEnabledFibonacciLevels(style),
  { message: "Enabled Fibonacci levels must be unique", path: ["levels"] },
);

export function hasDuplicateEnabledFibonacciLevels(style: Pick<FibonacciRetracementStyle, "levels">) {
  const enabledValues = style.levels.filter((level) => level.enabled).map((level) => level.value);
  return new Set(enabledValues).size !== enabledValues.length;
}

export const trendLinePreferencesSchema = z.object({
  defaultStyle: trendLineStyleSchema,
  templates: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(50),
    style: trendLineStyleSchema,
  }).strict()).max(50),
}).strict();

export const fibonacciRetracementPreferencesSchema = z.object({
  defaultStyle: fibonacciRetracementStyleSchema,
  templates: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(50),
    style: fibonacciRetracementStyleSchema,
  }).strict()).max(50),
}).strict();

export const createMarketDrawingSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(DRAWING_TYPE_TEXT), clientId: z.string().uuid().optional(), geometry: textGeometrySchema,
    style: textDrawingStyleSchema.default(DEFAULT_TEXT_STYLE) }).strict(),
  z.object({
    type: z.literal(DRAWING_TYPE_RECTANGLE),
    geometry: trendLineGeometrySchema.refine(isValidRectangleGeometry),
    style: rectangleStyleSchema.default(DEFAULT_RECTANGLE_STYLE),
  }).strict(),
  z.object({
    type: z.literal(DRAWING_TYPE_TREND_LINE),
    geometry: trendLineGeometrySchema,
    style: trendLineStyleSchema.default(DEFAULT_TREND_LINE_STYLE),
  }).strict(),
  z.object({
    type: z.literal(DRAWING_TYPE_FIB_RETRACEMENT),
    geometry: trendLineGeometrySchema,
    style: fibonacciRetracementStyleSchema.default(DEFAULT_FIBONACCI_RETRACEMENT_STYLE),
  }).strict(),
]);

export const updateMarketDrawingSchema = z.object({
  geometry: z.union([trendLineGeometrySchema, textGeometrySchema]).optional(),
  style: z.union([trendLineStyleSchema, fibonacciRetracementStyleSchema, rectangleStyleSchema, textDrawingStyleSchema]).optional(),
}).strict().refine((value) => value.geometry !== undefined || value.style !== undefined);

type StoredDrawing = {
  id: string;
  datasetId: string;
  type: string;
  geometry: string;
  style: string;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeMarketDrawing(record: StoredDrawing): MarketDrawing {
  const base = {
    id: record.id,
    datasetId: record.datasetId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
  if (record.type === DRAWING_TYPE_TEXT) return { ...base, type: DRAWING_TYPE_TEXT,
    geometry: textGeometrySchema.parse(JSON.parse(record.geometry)), style: textDrawingStyleSchema.parse(JSON.parse(record.style)) };
  const geometry = trendLineGeometrySchema.parse(JSON.parse(record.geometry));
  if (record.type === DRAWING_TYPE_TREND_LINE) return {
    ...base,
    geometry,
    type: DRAWING_TYPE_TREND_LINE,
    style: trendLineStyleSchema.parse(JSON.parse(record.style)),
  };
  if (record.type === DRAWING_TYPE_FIB_RETRACEMENT) return {
    ...base,
    geometry,
    type: DRAWING_TYPE_FIB_RETRACEMENT,
    style: fibonacciRetracementStyleSchema.parse(JSON.parse(record.style)),
  };
  if (record.type === DRAWING_TYPE_RECTANGLE) return {
    ...base, geometry, type: DRAWING_TYPE_RECTANGLE, style: rectangleStyleSchema.parse(JSON.parse(record.style)),
  };
  throw new Error("Unsupported drawing type");
}

export function parseTrendLinePreferences(value: string | null): TrendLinePreferences {
  if (!value) return { defaultStyle: DEFAULT_TREND_LINE_STYLE, templates: [] };
  try {
    const parsed = trendLinePreferencesSchema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch {
    // Invalid browser storage falls back to the default drawing style.
  }
  return { defaultStyle: DEFAULT_TREND_LINE_STYLE, templates: [] };
}

export function parseFibonacciRetracementPreferences(value: string | null): FibonacciRetracementPreferences {
  if (!value) return { defaultStyle: DEFAULT_FIBONACCI_RETRACEMENT_STYLE, templates: [] };
  try {
    const parsed = fibonacciRetracementPreferencesSchema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch {
    // Invalid browser storage falls back to the default Fibonacci style.
  }
  return { defaultStyle: DEFAULT_FIBONACCI_RETRACEMENT_STYLE, templates: [] };
}

export function drawingStyleMatchesType(type: DrawingType, style: MarketDrawingStyle) {
  if (type === DRAWING_TYPE_TEXT) return textDrawingStyleSchema.safeParse(style).success;
  if (type === DRAWING_TYPE_RECTANGLE) return rectangleStyleSchema.safeParse(style).success;
  return type === DRAWING_TYPE_TREND_LINE
    ? trendLineStyleSchema.safeParse(style).success
    : fibonacciRetracementStyleSchema.safeParse(style).success;
}

export function drawingGeometryMatchesType(type: string, geometry: DrawingGeometry) {
  if (!DRAWING_TYPES.includes(type as DrawingType)) return false;
  if (type === DRAWING_TYPE_TEXT) return textGeometrySchema.safeParse(geometry).success;
  const result = trendLineGeometrySchema.safeParse(geometry);
  return result.success && (type !== DRAWING_TYPE_RECTANGLE || isValidRectangleGeometry(result.data));
}

export function fibonacciPriceAtLevel(geometry: TrendLineGeometry, level: number) {
  return geometry.start.price + (geometry.end.price - geometry.start.price) * level;
}

export function anchorForLogicalIndex({
  logicalIndex,
  price,
  bars,
  displayIntervalSeconds,
  sourceIntervalSeconds,
  session,
  timeline,
}: {
  logicalIndex: number;
  price: number;
  bars: AggregatedMarketBarData[];
  displayIntervalSeconds: number;
  sourceIntervalSeconds?: number;
  session?: TradingSessionConfig;
  timeline?: DrawingTimelineLocator;
}): DrawingAnchor {
  const index = Math.round(logicalIndex);
  const bar = bars[index];
  if (bar) return { timestamp: bar.timestamp, sourceSequence: bar.firstSequence, price };
  const referenceIndex = index < 0 ? 0 : bars.length - 1;
  const reference = bars[referenceIndex];
  const projectedTimestamp = timeline ? timeline.timestampForLogicalIndex(index) : reference && sourceIntervalSeconds && session
    ? aggregationBucketStartAtOffset({
      timestampMs: new Date(reference.timestamp).getTime(),
      bucketOffset: index - referenceIndex,
      displayIntervalSeconds,
      session,
    })
    : null;
  if ((timeline || (sourceIntervalSeconds && session)) && projectedTimestamp === null) {
    throw new RangeError("Drawing anchor is outside the supported trading calendar");
  }
  const timestamp = reference
    ? new Date(projectedTimestamp ?? (
      new Date(reference.timestamp).getTime() + (index - referenceIndex) * displayIntervalSeconds * 1_000
    )).toISOString()
    : new Date(0).toISOString();
  return { timestamp, sourceSequence: null, price };
}

export type ChartTimelineProjectionOptions = {
  sourceIntervalSeconds: number;
  session: TradingSessionConfig;
};

function aggregationBucketStartAtOffset({ timestampMs, bucketOffset, displayIntervalSeconds, session }: {
  timestampMs: number; bucketOffset: number; displayIntervalSeconds: number; session: TradingSessionConfig;
}) {
  return new AggregationCalendar(displayIntervalSeconds, session).timestampAtOffset(timestampMs, bucketOffset);
}

export type ChartTimelineAnchor = {
  timestamp: string;
  sourceSequence: number | null;
};

function barSequenceSpan(bars: AggregatedMarketBarData[], index: number) {
  const bar = bars[index];
  const next = bars[index + 1];
  const previous = bars[index - 1];
  if (next && next.firstSequence > bar.firstSequence) return next.firstSequence - bar.firstSequence;
  if (previous && bar.firstSequence > previous.firstSequence) return bar.firstSequence - previous.firstSequence;
  return Math.max(1, bar.expectedCount, bar.lastSequence - bar.firstSequence + 1);
}

/**
 * Captures a chart position in the source-data timeline instead of in the current
 * display interval's logical-index space. Fractional source sequences deliberately
 * represent positions between candle centres and are never persisted as drawings.
 */
export function timelineAnchorForLogicalIndex(
  logicalIndex: number,
  bars: AggregatedMarketBarData[],
  displayIntervalSeconds: number,
): ChartTimelineAnchor | null {
  if (!bars.length || !Number.isFinite(logicalIndex)) return null;
  const leftIndex = Math.floor(logicalIndex);
  const rightIndex = Math.ceil(logicalIndex);
  const left = bars[leftIndex];
  const right = bars[rightIndex];
  if (left && right) {
    const ratio = logicalIndex - leftIndex;
    const leftTime = new Date(left.timestamp).getTime();
    const rightTime = new Date(right.timestamp).getTime();
    return {
      timestamp: new Date(leftTime + (rightTime - leftTime) * ratio).toISOString(),
      sourceSequence: left.firstSequence + (right.firstSequence - left.firstSequence) * ratio,
    };
  }

  const referenceIndex = logicalIndex < 0 ? 0 : bars.length - 1;
  const reference = bars[referenceIndex];
  const offset = logicalIndex - referenceIndex;
  return {
    timestamp: new Date(
      new Date(reference.timestamp).getTime() + offset * Math.max(1, displayIntervalSeconds) * 1_000,
    ).toISOString(),
    sourceSequence: reference.firstSequence + offset * barSequenceSpan(bars, referenceIndex),
  };
}

export function logicalIndexForTimelineAnchor(
  anchor: ChartTimelineAnchor,
  bars: AggregatedMarketBarData[],
  displayIntervalSeconds: number,
  options?: ChartTimelineProjectionOptions,
) {
  if (!bars.length) return null;
  if (anchor.sourceSequence !== null && Number.isFinite(anchor.sourceSequence)) {
    const target = anchor.sourceSequence;
    if (target < bars[0].firstSequence) {
      return (target - bars[0].firstSequence) / barSequenceSpan(bars, 0);
    }
    for (let index = 0; index < bars.length; index += 1) {
      const bar = bars[index];
      const next = bars[index + 1];
      if (next && target >= next.firstSequence) continue;
      return index + (target - bar.firstSequence) / barSequenceSpan(bars, index);
    }
  }

  const target = new Date(anchor.timestamp).getTime();
  if (!Number.isFinite(target)) return null;
  if (options) {
    return drawingTimelineLocator(bars, displayIntervalSeconds, options).logicalIndexForTimestamp(target);
  }
  const firstTime = new Date(bars[0].timestamp).getTime();
  const lastTime = new Date(bars.at(-1)!.timestamp).getTime();
  const interval = Math.max(1, displayIntervalSeconds * 1_000);
  if (target < firstTime) return (target - firstTime) / interval;
  if (target > lastTime) return bars.length - 1 + (target - lastTime) / interval;
  for (let index = 1; index < bars.length; index += 1) {
    const right = new Date(bars[index].timestamp).getTime();
    if (right <= target) continue;
    const left = new Date(bars[index - 1].timestamp).getTime();
    const span = right - left;
    return index - 1 + (span > 0 ? (target - left) / span : 0);
  }
  return bars.length - 1;
}

export function logicalIndexForAnchor(
  anchor: DrawingAnchor,
  bars: AggregatedMarketBarData[],
  displayIntervalSeconds: number,
  options?: ChartTimelineProjectionOptions,
) {
  return drawingTimelineLocator(bars, displayIntervalSeconds, options).logicalIndexForAnchor(anchor);
}

export function snapScreenPointTo45(
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return end;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: start.x + Math.cos(snapped) * distance,
    y: start.y + Math.sin(snapped) * distance,
  };
}

export function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

export function trendLineDashArray(style: TrendLineStyle["lineStyle"]) {
  if (style === "DASHED") return "8 6";
  if (style === "DOTTED") return "2 5";
  return undefined;
}

export function trendLineCanvasDashArray(style: TrendLineStyle["lineStyle"]) {
  if (style === "DASHED") return [8, 6];
  if (style === "DOTTED") return [2, 5];
  return [];
}
