import {
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesPrimitive,
  type PrimitiveHoveredItem,
  type SeriesAttachedParameter,
  type Time,
} from "lightweight-charts";
import {
  distanceToSegment,
  logicalIndexForAnchor,
  trendLineCanvasDashArray,
  type TrendLineDrawing,
  type TrendLineGeometry,
  type TrendLineStyle,
} from "@/lib/market-replay/chart-drawings";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";
import { formatPriceForTick } from "@/lib/market-replay/price-ticks";

export type TrendLinePoint = { x: number; y: number };
export type TrendLineHitPart = "start" | "end" | "line";
export type TrendLineProjectedDrawing = {
  drawing: TrendLineDrawing;
  start: TrendLinePoint;
  end: TrendLinePoint;
  selected: boolean;
};
export type TrendLinePrimitiveSnapshot = {
  drawings: TrendLineDrawing[];
  selectedDrawingId: string | null;
  preview: { id: string; geometry: TrendLineGeometry } | null;
  draft: TrendLineGeometry | null;
  draftStyle: TrendLineStyle;
  bars: AggregatedMarketBarData[];
  displayIntervalSeconds: number;
  priceTickSize: number;
};
export type TrendLineHit = {
  drawingId: string;
  part: TrendLineHitPart;
  distance: number;
  priority: 1 | 2;
};
type ProjectedSnapshot = {
  drawings: TrendLineProjectedDrawing[];
  draft: { start: TrendLinePoint; end: TrendLinePoint } | null;
  draftStyle: TrendLineStyle;
  paneWidth: number;
  paneHeight: number;
  priceTickSize: number;
};

const DEFAULT_DRAFT_STYLE: TrendLineStyle = {
  color: "#2962FF", opacity: 100, width: 2, lineStyle: "SOLID",
  showStartPrice: false, showEndPrice: false,
};
const EMPTY_PROJECTED_SNAPSHOT: ProjectedSnapshot = {
  drawings: [], draft: null, draftStyle: DEFAULT_DRAFT_STYLE, paneWidth: 0, paneHeight: 0, priceTickSize: 0.01,
};
const LINE_HIT_RADIUS = 6;
const HANDLE_HIT_RADIUS = 7;
const HANDLE_RADIUS = 5;

export function encodeTrendLineHitId(drawingId: string, part: TrendLineHitPart) {
  return "trend-line:" + encodeURIComponent(drawingId) + ":" + part;
}

export function decodeTrendLineHitId(value: unknown): { drawingId: string; part: TrendLineHitPart } | null {
  if (typeof value !== "string") return null;
  const match = /^trend-line:(.*):(start|end|line)$/.exec(value);
  if (!match) return null;
  try {
    return { drawingId: decodeURIComponent(match[1]), part: match[2] as TrendLineHitPart };
  } catch {
    return null;
  }
}

function betterHit(current: TrendLineHit | null, candidate: TrendLineHit) {
  if (!current) return candidate;
  if (candidate.priority !== current.priority) return candidate.priority > current.priority ? candidate : current;
  return candidate.distance < current.distance ? candidate : current;
}

export function hitTestTrendLines(drawings: TrendLineProjectedDrawing[], point: TrendLinePoint) {
  let hit: TrendLineHit | null = null;
  for (let index = drawings.length - 1; index >= 0; index -= 1) {
    const item = drawings[index];
    if (item.selected) {
      const startDistance = Math.hypot(point.x - item.start.x, point.y - item.start.y);
      if (startDistance <= HANDLE_HIT_RADIUS) {
        hit = betterHit(hit, { drawingId: item.drawing.id, part: "start", distance: startDistance, priority: 2 });
      }
      const endDistance = Math.hypot(point.x - item.end.x, point.y - item.end.y);
      if (endDistance <= HANDLE_HIT_RADIUS) {
        hit = betterHit(hit, { drawingId: item.drawing.id, part: "end", distance: endDistance, priority: 2 });
      }
    }
    const lineDistance = distanceToSegment(point, item.start, item.end);
    const lineRadius = Math.max(LINE_HIT_RADIUS, item.drawing.style.width / 2 + 4);
    if (lineDistance <= lineRadius) {
      hit = betterHit(hit, { drawingId: item.drawing.id, part: "line", distance: lineDistance, priority: 1 });
    }
  }
  return hit;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawLine(
  context: CanvasRenderingContext2D,
  start: TrendLinePoint,
  end: TrendLinePoint,
  style: TrendLineStyle,
) {
  context.save();
  context.globalAlpha = style.opacity / 100;
  context.strokeStyle = style.color;
  context.lineWidth = style.width;
  context.lineCap = "round";
  context.setLineDash(trendLineCanvasDashArray(style.lineStyle));
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();
}

function drawPriceLabel(
  context: CanvasRenderingContext2D,
  point: TrendLinePoint,
  price: number,
  style: TrendLineStyle,
  priceTickSize: number,
  paneWidth: number,
  paneHeight: number,
) {
  const text = formatPriceForTick(price, priceTickSize);
  context.save();
  context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  const width = Math.ceil(context.measureText(text).width) + 12;
  const height = 18;
  const x = Math.max(6, Math.min(point.x + 7, Math.max(6, paneWidth - width - 6)));
  const y = Math.max(4, Math.min(point.y - 12, Math.max(4, paneHeight - height - 4)));
  context.globalAlpha = style.opacity / 100;
  context.fillStyle = style.color;
  roundedRect(context, x, y, width, height, 3);
  context.fill();
  context.fillStyle = "#ffffff";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(text, x + 6, y + height / 2 + 0.5);
  context.restore();
}

class TrendLinePaneRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly snapshot: () => ProjectedSnapshot) {}

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]): void {
    target.useMediaCoordinateSpace(({ context }) => {
      const snapshot = this.snapshot();
      for (const item of snapshot.drawings) {
        if (item.selected) {
          context.save();
          context.globalAlpha = 0.9;
          context.strokeStyle = "#ffffff";
          context.lineWidth = item.drawing.style.width + 3;
          context.lineCap = "round";
          context.setLineDash([]);
          context.beginPath();
          context.moveTo(item.start.x, item.start.y);
          context.lineTo(item.end.x, item.end.y);
          context.stroke();
          context.restore();
        }
        drawLine(context, item.start, item.end, item.drawing.style);
      }
      if (snapshot.draft) drawLine(context, snapshot.draft.start, snapshot.draft.end, snapshot.draftStyle);
      for (const item of snapshot.drawings) {
        if (item.selected) {
          for (const point of [item.start, item.end]) {
            context.save();
            context.fillStyle = "#ffffff";
            context.strokeStyle = item.drawing.style.color;
            context.lineWidth = 2;
            context.beginPath();
            context.arc(point.x, point.y, HANDLE_RADIUS, 0, Math.PI * 2);
            context.fill();
            context.stroke();
            context.restore();
          }
        }
        if (item.drawing.style.showStartPrice) {
          drawPriceLabel(context, item.start, item.drawing.geometry.start.price, item.drawing.style,
            snapshot.priceTickSize, snapshot.paneWidth, snapshot.paneHeight);
        }
        if (item.drawing.style.showEndPrice) {
          drawPriceLabel(context, item.end, item.drawing.geometry.end.price, item.drawing.style,
            snapshot.priceTickSize, snapshot.paneWidth, snapshot.paneHeight);
        }
      }
    });
  }
}

