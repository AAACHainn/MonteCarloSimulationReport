import type { IPrimitivePaneRenderer, ISeriesPrimitive, PrimitiveHoveredItem, SeriesAttachedParameter, Time } from "lightweight-charts";
import { distanceToSegment, type ArrowDrawing, type ArrowDrawingType, type ArrowGeometry } from "./chart-drawings";
import type { DrawingTimelineLocator } from "./drawing-timeline";

type Point = { x: number; y: number };
export type ArrowDragPreview = { id: string; geometry: ArrowGeometry };
export type ArrowSnapshot = { drawings: readonly ArrowDrawing[]; selectedDrawingId: string | null;
  preview: ArrowDragPreview | null; timeline: DrawingTimelineLocator };
export type ArrowHit = { drawingId: string; part: "arrow"; priority: 1; distance: number };
type ProjectedArrow = { drawing: ArrowDrawing; point: Point; selected: boolean };
export const ARROW_HEIGHT = 19;
const HALF_WIDTH = 8;
const HIT_PADDING = 5;
const UP_POINTS: readonly Point[] = [
  { x: 0, y: 0 }, { x: -8, y: 10 }, { x: -4, y: 10 }, { x: -4, y: ARROW_HEIGHT },
  { x: 4, y: ARROW_HEIGHT }, { x: 4, y: 10 }, { x: 8, y: 10 },
];

export function arrowPoints(type: ArrowDrawingType, anchor: Point): Point[] {
  const direction = type === "ARROW_UP" ? 1 : -1;
  return UP_POINTS.map(point => ({ x: anchor.x + point.x, y: anchor.y + direction * point.y }));
}

/** One canvas primitive for all arrows. Projection and clipping happen on chart updates,
 * never during hit tests; pointer movement shares the chart's animation-frame scheduler. */
export class ArrowPrimitive implements ISeriesPrimitive<Time> {
  private attachment: SeriesAttachedParameter<Time> | null = null;
  private snapshot: ArrowSnapshot | null = null;
  private projected: ProjectedArrow[] = [];
  private coordinates = new Map<string, Point>();
  private width = 0;
  private height = 0;
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: target => target.useMediaCoordinateSpace(({ context }) => {
      context.save(); context.beginPath(); context.rect(0, 0, this.width, this.height); context.clip();
      context.lineWidth = 2; context.lineJoin = "round"; context.setLineDash([]);
      for (const item of this.projected) {
        const points = arrowPoints(item.drawing.type, item.point);
        context.fillStyle = item.drawing.style.color;
        context.beginPath(); context.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index++) context.lineTo(points[index].x, points[index].y);
        context.closePath(); context.fill();
        if (item.selected) {
          context.strokeStyle = "#2962FF"; context.fillStyle = "#FFFFFF";
          context.beginPath(); context.arc(item.point.x, item.point.y, 4, 0, Math.PI * 2); context.fill(); context.stroke();
        }
      }
      context.restore();
    }),
  };
  private readonly views = [{ zOrder: () => "top" as const, renderer: () => this.renderer }];
  attached(attachment: SeriesAttachedParameter<Time>) { this.attachment = attachment; attachment.requestUpdate(); }
  detached() { this.attachment = null; this.snapshot = null; this.projected = []; this.coordinates.clear(); }
  paneViews() { return this.views; }
  setDrawings(snapshot: ArrowSnapshot) { this.snapshot = snapshot; this.attachment?.requestUpdate(); }
  updateAllViews() {
    const attached = this.attachment, snapshot = this.snapshot;
    if (!attached || !snapshot) return;
    const scale = attached.chart.timeScale();
    this.width = scale.width(); this.height = attached.chart.panes()[0]?.getHeight() ?? 0;
    this.projected = []; this.coordinates.clear();
    for (const drawing of snapshot.drawings) {
      const geometry = snapshot.preview?.id === drawing.id ? snapshot.preview.geometry : drawing.geometry;
      const index = snapshot.timeline.logicalIndexForAnchor(geometry.anchor);
      if (index === null) continue;
      const x = scale.logicalToCoordinate(index as never);
      // Skip offscreen arrows before the price projection and path allocation.
      if (x === null || !Number.isFinite(x) || x < -HALF_WIDTH - HIT_PADDING || x > this.width + HALF_WIDTH + HIT_PADDING) continue;
      const y = attached.series.priceToCoordinate(geometry.anchor.price);
      if (y === null || !Number.isFinite(y)) continue;
      const direction = drawing.type === "ARROW_UP" ? 1 : -1;
      if (Math.max(y, y + direction * ARROW_HEIGHT) < -HIT_PADDING
        || Math.min(y, y + direction * ARROW_HEIGHT) > this.height + HIT_PADDING) continue;
      const point = { x: Number(x), y: Number(y) };
      this.coordinates.set(drawing.id, point);
      this.projected.push({ drawing, point, selected: drawing.id === snapshot.selectedDrawingId });
    }
  }
  getDrawingCoordinates(id: string) { return this.coordinates.get(id) ?? null; }
  hitTestAt(point: Point): ArrowHit | null {
    if (point.x < 0 || point.x > this.width || point.y < 0 || point.y > this.height) return null;
    let hit: ArrowHit | null = null;
    for (let index = this.projected.length - 1; index >= 0; index--) {
      const item = this.projected[index];
      if (Math.abs(point.x - item.point.x) > HALF_WIDTH + HIT_PADDING) continue;
      const relativeY = (point.y - item.point.y) * (item.drawing.type === "ARROW_UP" ? 1 : -1);
      if (relativeY < -HIT_PADDING || relativeY > ARROW_HEIGHT + HIT_PADDING) continue;
      const points = arrowPoints(item.drawing.type, item.point);
      let distance = Infinity;
      for (let edge = 0; edge < points.length; edge++) {
        distance = Math.min(distance, distanceToSegment(point, points[edge], points[(edge + 1) % points.length]));
      }
      if (distance <= HIT_PADDING && (!hit || distance < hit.distance)) hit = { drawingId: item.drawing.id, part: "arrow", distance, priority: 1 };
    }
    return hit;
  }
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.hitTestAt({ x, y });
    return hit ? { externalId: `arrow:${encodeURIComponent(hit.drawingId)}`, zOrder: "top", cursorStyle: "move" } : null;
  }
}
