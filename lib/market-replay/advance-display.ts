import { mergeAggregatedBars } from "./aggregation";
import { MAX_REPLAY_BULK_SOURCE_BARS, MAX_REPLAY_SYNC_SOURCE_BARS, REPLAY_HISTORY_BAR_LIMIT, REPLAY_HISTORY_COMPACT_TO, type AggregatedMarketBarData } from "./types";

/** Only the tail touched by newly confirmed source candles needs an IndexedDB write. */
export function advancedDisplayBars(bars: AggregatedMarketBarData[], confirmedSequence: number, previousLast?: AggregatedMarketBarData) {
  let start = bars.length;
  while (start > 0 && bars[start - 1].lastSequence > confirmedSequence) start--;
  // A new bucket can finalize an incomplete previous bucket without changing its source sequence.
  if (start > 0 && previousLast && bars[start - 1].timestamp === previousLast.timestamp
    && bars[start - 1].status !== previousLast.status) start--;
  return bars.slice(start);
}

export type AnnotationCoverage = {
  fromSequence: number;
  toSequence: number;
  revealedSequence: number;
  journalEntryCount: number;
};

/** An unchanged journal cannot add annotations while ordinary playback moves right. */
export function canReuseAnnotations(coverage: AnnotationCoverage | null, from: number, to: number,
  revealedSequence: number, journalEntryCount: number | undefined) {
  return coverage !== null && journalEntryCount !== undefined
    && from <= to && to <= revealedSequence
    && coverage.journalEntryCount === journalEntryCount
    && revealedSequence >= coverage.revealedSequence
    && from >= coverage.fromSequence
    && (to <= coverage.toSequence || coverage.toSequence === coverage.revealedSequence);
}

/** Manual steps may consume a complete high-period candle in fewer bounded commits. */
export function manualAdvanceBatchSize(sourceSeconds: number, displaySeconds: number) {
  return Math.min(MAX_REPLAY_BULK_SOURCE_BARS, Math.max(MAX_REPLAY_SYNC_SOURCE_BARS, Math.ceil(displaySeconds / sourceSeconds)));
}

/** Replace complete server bucket revisions without fetching or replacing the historical window. */
export function mergeDisplayAdvanceWindow(bars: AggregatedMarketBarData[], warmupBars: AggregatedMarketBarData[],
  updates: AggregatedMarketBarData[], warmupCount: number, finished: boolean) {
  let next = updates.length ? mergeAggregatedBars(bars, updates) : bars;
  const last = next.at(-1);
  if (finished && last?.status === "FORMING") {
    next = next.slice();
    next[next.length - 1] = { ...last, status: last.sourceCount === last.expectedCount ? "COMPLETE" : "INCOMPLETE" };
  }
  if (next.length <= REPLAY_HISTORY_BAR_LIMIT) return { bars: next, warmupBars };
  const dropped = next.slice(0, next.length - REPLAY_HISTORY_COMPACT_TO);
  return { bars: next.slice(-REPLAY_HISTORY_COMPACT_TO),
    warmupBars: warmupCount > 0 ? [...warmupBars, ...dropped].slice(-warmupCount) : [] };
}
