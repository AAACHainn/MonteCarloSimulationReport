import type { AggregatedMarketBarData, DisplaySession } from "./types";
import { chartCandleData, chartVolumeData } from "./chart-data";

export type ChartHideAfter = {
  bar: AggregatedMarketBarData;
  displayIntervalSeconds: number;
  displaySession: DisplaySession;
};

/** Only real candles can be selected; never snap blank chart space to an endpoint. */
export function chartHideAfterTarget(
  bars: AggregatedMarketBarData[], logical: number | null,
  displayIntervalSeconds: number, displaySession: DisplaySession,
): ChartHideAfter | null {
  if (logical === null || !Number.isFinite(logical) || logical < -0.5 || logical >= bars.length - 0.5) return null;
  const bar = bars[Math.round(logical)];
  if (!bar) return null;
  return { bar: { ...bar }, displayIntervalSeconds, displaySession };
}

/** A view-only prefix, including a frozen snapshot of a forming boundary candle. */
export function chartBarsBeforeHiddenBoundary(
  bars: AggregatedMarketBarData[], hiddenAfter: ChartHideAfter | null,
  displayIntervalSeconds: number, displaySession: DisplaySession,
): AggregatedMarketBarData[] {
  if (!hiddenAfter) return bars;
  const sameTimeline = displayIntervalSeconds === hiddenAfter.displayIntervalSeconds
    && displaySession === hiddenAfter.displaySession;
  return bars.flatMap((bar) => {
    if (sameTimeline && bar.timestamp === hiddenAfter.bar.timestamp && bar.firstSequence === hiddenAfter.bar.firstSequence) {
      return [hiddenAfter.bar];
    }
    // After a timeframe/session change, omit any bucket that crosses the boundary:
    // its OHLC/volume could otherwise expose hidden source data.
    return bar.lastSequence <= hiddenAfter.bar.lastSequence ? [bar] : [];
  });
}

/** Preserve timeline slots while stripping every hidden price and volume value. */
export function chartHiddenSeriesData(bars: AggregatedMarketBarData[], visibleBars: AggregatedMarketBarData[]) {
  const visibleByTimestamp = new Map(visibleBars.map((bar) => [bar.timestamp, bar]));
  return {
    candles: bars.map((bar) => {
      const shown = visibleByTimestamp.get(bar.timestamp);
      return shown ? chartCandleData(shown) : { time: chartCandleData(bar).time };
    }),
    volumes: bars.map((bar) => {
      const shown = visibleByTimestamp.get(bar.timestamp);
      return shown?.volume != null ? chartVolumeData(shown) : { time: chartCandleData(bar).time };
    }),
  };
}
