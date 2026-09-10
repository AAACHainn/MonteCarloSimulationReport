import {
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesPrimitive,
  type PrimitiveHoveredItem,
  type SeriesAttachedParameter,
  type Time,
} from "lightweight-charts";
import {
  DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
  distanceToSegment,
  fibonacciPriceAtLevel,
  logicalIndexForAnchor,
  trendLineCanvasDashArray,
  type FibonacciRetracementDrawing,
  type TrendLineGeometry,
} from "@/lib/market-replay/chart-drawings";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";
import { formatPriceForTick } from "@/lib/market-replay/price-ticks";

export type FibonacciPoint = { x: number; y: number };
export type FibonacciHitPart = "start" | "end" | "line";
export type FibonacciHit = {
  drawingId: string;
  part: FibonacciHitPart;
  distance: number;
  priority: 1 | 2;
};
type ProjectedLevel = { value: number; price: number; color: string; y: number };
type ProjectedDrawing = {
  drawing: FibonacciRetracementDrawing;
  start: FibonacciPoint;
  end: FibonacciPoint;
  levels: ProjectedLevel[];
  selected: boolean;
};
type ProjectedSnapshot = {
  drawings: ProjectedDrawing[];
  draft: ProjectedDrawing | null;
  paneWidth: number;
  paneHeight: number;
  priceTickSize: number;
};
export type FibonacciRetracementPrimitiveSnapshot = {
  drawings: FibonacciRetracementDrawing[];
  selectedDrawingId: string | null;
  preview: { id: string; geometry: TrendLineGeometry } | null;
  draft: TrendLineGeometry | null;
  draftStyle: FibonacciRetracementDrawing["style"];
  bars: AggregatedMarketBarData[];
  displayIntervalSeconds: number;
  priceTickSize: number;
};

const EMPTY_PROJECTED: ProjectedSnapshot = {
  drawings: [], draft: null, paneWidth: 0, paneHeight: 0, priceTickSize: 0.01,
};
const LINE_HIT_RADIUS = 6;
const HANDLE_HIT_RADIUS = 7;
const HANDLE_RADIUS = 5;

function betterHit(current: FibonacciHit | null, candidate: FibonacciHit) {
  if (!current) return candidate;
  if (candidate.priority !== current.priority) return candidate.priority > current.priority ? candidate : current;
  return candidate.distance < current.distance ? candidate : current;
}

export function hitTestFibonacciRetracements(drawings: ProjectedDrawing[], point: FibonacciPoint) {
  let hit: FibonacciHit | null = null;
  for (let index = drawings.length - 1; index >= 0; index -= 1) {
    const item = drawings[index];
    if (item.selected) {
      for (const [part, anchor] of [["start", item.start], ["end", item.end]] as const) {
        const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
        if (distance <= HANDLE_HIT_RADIUS) {
          hit = betterHit(hit, { drawingId: item.drawing.id, part, distance, priority: 2 });
        }
      }
    }
    const left = Math.min(item.start.x, item.end.x);
    const right = Math.max(item.start.x, item.end.x);
    for (const level of item.levels) {
      const distance = distanceToSegment(point, { x: left, y: level.y }, { x: right, y: level.y });
      if (distance <= Math.max(LINE_HIT_RADIUS, item.drawing.style.width / 2 + 4)) {
        hit = betterHit(hit, { drawingId: item.drawing.id, part: "line", distance, priority: 1 });
      }
    }
  }
  return hit;
}

function drawLevels(
  context: CanvasRenderingContext2D,
  item: ProjectedDrawing,
  priceTickSize: number,
) {
  const left = Math.min(item.start.x, item.end.x);
  const right = Math.max(item.start.x, item.end.x);
  const style = item.drawing.style;
  context.save();
  context.lineCap = "round";
  context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  context.textBaseline = "bottom";
  for (const level of item.levels) {
    context.strokeStyle = level.color;
    context.lineWidth = style.width;
    context.setLineDash(trendLineCanvasDashArray(style.lineStyle));
    context.beginPath();
    context.moveTo(left, level.y);
    context.lineTo(right, level.y);
    context.stroke();

    const text = `${level.value}  ${formatPriceForTick(level.price, priceTickSize)}`;
    const textWidth = context.measureText(text).width;
    context.fillStyle = "rgba(255,255,255,.86)";
    context.fillRect(left + 3, level.y - 14, textWidth + 6, 13);
    context.fillStyle = level.color;
    context.fillText(text, left + 6, level.y - 2);
  }
  context.restore();
}

class FibonacciPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly snapshot: () => ProjectedSnapshot) {}

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]): void {
    target.useMediaCoordinateSpace(({ context }) => {
      const snapshot = this.snapshot();
      for (const item of snapshot.drawings) {
        drawLevels(context, item, snapshot.priceTickSize);
      }
      if (snapshot.draft) drawLevels(context, snapshot.draft, snapshot.priceTickSize);
      for (const item of snapshot.drawings) {
        if (!item.selected) continue;
        for (const point of [item.start, item.end]) {
          context.save();
          context.fillStyle = "#ffffff";
          context.strokeStyle = "#2962FF";
          context.lineWidth = 2;
          context.beginPath();
          context.arc(point.x, point.y, HANDLE_RADIUS, 0, Math.PI * 2);
          context.fill();
          context.stroke();
          context.restore();
        }
      }
    });
  }
}

