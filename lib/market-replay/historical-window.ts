import { REPLAY_HISTORY_BAR_LIMIT } from "./types";
import type { AggregatedMarketBarData } from "./types";

/** Apply a timeline change only after all of its windows are available. */
export async function commitHistoricalWindowChange(signal: AbortSignal, prepare: (signal: AbortSignal) => Promise<() => void>) {
  const apply = await prepare(signal);
  if (signal.aborted) return false;
  apply();
  return true;
}

/** Find the next displayed page across filtered sessions without skipping an intervening page. */
export async function readLaterHistoryWindow<T extends { visibleBars: AggregatedMarketBarData[] }>({
  afterSequence, endSequence, sourceSeconds, displaySeconds, visibleCount, readWindow,
  shouldContinue = () => true, acceptBar = () => true,
}: {
  afterSequence: number;
  endSequence: number;
  sourceSeconds: number;
  displaySeconds: number;
  visibleCount: number;
  readWindow: (focusSequence: number) => Promise<T>;
  shouldContinue?: () => boolean;
  acceptBar?: (bar: AggregatedMarketBarData) => boolean;
}): Promise<T | null> {
  if (afterSequence >= endSequence) return null;
  let lower = afterSequence;
  let upper: number | null = null;
  let laterWindow: T | null = null;
  let focus = afterSequence + 1;
  let distance = Math.max(1, Math.ceil(visibleCount * displaySeconds / sourceSeconds));
  while (shouldContinue()) {
    const data = await readWindow(focus);
    if (!shouldContinue()) return null;
    const hasLaterBars = data.visibleBars.some((bar) => bar.lastSequence > afterSequence && acceptBar(bar));
    if (hasLaterBars && data.visibleBars[0].firstSequence <= afterSequence) return data;
    if (hasLaterBars) {
      // An exponential probe may land beyond an entire visible page. Search back
      // until the new page overlaps the loaded edge instead of joining a false gap.
      upper = focus;
      laterWindow = data;
    } else {
      lower = focus;
      if (focus === endSequence) return null;
    }
    if (upper !== null) {
      if (upper - lower <= 1) return laterWindow;
      focus = lower + Math.floor((upper - lower) / 2);
    } else {
      focus = Math.min(endSequence, Math.max(lower + 1, afterSequence + distance));
      distance *= 2;
    }
  }
  return null;
}

/** Keep complete overlapping buckets when extending a historical chart. */
export function mergeHistoricalBars(current: AggregatedMarketBarData[], incoming: AggregatedMarketBarData[]) {
  const merged = new Map(current.map((bar) => [bar.timestamp, bar]));
  for (const bar of incoming) {
    const existing = merged.get(bar.timestamp);
    if (!existing || bar.sourceCount >= existing.sourceCount) merged.set(bar.timestamp, bar);
  }
  return [...merged.values()].sort((a, b) => a.firstSequence - b.firstSequence);
}

/** Preserve the source sequence at the center of the inspected history. */
export function historicalWindowFocusSequence(
  range: { fromSequence: number; toSequence: number } | null,
  fallback: number,
  startSequence: number,
  endSequence: number,
) {
  const center = range === null ? fallback : Math.floor(range.fromSequence + (range.toSequence - range.fromSequence) / 2);
  return Math.max(startSequence, Math.min(endSequence, center));
}

/** Keep long read-only playback bounded, with indicator context for the retained prefix. */
export function boundedHistoricalPlaybackWindow(current: AggregatedMarketBarData[], incoming: AggregatedMarketBarData[], warmupCount: number, previousWarmup: AggregatedMarketBarData[] = []) {
  const merged = mergeHistoricalBars(current, incoming);
  const from = Math.max(0, merged.length - REPLAY_HISTORY_BAR_LIMIT);
  const preceding = from > 0 ? mergeHistoricalBars(previousWarmup, merged.slice(0, from))
    .filter(bar => bar.lastSequence < merged[from].firstSequence) : [];
  return { visibleBars: merged.slice(from),
    warmupBars: from > 0 ? warmupCount > 0 ? preceding.slice(-warmupCount) : [] : null };
}
