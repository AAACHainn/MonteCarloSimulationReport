import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, PrimitiveHoveredItem,
  SeriesAttachedParameter, Time } from "lightweight-charts";
import { DEFAULT_RECTANGLE_STYLE, trendLineCanvasDashArray, type RectangleDrawing,
  type RectangleStyle, type TrendLineGeometry, type DrawingAnchor } from "./chart-drawings";
import { DrawingTimelineLocator, type DrawingTimelineBar } from "./drawing-timeline";
import type { TradingSessionConfig } from "./types";

export type RectanglePoint = { x: number; y: number };
export type RectangleHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type RectangleHit = { drawingId: string; part: RectangleHandle | "line"; distance: number; priority: 0 | 1 | 2 };
type ProjectedRectangle = { drawing: RectangleDrawing; start: RectanglePoint; end: RectanglePoint; selected: boolean; visible: boolean };
export type RectanglePrimitiveSnapshot = {
  drawings: RectangleDrawing[]; selectedDrawingId: string | null;
  preview: { id: string; geometry: TrendLineGeometry } | null;
  draft: TrendLineGeometry | null; draftStyle: RectangleStyle;
  bars: readonly DrawingTimelineBar[]; timeline?: DrawingTimelineLocator;
  displayIntervalSeconds: number; sourceIntervalSeconds: number; session: TradingSessionConfig;
};

export function rectangleBounds(start: RectanglePoint, end: RectanglePoint) {
  return { left: Math.min(start.x, end.x), right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) };
}

export function rectangleHandles(start: RectanglePoint, end: RectanglePoint): Record<RectangleHandle, RectanglePoint> {
  const b = rectangleBounds(start, end), x = (b.left + b.right) / 2, y = (b.top + b.bottom) / 2;
  return { nw: { x: b.left, y: b.top }, n: { x, y: b.top }, ne: { x: b.right, y: b.top },
    e: { x: b.right, y }, se: { x: b.right, y: b.bottom }, s: { x, y: b.bottom },
    sw: { x: b.left, y: b.bottom }, w: { x: b.left, y } };
}

/** Each move uses the original bounds, so crossing an opposite edge remains stable. */
export function resizeRectangle(start: RectanglePoint, end: RectanglePoint, handle: RectangleHandle, point: RectanglePoint) {
  const b = rectangleBounds(start, end);
  if (handle.includes("w")) b.left = point.x;
  if (handle.includes("e")) b.right = point.x;
  if (handle.includes("n")) b.top = point.y;
  if (handle.includes("s")) b.bottom = point.y;
  return { start: { x: b.left, y: b.top }, end: { x: b.right, y: b.bottom } };
}

/** Preserve untouched source anchors, including anchors inside a higher-period bucket. */
export function resizeRectangleGeometry(geometry: TrendLineGeometry, start: RectanglePoint, end: RectanglePoint,
  handle: RectangleHandle, point: RectanglePoint, anchorAt: (point: RectanglePoint) => DrawingAnchor | null): TrendLineGeometry | null {
  const resized = resizeRectangle(start, end, handle, point);
  const startLeft = start.x <= end.x, startTop = start.y <= end.y;
  const resolve = (original: DrawingAnchor, left: boolean, top: boolean) => {
    const changeTime = handle.includes(left ? "w" : "e"), changePrice = handle.includes(top ? "n" : "s");
    if (!changeTime && !changePrice) return original;
    const anchor = anchorAt({ x: left ? resized.start.x : resized.end.x, y: top ? resized.start.y : resized.end.y });
    if (!anchor) return null;
    return { timestamp: changeTime ? anchor.timestamp : original.timestamp,
      sourceSequence: changeTime ? anchor.sourceSequence : original.sourceSequence,
      price: changePrice ? anchor.price : original.price };
  };
  const a = resolve(geometry.start, startLeft, startTop), b = resolve(geometry.end, !startLeft, !startTop);
  return a && b ? { start: a, end: b } : null;
}

