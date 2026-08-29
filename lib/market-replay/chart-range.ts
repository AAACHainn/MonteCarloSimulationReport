export type ReplayLogicalRange = { from: number; to: number };

export function rangeAfterNewReplayBar(
  visibleRange: ReplayLogicalRange,
  previousLastLogicalIndex: number,
): ReplayLogicalRange {
  const span = Math.max(1, visibleRange.to - visibleRange.from);
  const rightGap = visibleRange.to - previousLastLogicalIndex;
  const followThreshold = Math.max(4, span * 0.05);
  const wasFollowingLatestBar = rightGap >= -0.5 && rightGap <= followThreshold;

  return wasFollowingLatestBar
    ? { from: visibleRange.from + 1, to: visibleRange.to + 1 }
    : visibleRange;
}
