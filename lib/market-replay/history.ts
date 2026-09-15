import {
  REPLAY_HISTORY_BAR_LIMIT,
  REPLAY_HISTORY_PAGE_LIMIT,
  REPLAY_HISTORY_RAW_SOURCE_BUDGET,
  MARKET_BAR_BLOCK_SIZES,
  type AggregatedMarketBarData,
} from "./types";

export type ReplayHistorySlice = {
  bars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
};

function preferredBar(current: AggregatedMarketBarData, candidate: AggregatedMarketBarData) {
  const currentSpan = current.lastSequence - current.firstSequence;
  const candidateSpan = candidate.lastSequence - candidate.firstSequence;
  if (candidateSpan !== currentSpan) return candidateSpan > currentSpan ? candidate : current;
  if (candidate.sourceCount !== current.sourceCount) return candidate.sourceCount > current.sourceCount ? candidate : current;
  return candidate.lastSequence >= current.lastSequence ? candidate : current;
}

/** Merge cached and authoritative windows without duplicating aggregation buckets. */
export function mergeReplayHistory(
  inputs: AggregatedMarketBarData[][],
  warmupCount: number,
  historyLimit = REPLAY_HISTORY_BAR_LIMIT,
): ReplayHistorySlice {
  const byTimestamp = new Map<string, AggregatedMarketBarData>();
  for (const input of inputs) {
    for (const bar of input) {
      const current = byTimestamp.get(bar.timestamp);
      byTimestamp.set(bar.timestamp, current ? preferredBar(current, bar) : bar);
    }
  }
  const ordered = [...byTimestamp.values()].sort((a, b) => (
    a.firstSequence - b.firstSequence || a.timestamp.localeCompare(b.timestamp)
  ));
  const visibleFrom = Math.max(0, ordered.length - Math.max(0, historyLimit));
  const bars = ordered.slice(visibleFrom);
  return {
    bars,
    warmupBars: ordered.slice(Math.max(0, visibleFrom - Math.max(0, warmupCount)), visibleFrom),
  };
}

export function replayHistoryPageSize(sourceSeconds: number, displaySeconds: number) {
  const multiplier = Math.max(1, Math.floor(displaySeconds / sourceSeconds));
  return Math.max(1, Math.min(REPLAY_HISTORY_PAGE_LIMIT, Math.floor(REPLAY_HISTORY_RAW_SOURCE_BUDGET / multiplier)));
}

export function marketBarBlockSizeForMultiplier(multiplier: number) {
  return [...MARKET_BAR_BLOCK_SIZES].reverse().find((size) => size <= multiplier / 4) ?? null;
}

export function nextHistoryEndSequence(bars: AggregatedMarketBarData[]) {
  const first = bars[0];
  return first && first.firstSequence > 0 ? first.firstSequence - 1 : null;
}
