import {
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesPrimitive,
  type SeriesAttachedParameter,
  type Time,
} from "lightweight-charts";
import { buildBarCountLabels, type BarCountLabel } from "./bar-count";
import type {
  AggregatedMarketBarData,
  BarCountIndicatorConfig,
  DisplaySession,
  TradingSessionConfig,
} from "./types";

const LABEL_OFFSET = 12;
const LABEL_HEIGHT = 12;

type PrimitiveSnapshot = {
  bars: AggregatedMarketBarData[];
  displaySession: DisplaySession;
  displayIntervalSeconds: number;
  session: TradingSessionConfig;
  config: BarCountIndicatorConfig;
};

type ProjectedLabel = {
  x: number;
  y: number;
  text: string;
  color: string;
};

class BarCountPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly labels: () => ProjectedLabel[]) {}

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]) {
    target.useMediaCoordinateSpace(({ context }) => {
      const labels = this.labels();
      if (!labels.length) return;
      context.save();
      context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (const label of labels) {
        context.fillStyle = label.color;
        context.fillText(label.text, label.x, label.y);
      }
      context.restore();
    });
  }
}

class BarCountPaneView implements IPrimitivePaneView {
  private readonly paneRenderer: BarCountPaneRenderer;

  constructor(labels: () => ProjectedLabel[]) {
    this.paneRenderer = new BarCountPaneRenderer(labels);
  }

  zOrder() { return "top" as const; }
  renderer() { return this.paneRenderer; }
}

export class BarCountPrimitive implements ISeriesPrimitive<Time> {
  private chart: SeriesAttachedParameter<Time>["chart"] | null = null;
  private series: SeriesAttachedParameter<Time>["series"] | null = null;
  private requestUpdate: (() => void) | null = null;
  private snapshot: PrimitiveSnapshot | null = null;
  private labels: BarCountLabel[] = [];
  private projected: ProjectedLabel[] = [];
  private readonly views = [new BarCountPaneView(() => this.projected)];

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
    this.labels = [];
    this.projected = [];
  }

  paneViews() { return this.views; }

  setData(snapshot: PrimitiveSnapshot) {
    this.snapshot = snapshot;
    this.labels = buildBarCountLabels(snapshot);
    this.requestUpdate?.();
  }

  updateAllViews() {
    const chart = this.chart;
    const series = this.series;
    const snapshot = this.snapshot;
    if (!chart || !series || !snapshot) {
      this.projected = [];
      return;
    }

    const visibleRange = chart.timeScale().getVisibleLogicalRange();
    const paneWidth = chart.timeScale().width();
    const paneHeight = chart.panes()[0]?.getHeight() ?? 0;
    this.projected = this.labels.flatMap((label) => {
      if (visibleRange && (label.index < visibleRange.from - 1 || label.index > visibleRange.to + 1)) return [];
      const bar = snapshot.bars[label.index];
      const x = chart.timeScale().logicalToCoordinate(label.index as never);
      const lowY = series.priceToCoordinate(bar.low);
      if (x === null || lowY === null) return [];
      const numericX = Number(x);
      if (numericX < 0 || numericX > paneWidth) return [];
      return [{
        x: numericX,
        y: Math.max(LABEL_HEIGHT / 2, Math.min(Number(lowY) + LABEL_OFFSET, paneHeight - LABEL_HEIGHT / 2)),
        text: String(label.number),
        color: label.color,
      }];
    });
  }
}
