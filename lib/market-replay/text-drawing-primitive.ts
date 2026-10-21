import type { IPrimitivePaneRenderer, ISeriesPrimitive, SeriesAttachedParameter, Time, PrimitiveHoveredItem } from "lightweight-charts";
import { TEXT_MAX_LENGTH, type DrawingAnchor, type TextDrawing, type TextGeometry, type TextDrawingStyle } from "./chart-drawings";
import { TextLayoutCache, TEXT_PADDING, type CachedTextLayout, type TextMeasure } from "./text-layout";
import type { DrawingTimelineLocator } from "./drawing-timeline";

export type TextEditPreview = { id: string | null; geometry: TextGeometry; style: TextDrawingStyle; inline?: boolean };
export type TextEditorPosition = { host: HTMLElement; x: number; y: number; width: number; height: number };
export type TextDrawingApi = {
  previewText: (preview: TextEditPreview | null) => void;
  subscribePosition: (anchor: DrawingAnchor, listener: (position: TextEditorPosition | null) => void) => () => void;
};
export type TextDrawingSnapshot = { drawings: readonly TextDrawing[]; selectedDrawingId: string | null;
  edit: TextEditPreview | null; drag: { id: string; geometry: TextGeometry } | null;
  timeline: DrawingTimelineLocator };
type ProjectedText = { id: string; anchor: DrawingAnchor; x: number; y: number; layout: CachedTextLayout;
  style: TextDrawingStyle; selected: boolean; visible: boolean };
export type TextHit = { drawingId: string; part: "text" | "text-anchor"; distance: number; priority: 0 | 2 };

