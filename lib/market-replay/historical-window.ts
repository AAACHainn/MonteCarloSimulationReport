import type { AggregatedMarketBarData } from "./types";

/** Keep complete overlapping buckets when extending a historical chart. */
export function mergeHistoricalBars(current: AggregatedMarketBarData[], incoming: AggregatedMarketBarData[]) {
  const merged = new Map(current.map((bar) => [bar.timestamp, bar]));
  for (const bar of incoming) {
    const existing = merged.get(bar.timestamp);
    if (!existing || bar.sourceCount >= existing.sourceCount) merged.set(bar.timestamp, bar);
  }
  return [...merged.values()].sort((a, b) => a.firstSequence - b.firstSequence);
}
