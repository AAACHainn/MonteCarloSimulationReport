export type ReplayLogicalRange = { from: number; to: number };

export const DEFAULT_REPLAY_MAX_VISIBLE_BARS = 300;
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
