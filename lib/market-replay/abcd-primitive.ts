import type { IPrimitivePaneRenderer, ISeriesPrimitive, PrimitiveHoveredItem, SeriesAttachedParameter, Time } from "lightweight-charts";
import { abcdPriceAtLevel, distanceToSegment, trendLineCanvasDashArray, type AbcdDrawing, type AbcdGeometry, type FibonacciRetracementStyle } from "./chart-drawings";
import { type AbcdCoordinates, type AbcdDraft, type AbcdHitPart, type AbcdPoint } from "./abcd-interaction";
import type { DrawingTimelineLocator } from "./drawing-timeline";
import { segmentIntersectsViewport } from "./drawing-viewport";
import { formatPriceForTick } from "./price-ticks";
import { copy } from "@/lib/i18n";

export type AbcdPreview = { id: string; geometry: AbcdGeometry };
export type AbcdSnapshot = { drawings: readonly AbcdDrawing[]; selectedDrawingId: string | null; preview: AbcdPreview | null;
  draft: AbcdDraft | null; draftStyle: FibonacciRetracementStyle; timeline: DrawingTimelineLocator; priceTickSize: number };
export type AbcdHit = { drawingId: string; part: AbcdHitPart; priority: 1 | 2; distance: number };
type Segment = { start: AbcdPoint; end: AbcdPoint; color: string; visible: boolean; price?: number; level?: number };
type Projected = { id: string; coordinates: AbcdCoordinates; style: FibonacciRetracementStyle; selected: boolean; draft: boolean; segments: Segment[] };