export function hitTestRectangles(drawings: readonly ProjectedRectangle[], point: RectanglePoint): RectangleHit | null {
  let hit: RectangleHit | null = null;
  const consider = (candidate: RectangleHit) => {
    if (!hit || candidate.priority > hit.priority || (candidate.priority === hit.priority && candidate.distance < hit.distance)) hit = candidate;
  };
  for (let index = drawings.length - 1; index >= 0; index--) {
    const item = drawings[index];
    if (!item.visible) continue;
    const b = rectangleBounds(item.start, item.end);
    if (point.x < b.left - 7 || point.x > b.right + 7 || point.y < b.top - 7 || point.y > b.bottom + 7) continue;
    if (item.selected) for (const [part, p] of Object.entries(rectangleHandles(item.start, item.end))) {
      const distance = Math.hypot(point.x - p.x, point.y - p.y);
      if (distance <= 7) consider({ drawingId: item.drawing.id, part: part as RectangleHandle, distance, priority: 2 });
    }
    const dx = Math.max(b.left - point.x, 0, point.x - b.right);
    const dy = Math.max(b.top - point.y, 0, point.y - b.bottom);
    const inside = dx === 0 && dy === 0;
    const distance = inside ? Math.min(point.x - b.left, b.right - point.x, point.y - b.top, b.bottom - point.y) : Math.hypot(dx, dy);
    if (distance <= Math.max(6, item.drawing.style.borderWidth / 2 + 4)) {
      consider({ drawingId: item.drawing.id, part: "line", distance, priority: 1 });
    } else if (inside && item.selected) {
      consider({ drawingId: item.drawing.id, part: "line", distance: 0, priority: 0 });
    }
  }
  return hit;
}

export class RectanglePrimitive implements ISeriesPrimitive<Time> {
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private snapshot: RectanglePrimitiveSnapshot | null = null;
  private readonly timeline = new DrawingTimelineLocator();
  private projected: ProjectedRectangle[] = [];
  private coordinates = new Map<string, ProjectedRectangle>();
  private draft: { start: RectanglePoint; end: RectanglePoint } | null = null;
  private width = 0;
  private height = 0;
  private readonly views: IPrimitivePaneView[] = [this.view("bottom"), this.view("top")];

  private view(layer: "bottom" | "top"): IPrimitivePaneView {
    return { zOrder: () => layer, renderer: () => ({ draw: target => {
      target.useMediaCoordinateSpace(({ context }) => {
        context.save();
        context.beginPath(); context.rect(0, 0, this.width, this.height); context.clip();
        const draw = (start: RectanglePoint, end: RectanglePoint, style: RectangleStyle, selected: boolean, draft = false) => {
          const b = rectangleBounds(start, end);
          if (b.right < 0 || b.left > this.width || b.bottom < 0 || b.top > this.height) return;
          context.save();
          if (layer === "bottom" && style.fillOpacity > 0) {
            context.globalAlpha = style.fillOpacity / 100; context.fillStyle = style.fillColor;
            const x = Math.max(0, b.left), y = Math.max(0, b.top);
            context.fillRect(x, y, Math.min(this.width, b.right) - x, Math.min(this.height, b.bottom) - y);
          }
          if (layer === "top") {
            if (style.borderStyle !== "NONE") {
              context.strokeStyle = style.borderColor; context.lineWidth = style.borderWidth;
              context.setLineDash(trendLineCanvasDashArray(style.borderStyle));
              context.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
            }
            if (selected || draft) {
              context.strokeStyle = DEFAULT_RECTANGLE_STYLE.borderColor; context.lineWidth = 1; context.setLineDash([4, 4]);
              context.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
              context.setLineDash([]);
              if (selected) for (const p of Object.values(rectangleHandles(start, end))) {
                context.fillStyle = "#ffffff"; context.lineWidth = 2;
                context.fillRect(p.x - 4, p.y - 4, 8, 8); context.strokeRect(p.x - 4, p.y - 4, 8, 8);
              }
            }
          }
          context.restore();
        };
        for (const item of this.projected) if (item.visible) draw(item.start, item.end, item.drawing.style, item.selected);
        if (this.draft) draw(this.draft.start, this.draft.end, this.snapshot!.draftStyle, false, true);
        context.restore();
      });
    } } satisfies IPrimitivePaneRenderer) };
  }

