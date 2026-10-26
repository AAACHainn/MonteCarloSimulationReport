export type ReplayLogicalRange = { from: number; to: number };

import { REPLAY_INITIAL_VISIBLE_BARS } from "./types";
import type { AggregatedMarketBarData } from "./types";
import {
  logicalIndexForTimelineAnchor,
  type ChartTimelineAnchor,
} from "./chart-drawings";

/** Maximum number of candles in the default viewport, not the loaded history limit. */
export const DEFAULT_REPLAY_MAX_VISIBLE_BARS = REPLAY_INITIAL_VISIBLE_BARS;
const DEFAULT_REPLAY_LATEST_BAR_POSITION = 0.618;

/** Move to an existing candle without replacing data or changing the user's zoom. */
export function rangeForReplayFocus(
  bars: AggregatedMarketBarData[],
  sourceSequence: number,
  visibleRange: ReplayLogicalRange | null,
): ReplayLogicalRange | null {
  if (!bars.length) return null;
  const followingIndex = bars.findIndex((bar) => bar.lastSequence >= sourceSequence);
  const index = followingIndex < 0 ? bars.length - 1 : followingIndex;
  const span = visibleRange && visibleRange.to > visibleRange.from
    ? visibleRange.to - visibleRange.from : 60;
  return { from: index - span / 2, to: index + span / 2 };
}

export function defaultReplayLogicalRange(chartWidth: number, barCount: number): ReplayLogicalRange {
  // Five CSS pixels per candle; smaller screens show fewer bars, wide screens at most 300.
  const visibleBars = Math.min(DEFAULT_REPLAY_MAX_VISIBLE_BARS, Math.max(80, Math.round(chartWidth / 5)));
  const lastIndex = Math.max(0, barCount - 1);
  // Preserve the existing zoom while placing the latest bar at 61.8% of the plot.
  const span = visibleBars + 3;
  const from = lastIndex - span * DEFAULT_REPLAY_LATEST_BAR_POSITION;
  return { from, to: from + span };
}

/** Shared by playback and display-period changes; visibility alone does not imply following. */
export function isReplayRangeFollowing(visibleRange: ReplayLogicalRange, latestIndex: number) {
  if (latestIndex < 0) return false;
  const span = Math.max(1, visibleRange.to - visibleRange.from);
  const rightGap = visibleRange.to - latestIndex;
  const atRightEdge = rightGap >= -0.5 && rightGap <= Math.max(4, span * 0.05);
  const atDefaultAnchor = Math.abs(latestIndex - (visibleRange.from + span * DEFAULT_REPLAY_LATEST_BAR_POSITION)) <= 0.5;
  return atRightEdge || atDefaultAnchor;
}

export function rangeAfterNewReplayBar(
  visibleRange: ReplayLogicalRange,
  previousLastLogicalIndex: number,
  addedBarCount = 1,
  following = isReplayRangeFollowing(visibleRange, previousLastLogicalIndex),
): ReplayLogicalRange {
  return following
    ? { from: visibleRange.from + addedBarCount, to: visibleRange.to + addedBarCount }
    : visibleRange;
}

export type ReplayViewportMode = "following" | "history";
export type ReplayViewportSnapshot = {
  mode: ReplayViewportMode;
  anchor: ChartTimelineAnchor;
  position: number;
  logicalSpan: number;
  barSpacing: number;
};
export type ReplayViewportApi = {
  capture: (sourceSequence: number, liveWindow: boolean) => ReplayViewportSnapshot | null;
  followLatest: () => void;
};

/** A filtered-session tail is live only when its owner confirms it is not a historical window. */
export function latestReplayLogicalIndex(bars: AggregatedMarketBarData[], sourceSequence: number, liveWindow: boolean) {
  const index = bars.findIndex(bar => sourceSequence >= bar.firstSequence && sourceSequence <= bar.lastSequence);
  if (index >= 0) return index;
  return liveWindow && bars.length > 0 && sourceSequence >= bars.at(-1)!.lastSequence ? bars.length - 1 : -1;
}

