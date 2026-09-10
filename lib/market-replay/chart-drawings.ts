import { z } from "zod";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";

export const DRAWING_TYPE_TREND_LINE = "TREND_LINE" as const;
export const DRAWING_TYPE_FIB_RETRACEMENT = "FIB_RETRACEMENT" as const;
export const TREND_LINE_STYLES = ["SOLID", "DASHED", "DOTTED"] as const;
export const DRAWING_TYPES = [DRAWING_TYPE_TREND_LINE, DRAWING_TYPE_FIB_RETRACEMENT] as const;

export type DrawingType = (typeof DRAWING_TYPES)[number];
export type DrawingTool = DrawingType;

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

export type MarketDrawing = TrendLineDrawing | FibonacciRetracementDrawing;
export type MarketDrawingStyle = TrendLineStyle | FibonacciRetracementStyle;

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

export const fibonacciLevelSchema = z.object({
  value: finiteNumber.min(-10).max(10),
  enabled: z.boolean(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
}).strict();

export const fibonacciRetracementStyleSchema = z.object({
  width: z.number().int().min(1).max(4),
  lineStyle: z.enum(TREND_LINE_STYLES),
  levels: z.array(fibonacciLevelSchema).min(1).max(10),
}).strict().refine(
  (style) => new Set(style.levels.map((level) => level.value)).size === style.levels.length,
  { message: "Fibonacci levels must be unique", path: ["levels"] },
);

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
  geometry: trendLineGeometrySchema.optional(),
  style: z.union([trendLineStyleSchema, fibonacciRetracementStyleSchema]).optional(),
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
    geometry: trendLineGeometrySchema.parse(JSON.parse(record.geometry)),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
  if (record.type === DRAWING_TYPE_TREND_LINE) return {
    ...base,
    type: DRAWING_TYPE_TREND_LINE,
    style: trendLineStyleSchema.parse(JSON.parse(record.style)),
  };
  if (record.type === DRAWING_TYPE_FIB_RETRACEMENT) return {
    ...base,
    type: DRAWING_TYPE_FIB_RETRACEMENT,
    style: fibonacciRetracementStyleSchema.parse(JSON.parse(record.style)),
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
  return type === DRAWING_TYPE_TREND_LINE
    ? trendLineStyleSchema.safeParse(style).success
    : fibonacciRetracementStyleSchema.safeParse(style).success;
}

export function fibonacciPriceAtLevel(geometry: TrendLineGeometry, level: number) {
  return geometry.start.price + (geometry.end.price - geometry.start.price) * level;
}

export function anchorForLogicalIndex({
  logicalIndex,
  price,
  bars,
  displayIntervalSeconds,
}: {
  logicalIndex: number;
  price: number;
  bars: AggregatedMarketBarData[];
  displayIntervalSeconds: number;
}): DrawingAnchor {
  const index = Math.round(logicalIndex);
  const bar = bars[index];
  if (bar) return { timestamp: bar.timestamp, sourceSequence: bar.firstSequence, price };
  const referenceIndex = index < 0 ? 0 : bars.length - 1;
  const reference = bars[referenceIndex];
  const timestamp = reference
    ? new Date(new Date(reference.timestamp).getTime() + (index - referenceIndex) * displayIntervalSeconds * 1_000).toISOString()
    : new Date(0).toISOString();
  return { timestamp, sourceSequence: null, price };
}

export function logicalIndexForAnchor(
  anchor: DrawingAnchor,
  bars: AggregatedMarketBarData[],
  displayIntervalSeconds: number,
) {
  if (!bars.length) return null;
  if (anchor.sourceSequence !== null) {
    const sequenceIndex = bars.findIndex((bar) => (
      anchor.sourceSequence! >= bar.firstSequence && anchor.sourceSequence! <= bar.lastSequence
    ));
    if (sequenceIndex >= 0) return sequenceIndex;
  }
  const target = new Date(anchor.timestamp).getTime();
  if (!Number.isFinite(target)) return null;
  const exact = bars.findIndex((bar) => new Date(bar.timestamp).getTime() === target);
  if (exact >= 0) return exact;
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
