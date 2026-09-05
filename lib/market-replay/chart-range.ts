export type ReplayLogicalRange = { from: number; to: number };

export const DEFAULT_REPLAY_MAX_VISIBLE_BARS = 300;

export function defaultReplayLogicalRange(chartWidth: number, barCount: number): ReplayLogicalRange {
  // Five CSS pixels per candle; smaller screens show fewer bars, wide screens at most 300.
  const visibleBars = Math.min(DEFAULT_REPLAY_MAX_VISIBLE_BARS, Math.max(80, Math.round(chartWidth / 5)));
  const lastIndex = Math.max(0, barCount - 1);
  return { from: lastIndex - visibleBars + 1, to: lastIndex + 4 };
}

export function rangeAfterNewReplayBar(
  visibleRange: ReplayLogicalRange,
  previousLastLogicalIndex: number,
  addedBarCount = 1,
): ReplayLogicalRange {
  const span = Math.max(1, visibleRange.to - visibleRange.from);
  const rightGap = visibleRange.to - previousLastLogicalIndex;
  const followThreshold = Math.max(4, span * 0.05);
  const wasFollowingLatestBar = rightGap >= -0.5 && rightGap <= followThreshold;

  return wasFollowingLatestBar
    ? { from: visibleRange.from + addedBarCount, to: visibleRange.to + addedBarCount }
    : visibleRange;
}