  attached(param: SeriesAttachedParameter<Time>) { this.attachedTo = param; param.requestUpdate(); }
  detached() { this.attachedTo = null; this.snapshot = null; this.projected = []; this.coordinates.clear(); this.draft = null; }
  paneViews() { return this.views; }
  setDrawings(snapshot: RectanglePrimitiveSnapshot) {
    this.snapshot = snapshot;
    if (!snapshot.timeline) this.timeline.setTimeline(snapshot.bars, snapshot.displayIntervalSeconds, {
      sourceIntervalSeconds: snapshot.sourceIntervalSeconds, session: snapshot.session,
    });
    this.attachedTo?.requestUpdate();
  }
  updateAllViews() {
    const attached = this.attachedTo, snapshot = this.snapshot;
    if (!attached || !snapshot) return;
    const scale = attached.chart.timeScale();
    this.width = scale.width(); this.height = attached.chart.panes()[0]?.getHeight() ?? 0;
    const project = (geometry: TrendLineGeometry) => {
      const locator = snapshot.timeline ?? this.timeline;
      const a = locator.logicalIndexForAnchor(geometry.start), b = locator.logicalIndexForAnchor(geometry.end);
      if (a === null || b === null) return null;
      const x1 = scale.logicalToCoordinate(a as never), x2 = scale.logicalToCoordinate(b as never);
      const y1 = attached.series.priceToCoordinate(geometry.start.price), y2 = attached.series.priceToCoordinate(geometry.end.price);
      if (x1 === null || x2 === null || y1 === null || y2 === null || ![x1, x2, y1, y2].every(Number.isFinite)) return null;
      return { start: { x: Number(x1), y: Number(y1) }, end: { x: Number(x2), y: Number(y2) } };
    };
    const unselected: ProjectedRectangle[] = [], selected: ProjectedRectangle[] = [];
    this.coordinates.clear();
    for (const drawing of snapshot.drawings) {
      const geometry = snapshot.preview?.id === drawing.id ? snapshot.preview.geometry : drawing.geometry;
      const p = project(geometry);
      if (!p) continue;
      const b = rectangleBounds(p.start, p.end);
      const item = { ...p, drawing: geometry === drawing.geometry ? drawing : { ...drawing, geometry },
        selected: drawing.id === snapshot.selectedDrawingId,
        visible: b.right >= -7 && b.left <= this.width + 7 && b.bottom >= -7 && b.top <= this.height + 7 };
      this.coordinates.set(drawing.id, item);
      (item.selected ? selected : unselected).push(item);
    }
    this.projected = [...unselected, ...selected];
    this.draft = snapshot.draft ? project(snapshot.draft) : null;
  }
  hitTestAt(point: RectanglePoint) {
    if (point.x < 0 || point.y < 0 || point.x > this.width || point.y > this.height) return null;
    return hitTestRectangles(this.projected, point);
  }
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.hitTestAt({ x, y });
    return hit ? { externalId: `rectangle:${encodeURIComponent(hit.drawingId)}:${hit.part}`, cursorStyle: hit.part === "line" ? "move" : `${hit.part}-resize`,
      distance: hit.distance, hitTestPriority: hit.priority, itemType: "primitive", zOrder: "top" } : null;
  }
  getDrawingCoordinates(id: string) { return this.coordinates.get(id) ?? null; }
}