/** All objects share the chart-owned timeline and a single canvas primitive. */
export class AbcdPrimitive implements ISeriesPrimitive<Time> {
  private attachment: SeriesAttachedParameter<Time> | null = null;
  private snapshot: AbcdSnapshot | null = null;
  private projected: Projected[] = [];
  private coordinates = new Map<string, AbcdCoordinates>();
  private width = 0;
  private height = 0;
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: target => target.useMediaCoordinateSpace(({ context }) => {
      context.save(); context.beginPath(); context.rect(0, 0, this.width, this.height); context.clip();
      context.lineCap = "round"; context.font = "600 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      context.textBaseline = "bottom";
      for (const item of this.projected) {
        context.lineWidth = item.style.width; context.setLineDash(trendLineCanvasDashArray(item.style.lineStyle));
        for (const segment of item.segments) {
          if (!segment.visible) continue;
          context.strokeStyle = segment.color;
          context.beginPath(); context.moveTo(segment.start.x, segment.start.y); context.lineTo(segment.end.x, segment.end.y); context.stroke();
          if (segment.level === undefined || (!item.style.showLevels && !item.style.showPrices)) continue;
          const levelLabel = segment.level === 0 ? copy.marketReplay.abcdCLabel : segment.level === 1 ? copy.marketReplay.abcdDLabel : String(segment.level);
          const text = [...(item.style.showLevels ? [levelLabel] : []),
            ...(item.style.showPrices ? [formatPriceForTick(segment.price!, this.snapshot!.priceTickSize)] : [])].join("  ");
          const x = Math.max(0, segment.start.x) + 3, y = segment.start.y;
          const width = context.measureText(text).width;
          context.fillStyle = "rgba(255,255,255,.86)"; context.fillRect(x, y - 15, width + 6, 14);
          context.fillStyle = segment.color; context.fillText(text, x + 3, y - 2);
        }
      }
      context.setLineDash([]); context.lineWidth = 2;
      for (const item of this.projected) if (item.selected || item.draft) {
        context.strokeStyle = "#2962FF"; context.fillStyle = "#FFFFFF";
        // Only A, B, C are editable anchors; the D level never gets a handle.
        for (const point of Object.values(item.coordinates)) {
          if (point.x < -5 || point.x > this.width + 5 || point.y < -5 || point.y > this.height + 5) continue;
          context.beginPath(); context.arc(point.x, point.y, 5, 0, Math.PI * 2); context.fill(); context.stroke();
        }
      }
      context.restore();
    }),
  };
  private readonly views = [{ zOrder: () => "top" as const, renderer: () => this.renderer }];
  attached(attachment: SeriesAttachedParameter<Time>) { this.attachment = attachment; attachment.requestUpdate(); }
  detached() { this.attachment = null; this.snapshot = null; this.projected = []; this.coordinates.clear(); }
  paneViews() { return this.views; }
  setDrawings(snapshot: AbcdSnapshot) { this.snapshot = snapshot; this.attachment?.requestUpdate(); }
  updateAllViews() {
    const attached = this.attachment, snapshot = this.snapshot;
    if (!attached || !snapshot) return;
    const scale = attached.chart.timeScale();
    this.width = scale.width(); this.height = attached.chart.panes()[0]?.getHeight() ?? 0;
    this.projected = []; this.coordinates.clear();
    const project = (id: string, geometry: AbcdGeometry, style: FibonacciRetracementStyle, selected: boolean, draft: boolean, showLevels: boolean) => {
      const x = {} as Record<keyof AbcdGeometry, number>;
      for (const key of ["a", "b", "c"] as const) {
        const index = snapshot.timeline.logicalIndexForAnchor(geometry[key]);
        const coordinate = index === null ? null : scale.logicalToCoordinate(index as never);
        if (coordinate === null || !Number.isFinite(coordinate)) return;
        x[key] = Number(coordinate);
      }
      if (Math.max(x.a, x.b, x.c) < -8 || Math.min(x.a, x.b, x.c) > this.width + 8) return;
      const coordinates = {} as AbcdCoordinates;
      for (const key of ["a", "b", "c"] as const) {
        const y = attached.series.priceToCoordinate(geometry[key].price);
        if (y === null || !Number.isFinite(y)) return;
        coordinates[key] = { x: x[key], y: Number(y) };
      }
      const segments: Segment[] = [];
      const add = (start: AbcdPoint, end: AbcdPoint, color: string, extra: Partial<Segment> = {}) => {
        segments.push({ start, end, color, visible: segmentIntersectsViewport(start, end, this.width, this.height), ...extra });
      };
      const guideColor = style.singleColor ?? style.levels.find(level => level.enabled)?.color ?? "#2962FF";
      add(coordinates.a, coordinates.b, guideColor);
      if (showLevels) {
        add(coordinates.b, coordinates.c, guideColor);
        const left = Math.min(x.b, x.c), right = Math.max(x.b, x.c);
        for (const level of style.levels) {
          if (!level.enabled) continue;
          const price = abcdPriceAtLevel(geometry, level.value);
          if (!Number.isFinite(price)) continue;
          const y = attached.series.priceToCoordinate(price);
          if (y === null || !Number.isFinite(y)) continue;
          add({ x: left, y: Number(y) }, { x: right, y: Number(y) }, style.singleColor ?? level.color, { price, level: level.value });
        }
      }
      if (!draft) this.coordinates.set(id, coordinates);
      this.projected.push({ id, coordinates, style, selected, draft, segments });
    };
    // Selected objects render last, matching handle hit priority.
    for (const selected of [false, true]) for (const drawing of snapshot.drawings) {
      if ((drawing.id === snapshot.selectedDrawingId) !== selected) continue;
      project(drawing.id, snapshot.preview?.id === drawing.id ? snapshot.preview.geometry : drawing.geometry, drawing.style, selected, false, true);
    }
    if (snapshot.draft) project("abcd-draft", snapshot.draft.geometry, snapshot.draftStyle, false, true, snapshot.draft.stage === "c");
  }
  getDrawingCoordinates(id: string) { return this.coordinates.get(id) ?? null; }
  hitTestAt(point: AbcdPoint): AbcdHit | null {
    if (point.x < 0 || point.x > this.width || point.y < 0 || point.y > this.height) return null;
    let hit: AbcdHit | null = null;
    const consider = (candidate: AbcdHit) => {
      if (!hit || candidate.priority > hit.priority || candidate.priority === hit.priority && candidate.distance < hit.distance) hit = candidate;
    };
    for (let index = this.projected.length - 1; index >= 0; index--) {
      const item = this.projected[index];
      if (item.draft) continue;
      if (item.selected) for (const part of ["a", "b", "c"] as const) {
        const distance = Math.hypot(point.x - item.coordinates[part].x, point.y - item.coordinates[part].y);
        if (distance <= 7) consider({ drawingId: item.id, part, priority: 2, distance });
      }
      for (const segment of item.segments) {
        if (!segment.visible) continue;
        const distance = distanceToSegment(point, segment.start, segment.end);
        if (distance <= Math.max(6, item.style.width / 2 + 4)) consider({ drawingId: item.id, part: "line", priority: 1, distance });
      }
    }
    return hit;
  }
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.hitTestAt({ x, y });
    return hit ? { externalId: `abcd:${encodeURIComponent(hit.drawingId)}:${hit.part}`, zOrder: "top", cursorStyle: hit.part === "line" ? "move" : "crosshair" } : null;
  }
}
