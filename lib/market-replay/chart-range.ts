export type ReplayLogicalRange = { from: number; to: number };

import { REPLAY_INITIAL_VISIBLE_BARS } from "./types";
import type { AggregatedMarketBarData } from "./types";
import {
  logicalIndexForTimelineAnchor,
  timelineAnchorForLogicalIndex,
} from "./chart-drawings";

/** Maximum number of candles in the default viewport, not the loaded history limit. */
export const DEFAULT_REPLAY_MAX_VISIBLE_BARS = REPLAY_INITIAL_VISIBLE_BARS;
const DEFAULT_REPLAY_LATEST_BAR_POSITION = 0.618;

export function defaultReplayLogicalRange(chartWidth: number, barCount: number): ReplayLogicalRange {
  // Five CSS pixels per candle; smaller screens show fewer bars, wide screens at most 300.
  const visibleBars = Math.min(DEFAULT_REPLAY_MAX_VISIBLE_BARS, Math.max(80, Math.round(chartWidth / 5)));
  const lastIndex = Math.max(0, barCount - 1);
  // Preserve the existing zoom while placing the latest bar at 61.8% of the plot.
  const span = visibleBars + 3;
  const from = lastIndex - span * DEFAULT_REPLAY_LATEST_BAR_POSITION;
  return { from, to: from + span };
}

export function rangeAfterNewReplayBar(
  visibleRange: ReplayLogicalRange,
  previousLastLogicalIndex: number,
  addedBarCount = 1,
): ReplayLogicalRange {
  const span = Math.max(1, visibleRange.to - visibleRange.from);
  const rightGap = visibleRange.to - previousLastLogicalIndex;
  const followThreshold = Math.max(4, span * 0.05);
  const wasFollowingRightEdge = rightGap >= -0.5 && rightGap <= followThreshold;
  const defaultAnchor = visibleRange.from + span * DEFAULT_REPLAY_LATEST_BAR_POSITION;
  // Allow sub-bar rounding, but keep manually panned historical views fixed.
  const wasFollowingDefaultAnchor = Math.abs(previousLastLogicalIndex - defaultAnchor) <= 0.5;
  const wasFollowingLatestBar = wasFollowingRightEdge || wasFollowingDefaultAnchor;

  return wasFollowingLatestBar
    ? { from: visibleRange.from + addedBarCount, to: visibleRange.to + addedBarCount }
    : visibleRange;
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

export function rangeAfterTimelineChange({
  visibleRange,
  previousBars,
  nextBars,
  previousDisplayIntervalSeconds,
  nextDisplayIntervalSeconds,
}: {
  visibleRange: ReplayLogicalRange;
  previousBars: AggregatedMarketBarData[];
  nextBars: AggregatedMarketBarData[];
  previousDisplayIntervalSeconds: number;
  nextDisplayIntervalSeconds: number;
}): ReplayLogicalRange | null {
  const fromAnchor = timelineAnchorForLogicalIndex(
    visibleRange.from,
    previousBars,
    previousDisplayIntervalSeconds,
  );
  const toAnchor = timelineAnchorForLogicalIndex(
    visibleRange.to,
    previousBars,
    previousDisplayIntervalSeconds,
  );
  if (!fromAnchor || !toAnchor) return null;
  const from = logicalIndexForTimelineAnchor(fromAnchor, nextBars, nextDisplayIntervalSeconds);
  const to = logicalIndexForTimelineAnchor(toAnchor, nextBars, nextDisplayIntervalSeconds);
  if (from === null || to === null || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { from, to };
}