class TrendLinePaneView implements IPrimitivePaneView {
  private readonly paneRenderer: TrendLinePaneRenderer;

  constructor(snapshot: () => ProjectedSnapshot) {
    this.paneRenderer = new TrendLinePaneRenderer(snapshot);
  }

  zOrder() {
    return "top" as const;
  }

  renderer() {
    return this.paneRenderer;
  }
}

export class TrendLinePrimitive implements ISeriesPrimitive<Time> {
  private chart: SeriesAttachedParameter<Time>["chart"] | null = null;
  private series: SeriesAttachedParameter<Time>["series"] | null = null;
  private requestUpdate: (() => void) | null = null;
  private snapshot: TrendLinePrimitiveSnapshot = {
    drawings: [],
    selectedDrawingId: null,
    preview: null,
    draft: null,
    draftStyle: DEFAULT_DRAFT_STYLE,
    bars: [],
    displayIntervalSeconds: 1,
    priceTickSize: 0.01,
  };
  private projected: ProjectedSnapshot = EMPTY_PROJECTED_SNAPSHOT;
  private readonly views = [new TrendLinePaneView(() => this.projected)];

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.requestRedraw();
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.projected = EMPTY_PROJECTED_SNAPSHOT;
  }

  paneViews() {
    return this.views;
  }

  setDrawings(snapshot: TrendLinePrimitiveSnapshot) {
    this.snapshot = snapshot;
    this.requestRedraw();
  }

  requestRedraw() {
    this.requestUpdate?.();
  }

  updateAllViews() {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) {
      this.projected = EMPTY_PROJECTED_SNAPSHOT;
      return;
    }
    const paneWidth = chart.timeScale().width();
    const paneHeight = chart.panes()[0]?.getHeight() ?? 0;
    const projectGeometry = (geometry: TrendLineGeometry) => {
      const startIndex = logicalIndexForAnchor(geometry.start, this.snapshot.bars, this.snapshot.displayIntervalSeconds);
      const endIndex = logicalIndexForAnchor(geometry.end, this.snapshot.bars, this.snapshot.displayIntervalSeconds);
      if (startIndex === null || endIndex === null) return null;
      const startX = chart.timeScale().logicalToCoordinate(startIndex as never);
      const endX = chart.timeScale().logicalToCoordinate(endIndex as never);
      const startY = series.priceToCoordinate(geometry.start.price);
      const endY = series.priceToCoordinate(geometry.end.price);
      if (startX === null || endX === null || startY === null || endY === null) return null;
      return {
        start: { x: Number(startX), y: Number(startY) },
        end: { x: Number(endX), y: Number(endY) },
      };
    };

    const drawings = this.snapshot.drawings.flatMap((drawing) => {
      const geometry = this.snapshot.preview?.id === drawing.id ? this.snapshot.preview.geometry : drawing.geometry;
      const coordinate = projectGeometry(geometry);
      if (!coordinate) return [];
      return [{
        drawing: geometry === drawing.geometry ? drawing : { ...drawing, geometry },
        ...coordinate,
        selected: drawing.id === this.snapshot.selectedDrawingId,
      }];
    });
    const selected = drawings.filter((item) => item.selected);
    const unselected = drawings.filter((item) => !item.selected);
    this.projected = {
      drawings: [...unselected, ...selected],
      draft: this.snapshot.draft ? projectGeometry(this.snapshot.draft) : null,
      draftStyle: this.snapshot.draftStyle,
      paneWidth,
      paneHeight,
      priceTickSize: this.snapshot.priceTickSize,
    };
  }

  hitTestAt(point: TrendLinePoint) {
    return hitTestTrendLines(this.projected.drawings, point);
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.hitTestAt({ x, y });
    if (!hit) return null;
    return {
      externalId: encodeTrendLineHitId(hit.drawingId, hit.part),
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
