import {
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesPrimitive,
  type SeriesAttachedParameter,
  type Time,
} from "lightweight-charts";
import type { AggregatedMarketBarData } from "./types";

const LABEL_GAP = 14;
const LABEL_HEIGHT = 22;
const LABEL_HORIZONTAL_PADDING = 7;

type PrimitiveSnapshot = {
  bars: AggregatedMarketBarData[];
  currentSourceTimestamp: string | null;
  enabled: boolean;
  playing: boolean;
  sourceIntervalSeconds: number;
};

type ProjectedCountdown = {
  anchorX: number;
  left: number;
  top: number;
  width: number;
  text: string;
};

export function candleCountdownRemainingSeconds(
  bar: AggregatedMarketBarData,
  currentSourceTimestamp: string | null,
  sourceIntervalSeconds: number,
) {
  if (!Number.isFinite(sourceIntervalSeconds) || sourceIntervalSeconds <= 0) return 0;
  if (bar.status === "COMPLETE") return 0;

  const bucketStart = Date.parse(bar.timestamp);
  const bucketEnd = Date.parse(bar.bucketEnd);
  const currentSourceStart = currentSourceTimestamp === null ? Number.NaN : Date.parse(currentSourceTimestamp);
  if (Number.isFinite(bucketStart) && Number.isFinite(bucketEnd)
    && Number.isFinite(currentSourceStart) && currentSourceStart >= bucketStart && currentSourceStart < bucketEnd) {
    return Math.max(0, Math.ceil((bucketEnd - currentSourceStart) / 1_000) - sourceIntervalSeconds);
  }

  return Math.max(0, bar.expectedCount - bar.sourceCount) * sourceIntervalSeconds;
}

export function formatCandleCountdown(totalSeconds: number) {
  const remaining = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(remaining / 3_600);
  const minutes = Math.floor((remaining % 3_600) / 60);
  const seconds = remaining % 60;
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

class CandleCountdownPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly countdown: () => ProjectedCountdown | null) {}

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]) {
    target.useMediaCoordinateSpace(({ context }) => {
      const countdown = this.countdown();
      if (!countdown) return;
      const right = countdown.left + countdown.width;
      const centerY = countdown.top + LABEL_HEIGHT / 2;
      const labelIsRight = countdown.left > countdown.anchorX;

      context.save();
      context.font = "600 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.strokeStyle = "#93c5fd";
      context.fillStyle = "rgba(255,255,255,0.94)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(countdown.anchorX, centerY);
      context.lineTo(labelIsRight ? countdown.left : right, centerY);
      context.stroke();
      context.beginPath();
      context.roundRect(countdown.left, countdown.top, countdown.width, LABEL_HEIGHT, 4);
      context.fill();
      context.fillStyle = "#1d4ed8";
      context.fillText(countdown.text, countdown.left + countdown.width / 2, centerY + 0.5);
      context.restore();
    });
  }
}

class CandleCountdownPaneView implements IPrimitivePaneView {
  private readonly paneRenderer: CandleCountdownPaneRenderer;

  constructor(countdown: () => ProjectedCountdown | null) {
    this.paneRenderer = new CandleCountdownPaneRenderer(countdown);
  }

  zOrder() { return "top" as const; }
  renderer() { return this.paneRenderer; }
}

export class CandleCountdownPrimitive implements ISeriesPrimitive<Time> {
  private chart: SeriesAttachedParameter<Time>["chart"] | null = null;
  private series: SeriesAttachedParameter<Time>["series"] | null = null;
  private requestUpdate: (() => void) | null = null;
  private snapshot: PrimitiveSnapshot = {
    bars: [], currentSourceTimestamp: null, enabled: false, playing: false, sourceIntervalSeconds: 1,
  };
  private projected: ProjectedCountdown | null = null;
  private readonly views = [new CandleCountdownPaneView(() => this.projected)];

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
    this.projected = null;
  }

  paneViews() { return this.views; }

  setData(snapshot: PrimitiveSnapshot) {
    this.snapshot = snapshot;
    this.requestUpdate?.();
  }

  updateAllViews() {
    const chart = this.chart;
    const series = this.series;
    const { bars, currentSourceTimestamp, enabled, playing, sourceIntervalSeconds } = this.snapshot;
    const latest = bars.at(-1);
    if (!chart || !series || !enabled || !playing || !latest) {
      this.projected = null;
      return;
    }

    const paneWidth = chart.timeScale().width();
    const paneHeight = chart.panes()[0]?.getHeight() ?? 0;
    const x = chart.timeScale().logicalToCoordinate((bars.length - 1) as never);
    const y = series.priceToCoordinate(latest.close);
    if (x === null || y === null || paneWidth <= 0 || paneHeight <= 0) {
      this.projected = null;
      return;
    }
    const anchorX = Number(x);
    const anchorY = Number(y);
    if (anchorX < 0 || anchorX > paneWidth || anchorY < 0 || anchorY > paneHeight) {
      this.projected = null;
      return;
    }

    const text = formatCandleCountdown(candleCountdownRemainingSeconds(
      latest, currentSourceTimestamp, sourceIntervalSeconds,
    ));
    const labelWidth = Math.max(48, text.length * 6.7 + LABEL_HORIZONTAL_PADDING * 2);
    const preferredLeft = anchorX + LABEL_GAP;
    const left = preferredLeft + labelWidth <= paneWidth - 4
      ? preferredLeft
      : Math.max(4, anchorX - LABEL_GAP - labelWidth);
    this.projected = {
      anchorX,
      left,
      top: Math.max(4, Math.min(anchorY - LABEL_HEIGHT / 2, paneHeight - LABEL_HEIGHT - 4)),
      width: labelWidth,
      text,
    };
  }
}
