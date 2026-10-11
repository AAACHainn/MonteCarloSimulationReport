import {
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesPrimitive,
  type SeriesAttachedParameter,
  type Time,
} from "lightweight-charts";
import {
  barCountWindowStartIndex,
  buildBarCountLabels,
  buildBarCountLabelWindow,
  type BarCountLabel,
} from "./bar-count";
import { tradingDayForTimestamp } from "./chunks";
import type {
  AggregatedMarketBarData,
  BarCountIndicatorConfig,
  DisplaySession,
  TradingSessionConfig,
} from "./types";

const LABEL_OFFSET = 12;
const LABEL_HEIGHT = 12;
const MIN_LABEL_SPACING = 11;

type PrimitiveSnapshot = {
  bars: AggregatedMarketBarData[];
  displaySession: DisplaySession;
  displayIntervalSeconds: number;
  session: TradingSessionConfig;
  config: BarCountIndicatorConfig;
};

type ProjectedLabel = {
  kind: BarCountLabel["kind"];
  x: number;
  y: number;
  text: string;
  color: string;
};

type LabelCacheState = {
  signature: string;
  firstTimestamp: string;
  lastTimestamp: string;
  lastTradingDay: string;
  barCount: number;
  windowStartIndex: number;
};

function firstLabelAtOrAfter(labels: BarCountLabel[], index: number) {
  let low = 0;
  let high = labels.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (labels[middle].index < index) low = middle + 1;
    else high = middle;
  }
  return low;
}

class BarCountPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly labels: () => ProjectedLabel[], private readonly scale: number) {}

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]) {
    target.useMediaCoordinateSpace(({ context }) => {
      const labels = this.labels();
      if (!labels.length) return;
      context.save();
      context.font = `600 ${10 * this.scale}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (const label of labels) {
        if (this.scale > 1) {
          const width = context.measureText(label.text).width + 4 * this.scale;
          const height = LABEL_HEIGHT * this.scale;
          context.fillStyle = "rgba(255, 255, 255, 0.96)";
          context.fillRect(label.x - width / 2, label.y - height / 2, width, height);
        }
        context.fillStyle = label.color;
        context.fillText(label.text, label.x, label.y);
      }
      context.restore();
    });
  }
}

class BarCountPaneView implements IPrimitivePaneView {
  private readonly paneRenderer: BarCountPaneRenderer;

  constructor(labels: () => ProjectedLabel[], scale: number) {
    this.paneRenderer = new BarCountPaneRenderer(labels, scale);
  }

  zOrder() { return "top" as const; }
  renderer() { return this.paneRenderer; }
}

export class BarCountPrimitive implements ISeriesPrimitive<Time> {
  private chart: SeriesAttachedParameter<Time>["chart"] | null = null;
  private series: SeriesAttachedParameter<Time>["series"] | null = null;
  private requestUpdate: (() => void) | null = null;
  private snapshot: PrimitiveSnapshot | null = null;
  private projected: ProjectedLabel[] = [];
  private labels: BarCountLabel[] = [];
  private windowStartIndex = 0;
  private labelCacheState: LabelCacheState | null = null;
  private readonly views: BarCountPaneView[];

  constructor(private readonly scale = 1) {
    this.views = [new BarCountPaneView(() => this.projected, scale)];
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
    this.projected = [];
    this.labels = [];
    this.labelCacheState = null;
  }

  paneViews() { return this.views; }

  setData(snapshot: PrimitiveSnapshot) {
    this.snapshot = snapshot;
    const firstTimestamp = snapshot.bars[0]?.timestamp ?? "";
    const lastTimestamp = snapshot.bars.at(-1)?.timestamp ?? "";
    const lastTimestampMs = Date.parse(lastTimestamp);
    const lastTradingDay = Number.isFinite(lastTimestampMs)
      ? tradingDayForTimestamp(lastTimestampMs, snapshot.session)
      : "";
    const signature = [
      snapshot.displaySession,
      snapshot.displayIntervalSeconds,
      snapshot.config.enabled,
      snapshot.config.interval,
      snapshot.config.recentTradingDays,
      snapshot.config.regularColor,
      snapshot.config.bar18Color,
      snapshot.config.hourCloseColor,
      snapshot.session.mode,
      snapshot.session.timezone,
      snapshot.session.openMinute,
      snapshot.session.closeMinute,
      snapshot.session.weekdays.join(","),
    ].join("|");
    const previous = this.labelCacheState;
    const hasSameTail = previous
      && previous.signature === signature
      && previous.firstTimestamp === firstTimestamp
      && previous.lastTradingDay === lastTradingDay
      && snapshot.bars.length >= previous.barCount
      && previous.barCount > 0
      && snapshot.bars[previous.barCount - 1]?.timestamp === previous.lastTimestamp;
    if (hasSameTail && snapshot.bars.length > previous.barCount) {
      // Numbering restarts at each session, so rebuild the current session rather
      // than only the appended suffix. Older cached sessions remain untouched.
      const rebuildFrom = Math.max(
        previous.windowStartIndex,
        barCountWindowStartIndex(snapshot.bars, snapshot.session, 1),
      );
      const tailLabels = buildBarCountLabels({ ...snapshot, bars: snapshot.bars.slice(rebuildFrom) })
        .map((label) => ({ ...label, index: label.index + rebuildFrom }));
      this.labels = [...this.labels.filter((label) => label.index < rebuildFrom), ...tailLabels];
      this.windowStartIndex = previous.windowStartIndex;
    } else if (!hasSameTail || snapshot.bars.length !== previous.barCount || lastTimestamp !== previous.lastTimestamp) {
      const window = buildBarCountLabelWindow(snapshot);
      this.windowStartIndex = window.startIndex;
      this.labels = window.labels;
    }
    this.labelCacheState = {
      signature,
      firstTimestamp,
      lastTimestamp,
      lastTradingDay,
      barCount: snapshot.bars.length,
      windowStartIndex: this.windowStartIndex,
    };
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
    const fromIndex = Math.max(
      this.windowStartIndex,
      visibleRange ? Math.max(0, Math.floor(visibleRange.from) - 1) : 0,
    );
    const toIndex = visibleRange ? Math.min(snapshot.bars.length - 1, Math.ceil(visibleRange.to) + 1) : snapshot.bars.length - 1;
    if (fromIndex > toIndex) {
      this.projected = [];
      return;
    }
    const fromLabel = firstLabelAtOrAfter(this.labels, fromIndex);
    const toLabel = firstLabelAtOrAfter(this.labels, toIndex + 1);
    const projected: ProjectedLabel[] = [];
    let lastX = -Infinity;
    for (let labelIndex = fromLabel; labelIndex < toLabel; labelIndex += 1) {
      const label = this.labels[labelIndex];
      const bar = snapshot.bars[label.index];
      const x = chart.timeScale().logicalToCoordinate(label.index as never);
      const lowY = series.priceToCoordinate(bar.low);
      if (x === null || lowY === null) continue;
      const numericX = Number(x);
      if (numericX < 0 || numericX > paneWidth) continue;
      const text = String(label.number);
      const spacing = () => this.scale > 1 && projected.length
        ? (projected.at(-1)!.text.length + text.length) * 10 * this.scale * 0.31 + 4 * this.scale
        : MIN_LABEL_SPACING * this.scale;
      if (label.kind === "REGULAR" && numericX - lastX < spacing()) continue;
      // Keep special labels legible at PDF size by dropping a crowded ordinary predecessor.
      if (this.scale > 1 && label.kind !== "REGULAR") {
        while (projected.at(-1)?.kind === "REGULAR" && numericX - lastX < spacing()) {
          projected.pop();
          lastX = projected.at(-1)?.x ?? -Infinity;
        }
      }
      const halfWidth = text.length * 10 * this.scale * 0.31 + 2 * this.scale;
      projected.push({
        kind: label.kind,
        x: this.scale > 1 ? Math.max(halfWidth, Math.min(numericX, paneWidth - halfWidth)) : numericX,
        y: Math.max(LABEL_HEIGHT * this.scale / 2, Math.min(Number(lowY) + LABEL_OFFSET * this.scale, paneHeight - LABEL_HEIGHT * this.scale / 2)),
        text,
        color: label.color,
      });
      lastX = this.scale > 1 ? projected.at(-1)!.x : numericX;
    }
    this.projected = projected;
  }
}
