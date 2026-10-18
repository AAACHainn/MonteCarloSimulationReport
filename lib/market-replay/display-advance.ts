import { getAggregationBucket } from "./aggregation";
import { MAX_DISPLAY_ADVANCE_SOURCE_BARS, type TradingSessionConfig } from "./types";

type Candidate = { sequence: number; timestamp: Date };
export const DISPLAY_ADVANCE_PAGE_SIZE = 4096;

/** Plan only as far as the requested visible buckets; never load an entire future day eagerly. */
export async function planDisplayAdvance(options: {
  currentSequence: number; barCount: number; sourceSeconds: number; displaySeconds: number;
  session: TradingSessionConfig; count: number;
}, read: (afterSequence: number, take: number) => Promise<Candidate[]>) {
  const { currentSequence, barCount, sourceSeconds, displaySeconds, session, count } = options;
  const cap = Math.min(barCount - 1, currentSequence + MAX_DISPLAY_ADVANCE_SOURCE_BARS);
  const through = Math.min(barCount - 1, cap + 1); // One look-ahead identifies the completed bucket, without revealing it.
  let cursor = currentSequence;
  let targetSequence = currentSequence;
  let firstBucket: number | null = null;
  let lastBucket: number | null = null;
  let previousVisibleSequence: number | null = null;
  let bucketCount = 0;
  let cachedBucket: ReturnType<typeof getAggregationBucket> = null;
  let pageSize = Math.min(DISPLAY_ADVANCE_PAGE_SIZE, Math.max(64, Math.ceil(displaySeconds / sourceSeconds * count) + 1));
  while (cursor < through) {
    const take = Math.min(pageSize, through - cursor);
    const candidates = await read(cursor, take);
    if (!candidates.length) break;
    for (const candidate of candidates) {
      const time = candidate.timestamp.getTime();
      const bucket: ReturnType<typeof getAggregationBucket> = cachedBucket && time >= cachedBucket.start && time < cachedBucket.end
        && (time - cachedBucket.start) % (sourceSeconds * 1000) === 0
        ? cachedBucket : getAggregationBucket(time, sourceSeconds, displaySeconds, session);
      cachedBucket = bucket;
      if (bucket && bucket.start !== lastBucket && bucketCount >= count) {
        return { targetSequence: previousVisibleSequence!, aggregationStart: new Date(firstBucket!),
          completedDisplayBucketStart: new Date(lastBucket!).toISOString(), reachedVisibleBucket: true };
      }
      if (candidate.sequence > cap) break;
      targetSequence = candidate.sequence;
      if (!bucket) continue;
      if (bucket.start !== lastBucket) { firstBucket ??= bucket.start; lastBucket = bucket.start; bucketCount++; }
      previousVisibleSequence = candidate.sequence;
    }
    cursor = candidates.at(-1)!.sequence;
    if (candidates.length < take) break;
    pageSize = DISPLAY_ADVANCE_PAGE_SIZE;
  }
  if (targetSequence === currentSequence) return null;
  const reachedVisibleBucket = targetSequence === barCount - 1 && bucketCount >= count;
  return { targetSequence, aggregationStart: firstBucket === null ? null : new Date(firstBucket),
    completedDisplayBucketStart: reachedVisibleBucket ? new Date(lastBucket!).toISOString() : null, reachedVisibleBucket };
}