export class TextDrawingPrimitive implements ISeriesPrimitive<Time> {
  private attachment: SeriesAttachedParameter<Time> | null = null;
  private snapshot: TextDrawingSnapshot | null = null;
  private projected: ProjectedText[] = [];
  private width = 0;
  private height = 0;
  private context: CanvasRenderingContext2D | null = null;
  private cache: TextLayoutCache;
  private fontListener = () => { this.cache.clear(); this.attachment?.requestUpdate(); };
  private readonly view;
  constructor(measure?: TextMeasure) {
    this.cache = new TextLayoutCache(measure ?? ((text, font) => {
      this.context ??= document.createElement("canvas").getContext("2d");
      if (!this.context) return { width: text.length * 18 };
      this.context.font = font; return this.context.measureText(text);
    }));
    const renderer: IPrimitivePaneRenderer = {
      drawBackground: target => target.useMediaCoordinateSpace(({ context }) => this.draw(context, false)),
      draw: target => target.useMediaCoordinateSpace(({ context }) => this.draw(context, true)),
    };
    this.view = { zOrder: () => "top" as const, renderer: () => renderer };
  }
  attached(param: SeriesAttachedParameter<Time>) {
    this.attachment = param;
    if (typeof document !== "undefined") document.fonts?.addEventListener("loadingdone", this.fontListener);
  }
  detached() {
    if (typeof document !== "undefined") document.fonts?.removeEventListener("loadingdone", this.fontListener);
    this.attachment = null; this.snapshot = null; this.projected = []; this.cache.clear(); this.context = null;
  }
  paneViews() { return [this.view]; }
  setDrawings(snapshot: TextDrawingSnapshot) { this.snapshot = snapshot; this.attachment?.requestUpdate(); }
  updateAllViews() {
    const attachment = this.attachment, snapshot = this.snapshot;
    if (!attachment || !snapshot) return;
    this.width = attachment.chart.timeScale().width();
    // Read live pane bounds: volume toggles and pane resizing may not change the drawing snapshot.
    this.height = attachment.chart.panes()[0]?.getHeight() ?? 0;
    const items: ProjectedText[] = [], ids = new Set<string>();
    const project = (id: string, geometry: TextGeometry, style: TextDrawingStyle, selected: boolean) => {
      ids.add(id);
      if (geometry.text.length > TEXT_MAX_LENGTH || !geometry.text.trim()) return;
      const index = snapshot.timeline.logicalIndexForAnchor(geometry.anchor);
      if (index === null) return;
      const x = attachment.chart.timeScale().logicalToCoordinate(index as never), y = attachment.series.priceToCoordinate(geometry.anchor.price);
      if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return;
      // Boxes only extend to the right/down, apart from small italic overhang.
      if (x > this.width + style.fontSize || y > this.height + style.fontSize) return;
      const layout = this.cache.get(id, geometry.text, style);
      items.push({ id, anchor: geometry.anchor, x: Number(x), y: Number(y), layout, style, selected,
        visible: x + layout.right >= 0 && x + layout.left <= this.width && y + layout.bottom >= 0 && y + layout.top <= this.height });
    };
    for (const item of snapshot.drawings) {
      const edit = snapshot.edit?.id === item.id ? snapshot.edit : null;
      // The one active DOM textarea owns this object's text while editing.
      if (edit?.inline) { ids.add(item.id); continue; }
      const geometry = snapshot.drag?.id === item.id ? snapshot.drag.geometry : edit?.geometry ?? item.geometry;
      project(item.id, geometry, edit?.style ?? item.style, item.id === snapshot.selectedDrawingId);
    }
    if (snapshot.edit?.id === null && !snapshot.edit.inline) project("text-placement-preview", snapshot.edit.geometry, snapshot.edit.style, false);
    this.cache.retain(ids);
    this.projected = [...items.filter(item => !item.selected), ...items.filter(item => item.selected)];
  }
  private draw(context: CanvasRenderingContext2D, editing: boolean) {
    context.save(); context.beginPath(); context.rect(0, 0, this.width, this.height); context.clip();
    for (const item of this.projected) {
      if (!item.visible) continue;
      const { x, y, layout, style } = item;
      if (editing) {
        if (!item.selected) continue;
        context.strokeStyle = "#2962FF"; context.lineWidth = 1; context.setLineDash([4, 4]);
        context.strokeRect(x + layout.left, y + layout.top, layout.right - layout.left, layout.bottom - layout.top); context.setLineDash([]);
        context.fillStyle = "#ffffff"; context.fillRect(x - 4, y - 4, 8, 8); context.strokeRect(x - 4, y - 4, 8, 8);
        continue;
      }
      if (style.backgroundEnabled && style.backgroundOpacity > 0) {
        context.globalAlpha = style.backgroundOpacity / 100; context.fillStyle = style.backgroundColor;
        context.fillRect(x, y, layout.width, layout.height); context.globalAlpha = 1;
      }
      if (style.borderEnabled) { context.strokeStyle = style.borderColor; context.lineWidth = 1; context.setLineDash([]); context.strokeRect(x, y, layout.width, layout.height); }
      context.font = layout.font; context.textAlign = "left"; context.textBaseline = "alphabetic"; context.fillStyle = style.color;
      const first = Math.max(0, Math.floor((-y - TEXT_PADDING - style.fontSize) / layout.lineHeight));
      const last = Math.min(layout.lineCount, Math.ceil((this.height - y) / layout.lineHeight));
      for (let i = first; i < last; i++) context.fillText(layout.lineAt(i), x + TEXT_PADDING, y + TEXT_PADDING + style.fontSize + i * layout.lineHeight);
    }
    context.restore();
  }
  hitTestAt(point: { x: number; y: number }): TextHit | null {
    if (point.x < 0 || point.y < 0 || point.x > this.width || point.y > this.height) return null;
    for (let i = this.projected.length - 1; i >= 0; i--) {
      const item = this.projected[i]; if (!item.visible || item.id === "text-placement-preview") continue;
      if (item.selected && Math.hypot(point.x - item.x, point.y - item.y) <= 7)
        return { drawingId: item.id, part: "text-anchor", distance: 0, priority: 2 };
      if (point.x >= item.x + item.layout.left && point.x <= item.x + item.layout.right && point.y >= item.y + item.layout.top && point.y <= item.y + item.layout.bottom)
        return { drawingId: item.id, part: "text", distance: 0, priority: 0 };
    }
    return null;
  }
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.hitTestAt({ x, y });
    return hit ? { externalId: `text:${encodeURIComponent(hit.drawingId)}`, cursorStyle: "move", zOrder: "top",
      hitTestPriority: hit.priority, distance: 0, isBackground: hit.part === "text", itemType: "primitive" } : null;
  }
  getDrawingCoordinates(id: string) { return this.projected.find(item => item.id === id) ?? null; }
  get cacheStats() { return this.cache.stats; }
}
