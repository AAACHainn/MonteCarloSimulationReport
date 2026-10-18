import type { AggregatedMarketBarData } from "./types";

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