export function captureReplayViewport({ visibleRange, bars, sourceSequence, liveWindow, mode = null, chartWidth = 0, barSpacing = 0 }: {
  visibleRange: ReplayLogicalRange | null; bars: AggregatedMarketBarData[];
  sourceSequence: number; liveWindow: boolean; mode?: ReplayViewportMode | null;
  chartWidth?: number; barSpacing?: number;
}): ReplayViewportSnapshot | null {
  if (!visibleRange || !bars.length || !Number.isFinite(visibleRange.from) || !Number.isFinite(visibleRange.to)) return null;
  const span = visibleRange.to - visibleRange.from;
  if (span <= 0) return null;
  const latest = latestReplayLogicalIndex(bars, sourceSequence, liveWindow);
  const following = latest >= 0 && latest >= visibleRange.from - 0.5 && latest <= visibleRange.to + 0.5
    && (mode === "following" || (mode === null && isReplayRangeFollowing(visibleRange, latest)));
  const index = following ? latest : Math.max(0, Math.min(bars.length - 1, Math.round((visibleRange.from + visibleRange.to) / 2)));
  return {
    mode: following ? "following" : "history",
    anchor: { timestamp: bars[index].timestamp, sourceSequence: following ? sourceSequence : bars[index].firstSequence },
    // Logical ranges run between candle centres; include both half-candle edges.
    position: Math.max(0, Math.min(1, (index - visibleRange.from + 0.5) / (span + 1))),
    logicalSpan: span,
    barSpacing: barSpacing > 0 ? barSpacing : chartWidth > 0 ? chartWidth / (span + 1) : 0,
  };
}

export function rangeForReplayViewport(snapshot: ReplayViewportSnapshot, bars: AggregatedMarketBarData[], displaySeconds: number, chartWidth = 0): ReplayLogicalRange | null {
  if (!bars.length) return null;
  const containing = snapshot.anchor.sourceSequence === null ? -1 : bars.findIndex(bar =>
    snapshot.anchor.sourceSequence! >= bar.firstSequence && snapshot.anchor.sourceSequence! <= bar.lastSequence);
  const mapped = containing >= 0 ? containing : logicalIndexForTimelineAnchor(snapshot.anchor, bars, displaySeconds);
  if (mapped === null || !Number.isFinite(mapped)) return null;
  // In a filtered gap, choose the preceding real candle instead of inventing a bar.
  const index = Math.max(0, Math.min(bars.length - 1, Math.floor(mapped)));
  const span = chartWidth > 0 && snapshot.barSpacing > 0 ? Math.max(1, chartWidth / snapshot.barSpacing - 1) : snapshot.logicalSpan;
  const from = index + 0.5 - (span + 1) * snapshot.position;
  return { from, to: from + span };
}

export function rangeAfterWindowReplacement(
  visibleRange: ReplayLogicalRange,
  previousLastLogicalIndex: number,
  nextLastLogicalIndex: number,
): ReplayLogicalRange {
  const shift = nextLastLogicalIndex - previousLastLogicalIndex;
  return {
    from: visibleRange.from + shift,
    to: visibleRange.to + shift,
  };
}

/** Preserve candle density and the inspected source candle, not the old elapsed duration. */
export function rangeAfterTimelineChange({ visibleRange, previousBars, nextBars, nextDisplayIntervalSeconds }: {
  visibleRange: ReplayLogicalRange;
  previousBars: AggregatedMarketBarData[];
  nextBars: AggregatedMarketBarData[];
  previousDisplayIntervalSeconds: number;
  nextDisplayIntervalSeconds: number;
}): ReplayLogicalRange | null {
  const snapshot = captureReplayViewport({ visibleRange, bars: previousBars,
    sourceSequence: previousBars.at(-1)?.lastSequence ?? -1, liveWindow: true });
  return snapshot ? rangeForReplayViewport(snapshot, nextBars, nextDisplayIntervalSeconds) : null;
}
