import {
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesPrimitive,
  type SeriesAttachedParameter,
  type Time,
} from "lightweight-charts";
import { copy } from "@/lib/i18n";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";
import type {
  PaperOrderType,
  ReplayTradeAnnotationData,
} from "@/lib/paper-trading/types";

export const REPLAY_TRADE_ANNOTATION_COLORS = [
  "#2563eb",
  "#d97706",
  "#059669",
  "#dc2626",
  "#7c3aed",
] as const;

export const REPLAY_TRADE_ANNOTATION_LINE_LENGTH = 20;
const LABEL_GAP = 4;
const LABEL_HEIGHT = 14;
const LABEL_LANE_GAP = 2;
const MAX_LABEL_OFFSET_STEPS = 24;

export type ReplayTradePriceAnnotation = {
  key: string;
  no: number;
  sequence: number;
  price: number;
  color: string;
  label: string;
};

type ProjectedTradePriceAnnotation = ReplayTradePriceAnnotation & {
  x: number;
  y: number;
};

type PrimitiveSnapshot = {
  entries: ReplayTradeAnnotationData[];
  bars: AggregatedMarketBarData[];
};

type ProjectedSnapshot = {
  annotations: ProjectedTradePriceAnnotation[];
  paneWidth: number;
  paneHeight: number;
};

const EMPTY_PROJECTED_SNAPSHOT: ProjectedSnapshot = {
  annotations: [],
  paneWidth: 0,
  paneHeight: 0,
};

function barIndexForSequence(bars: AggregatedMarketBarData[], sequence: number) {
  let low = 0;
  let high = bars.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const bar = bars[middle];
    if (sequence < bar.firstSequence) high = middle - 1;
    else if (sequence > bar.lastSequence) low = middle + 1;
    else return middle;
  }
  return -1;
}

export function replayTradeAnnotationColor(no: number) {
  const index = ((Math.max(1, no) - 1) % REPLAY_TRADE_ANNOTATION_COLORS.length);
  return REPLAY_TRADE_ANNOTATION_COLORS[index];
}

export function replayTradeOrderTypeAbbreviation(type: PaperOrderType | null) {
  if (type === "LIMIT") return "LMT";
  if (type === "STOP") return "STP";
  if (type === "MARKET") return "MKT";
  return "?";
}

export function replayTradeActualRiskPrice(entry: ReplayTradeAnnotationData) {
  return entry.direction === "LONG"
    ? entry.entryPrice - entry.actualRisk
    : entry.entryPrice + entry.actualRisk;
}

export function buildReplayTradePriceAnnotations(entry: ReplayTradeAnnotationData): ReplayTradePriceAnnotation[] {
  const color = replayTradeAnnotationColor(entry.no);
  const side = entry.direction === "LONG" ? "B" : "S";
  const result = entry.result === "W" ? "TP" : entry.result === "L" ? "SL" : "BE";
  const annotations: ReplayTradePriceAnnotation[] = [{
    key: `${entry.id}:entry`,
    no: entry.no,
    sequence: entry.openedSequence,
    price: entry.entryPrice,
    color,
    label: copy.paperTrading.tradeAnnotationEntry(
      entry.no,
      replayTradeOrderTypeAbbreviation(entry.entryOrderType),
      side,
    ),
  }];
  if (entry.initialStopPrice !== null) {
    annotations.push({
      key: `${entry.id}:initial-risk`,
      no: entry.no,
      sequence: entry.openedSequence,
      price: entry.initialStopPrice,
      color,
      label: copy.paperTrading.tradeAnnotationRisk(entry.no, "iRisk"),
    });
  }
  annotations.push(
    {
      key: `${entry.id}:actual-risk`,
      no: entry.no,
      sequence: entry.openedSequence,
      price: replayTradeActualRiskPrice(entry),
      color,
      label: copy.paperTrading.tradeAnnotationRisk(entry.no, "aRisk"),
    },
    {
      key: `${entry.id}:exit`,
      no: entry.no,
      sequence: entry.closedSequence,
      price: entry.exitPrice,
      color,
      label: copy.paperTrading.tradeAnnotationExit(entry.no, result),
    },
  );
  return annotations;
}

function rectanglesOverlap(
  first: { left: number; right: number; top: number; bottom: number },
  second: { left: number; right: number; top: number; bottom: number },
) {
  return first.left < second.right && first.right > second.left
    && first.top < second.bottom && first.bottom > second.top;
}

function laneOffsets(height = LABEL_HEIGHT, gap = LABEL_LANE_GAP) {
  const offsets = [0];
  for (let step = 1; step <= MAX_LABEL_OFFSET_STEPS; step += 1) {
    const offset = step * (height + gap);
    offsets.push(-offset, offset);
  }
  return offsets;
}

class ReplayTradeAnnotationPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly snapshot: () => ProjectedSnapshot, private readonly scale = 1) {}

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]): void {
    target.useMediaCoordinateSpace(({ context }) => {
      const snapshot = this.snapshot();
      if (!snapshot.annotations.length) return;
      const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      context.save();
      const labelHeight = LABEL_HEIGHT * this.scale;
      const gap = LABEL_GAP * this.scale;
      const lineLength = REPLAY_TRADE_ANNOTATION_LINE_LENGTH * this.scale;
      context.font = `600 ${12 * this.scale}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.lineWidth = 1;
      context.setLineDash([3, 3]);

      for (const annotation of snapshot.annotations) {
        const labelWidth = Math.ceil(context.measureText(annotation.label).width);
        const flip = annotation.x + lineLength + gap + labelWidth > snapshot.paneWidth;
        const lineEndX = annotation.x + (flip ? -lineLength : lineLength);
        const labelX = flip ? Math.max(0, lineEndX - gap - labelWidth) : lineEndX + gap;
        const clampedDesiredY = Math.max(labelHeight / 2, Math.min(annotation.y, snapshot.paneHeight - labelHeight / 2));
        let labelY = clampedDesiredY;
        let labelRect = {
          left: labelX,
          right: labelX + labelWidth,
          top: labelY - labelHeight / 2,
          bottom: labelY + labelHeight / 2,
        };
        for (const offset of laneOffsets(labelHeight, LABEL_LANE_GAP * this.scale)) {
          const candidateY = Math.max(
            labelHeight / 2,
            Math.min(clampedDesiredY + offset, snapshot.paneHeight - labelHeight / 2),
          );
          const candidate = {
            left: labelX,
            right: labelX + labelWidth,
            top: candidateY - labelHeight / 2,
            bottom: candidateY + labelHeight / 2,
          };
          if (!placed.some((rectangle) => rectanglesOverlap(rectangle, candidate))) {
            labelY = candidateY;
            labelRect = candidate;
            break;
          }
        }
        placed.push(labelRect);

        context.strokeStyle = annotation.color;
        context.fillStyle = annotation.color;
        context.beginPath();
        context.moveTo(annotation.x, annotation.y);
        context.lineTo(lineEndX, annotation.y);
        if (Math.abs(labelY - annotation.y) > 0.5) context.lineTo(labelX - 1, labelY);
        context.stroke();
        // Print-sized labels use a half-opacity white background.
        if (this.scale > 1) {
          context.fillStyle = "rgba(255,255,255,.5)";
          context.fillRect(labelRect.left - gap / 2, labelRect.top, labelWidth + gap, labelHeight);
          context.fillStyle = annotation.color;
        }
        context.fillText(annotation.label, labelX, labelY);
      }
      context.restore();
    });
  }
}

class ReplayTradeAnnotationPaneView implements IPrimitivePaneView {
  private readonly paneRenderer: ReplayTradeAnnotationPaneRenderer;

  constructor(snapshot: () => ProjectedSnapshot, scale = 1) {
    this.paneRenderer = new ReplayTradeAnnotationPaneRenderer(snapshot, scale);
  }

  zOrder() {
    return "top" as const;
  }

  renderer() {
    return this.paneRenderer;
  }
}

export class ReplayTradeAnnotationPrimitive implements ISeriesPrimitive<Time> {
  private chart: SeriesAttachedParameter<Time>["chart"] | null = null;
  private series: SeriesAttachedParameter<Time>["series"] | null = null;
  private requestUpdate: (() => void) | null = null;
  private snapshot: PrimitiveSnapshot = { entries: [], bars: [] };
  private projected: ProjectedSnapshot = EMPTY_PROJECTED_SNAPSHOT;
  private readonly views: ReplayTradeAnnotationPaneView[];

  constructor(scale = 1) {
    this.views = [new ReplayTradeAnnotationPaneView(() => this.projected, scale)];
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.requestUpdate();
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

  setData(snapshot: PrimitiveSnapshot) {
    this.snapshot = snapshot;
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
    const visibleRange = chart.timeScale().getVisibleLogicalRange();
    const annotations = this.snapshot.entries.flatMap(buildReplayTradePriceAnnotations).flatMap((annotation) => {
      const index = barIndexForSequence(this.snapshot.bars, annotation.sequence);
      if (index < 0 || (visibleRange && (index < visibleRange.from - 1 || index > visibleRange.to + 1))) return [];
      const x = chart.timeScale().logicalToCoordinate(index as never);
      const y = series.priceToCoordinate(annotation.price);
      if (x === null || y === null) return [];
      const numericX = Number(x);
      const numericY = Number(y);
      if (numericX < -REPLAY_TRADE_ANNOTATION_LINE_LENGTH || numericX > paneWidth || numericY < 0 || numericY > paneHeight) return [];
      return [{ ...annotation, x: numericX, y: numericY }];
    });
    this.projected = { annotations, paneWidth, paneHeight };
  }
}