class FibonacciPaneView implements IPrimitivePaneView {
  private readonly paneRenderer: FibonacciPaneRenderer;
  constructor(snapshot: () => ProjectedSnapshot) { this.paneRenderer = new FibonacciPaneRenderer(snapshot); }
  zOrder() { return "top" as const; }
  renderer() { return this.paneRenderer; }
}

export class FibonacciRetracementPrimitive implements ISeriesPrimitive<Time> {
  private chart: SeriesAttachedParameter<Time>["chart"] | null = null;
  private series: SeriesAttachedParameter<Time>["series"] | null = null;
  private requestUpdate: (() => void) | null = null;
  private snapshot: FibonacciRetracementPrimitiveSnapshot = {
    drawings: [], selectedDrawingId: null, preview: null, draft: null,
    draftStyle: DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
    bars: [], displayIntervalSeconds: 1, priceTickSize: 0.01,
  };
  private projected: ProjectedSnapshot = EMPTY_PROJECTED;
  private readonly views = [new FibonacciPaneView(() => this.projected)];

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.requestRedraw();
  }
  detached() {
    this.chart = null; this.series = null; this.requestUpdate = null; this.projected = EMPTY_PROJECTED;
  }
  paneViews() { return this.views; }
  setDrawings(snapshot: FibonacciRetracementPrimitiveSnapshot) { this.snapshot = snapshot; this.requestRedraw(); }
  requestRedraw() { this.requestUpdate?.(); }

  updateAllViews() {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) { this.projected = EMPTY_PROJECTED; return; }
    const project = (drawing: FibonacciRetracementDrawing, geometry: TrendLineGeometry, selected: boolean) => {
      const startIndex = logicalIndexForAnchor(geometry.start, this.snapshot.bars, this.snapshot.displayIntervalSeconds);
      const endIndex = logicalIndexForAnchor(geometry.end, this.snapshot.bars, this.snapshot.displayIntervalSeconds);
      if (startIndex === null || endIndex === null) return null;
      const startX = chart.timeScale().logicalToCoordinate(startIndex as never);
      const endX = chart.timeScale().logicalToCoordinate(endIndex as never);
      const startY = series.priceToCoordinate(geometry.start.price);
      const endY = series.priceToCoordinate(geometry.end.price);
      if (startX === null || endX === null || startY === null || endY === null) return null;
      const levels = drawing.style.levels.flatMap((level) => {
        if (!level.enabled) return [];
        const price = fibonacciPriceAtLevel(geometry, level.value);
        const y = series.priceToCoordinate(price);
        return y === null ? [] : [{ value: level.value, price, color: level.color, y: Number(y) }];
      });
      return {
        drawing: geometry === drawing.geometry ? drawing : { ...drawing, geometry },
        start: { x: Number(startX), y: Number(startY) },
        end: { x: Number(endX), y: Number(endY) },
        levels,
        selected,
      };
    };
    const drawings = this.snapshot.drawings.flatMap((drawing) => {
      const geometry = this.snapshot.preview?.id === drawing.id ? this.snapshot.preview.geometry : drawing.geometry;
      const item = project(drawing, geometry, drawing.id === this.snapshot.selectedDrawingId);
      return item ? [item] : [];
    });
    const draftDrawing: FibonacciRetracementDrawing = {
      id: "fib-draft", datasetId: "", type: "FIB_RETRACEMENT",
      geometry: this.snapshot.draft ?? { start: { timestamp: new Date(0).toISOString(), sourceSequence: null, price: 0 }, end: { timestamp: new Date(0).toISOString(), sourceSequence: null, price: 0 } },
      style: this.snapshot.draftStyle, createdAt: "", updatedAt: "",
    };
    this.projected = {
      drawings: [...drawings.filter((item) => !item.selected), ...drawings.filter((item) => item.selected)],
      draft: this.snapshot.draft ? project(draftDrawing, this.snapshot.draft, false) : null,
      paneWidth: chart.timeScale().width(),
      paneHeight: chart.panes()[0]?.getHeight() ?? 0,
      priceTickSize: this.snapshot.priceTickSize,
    };
  }

  hitTestAt(point: FibonacciPoint) { return hitTestFibonacciRetracements(this.projected.drawings, point); }
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.hitTestAt({ x, y });
    if (!hit) return null;
    return {
      externalId: `fibonacci:${encodeURIComponent(hit.drawingId)}:${hit.part}`,
      cursorStyle: hit.part === "line" ? "move" : "crosshair",
      distance: hit.distance,
      hitTestPriority: hit.priority,
      itemType: "primitive",
      zOrder: "top",
    };
  }
  getDrawingCoordinates(drawingId: string) {
    return this.projected.drawings.find((item) => item.drawing.id === drawingId) ?? null;
  }
}
