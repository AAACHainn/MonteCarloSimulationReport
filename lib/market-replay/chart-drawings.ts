import { z } from "zod";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";

export const DRAWING_TYPE_TREND_LINE = "TREND_LINE" as const;
export const TREND_LINE_STYLES = ["SOLID", "DASHED", "DOTTED"] as const;

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

export const DEFAULT_TREND_LINE_STYLE: TrendLineStyle = {
  color: "#2962FF",
  opacity: 100,
  width: 2,
  lineStyle: "SOLID",
  showStartPrice: false,
  showEndPrice: false,
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

export const createMarketDrawingSchema = z.object({
  type: z.literal(DRAWING_TYPE_TREND_LINE),
  geometry: trendLineGeometrySchema,
  style: trendLineStyleSchema.default(DEFAULT_TREND_LINE_STYLE),
}).strict();

export const updateMarketDrawingSchema = z.object({
  geometry: trendLineGeometrySchema.optional(),
  style: trendLineStyleSchema.optional(),
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

export function serializeMarketDrawing(record: StoredDrawing): TrendLineDrawing {
  if (record.type !== DRAWING_TYPE_TREND_LINE) throw new Error("Unsupported drawing type");
  return {
    id: record.id,
    datasetId: record.datasetId,
    type: DRAWING_TYPE_TREND_LINE,
    geometry: trendLineGeometrySchema.parse(JSON.parse(record.geometry)),
    style: trendLineStyleSchema.parse(JSON.parse(record.style)),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
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
