import type { Prisma } from "@prisma/client";
import { getAggregationBucket, getAdjacentAggregationBucketStart } from "./aggregation";
import { isAggregationBucketClosed } from "./bar-quality";
import type { TimeRange } from "./aggregation-reader";
import type { TradingSessionConfig } from "./types";

/** Seek bucket boundaries through indexes, instead of visiting every source second. */
export async function planFlatDisplayAdvance(db: Prisma.TransactionClient, o: {
  datasetId: string; currentSequence: number; barCount: number; maximumSources: number;
  sourceSeconds: number; displaySeconds: number; session: TradingSessionConfig; count: number;
  metrics?: { sourceRows: number };
}) {
  const cap = Math.min(o.barCount - 1, o.currentSequence + o.maximumSources);
  const capBar = await db.marketBar.findUniqueOrThrow({ where: { datasetId_sequence: { datasetId: o.datasetId, sequence: cap } }, select: { timestamp: true } });
  const ranges: TimeRange[] = [];
  const current = o.currentSequence >= 0 ? await db.marketBar.findUniqueOrThrow({
    where: { datasetId_sequence: { datasetId: o.datasetId, sequence: o.currentSequence } }, select: { timestamp: true } }) : null;
  if (o.metrics) o.metrics.sourceRows += 1 + Number(Boolean(current));
  if (current) {
    const time = current.timestamp.getTime();
    const previous = getAggregationBucket(time, o.sourceSeconds, o.displaySeconds, o.session)
      ?? (() => { const adjacent = getAdjacentAggregationBucketStart(time, -1, o.displaySeconds, o.session);
        return adjacent === null ? null : getAggregationBucket(adjacent, o.sourceSeconds, o.displaySeconds, o.session); })();
    if (previous) ranges.push({ start: previous.start, end: previous.end });
  }
  let cursor = o.currentSequence;
  let completedDisplayBucketStart: string | null = null;
  let reachedVisibleBucket = false;
  let visible = 0;
  let startedHidden = false;
  // A limit bounds pathological off-grid/gap data without changing legal intervals.
  for (let seeks = 0; cursor < cap && seeks < 512; seeks++) {
    let candidate = await db.marketBar.findUniqueOrThrow({ where: { datasetId_sequence: { datasetId: o.datasetId, sequence: cursor + 1 } }, select: { sequence: true, timestamp: true } });
    if (o.metrics) o.metrics.sourceRows++;
    let bucket = getAggregationBucket(candidate.timestamp.getTime(), o.sourceSeconds, o.displaySeconds, o.session);
    if (seeks === 0) startedHidden = bucket === null;
    if (!bucket) {
      const next = getAdjacentAggregationBucketStart(candidate.timestamp.getTime(), 1, o.displaySeconds, o.session);
      if (next === null || next > capBar.timestamp.getTime()) { cursor = cap; break; }
      const selected = await db.marketBar.findFirst({ where: { datasetId: o.datasetId,
        timestamp: { gte: new Date(next), lte: capBar.timestamp } }, orderBy: { timestamp: "asc" }, select: { sequence: true, timestamp: true } });
      if (!selected) { cursor = cap; break; }
      if (o.metrics) o.metrics.sourceRows++;
      candidate = selected;
      bucket = getAggregationBucket(candidate.timestamp.getTime(), o.sourceSeconds, o.displaySeconds, o.session);
      if (!bucket) { cursor = candidate.sequence; continue; }
    }
    const last = await db.marketBar.findFirstOrThrow({ where: { datasetId: o.datasetId,
      timestamp: { gte: new Date(bucket.start), lt: new Date(Math.min(bucket.end, capBar.timestamp.getTime() + 1)) } },
      orderBy: { timestamp: "desc" }, select: { sequence: true, timestamp: true } });
    cursor = last.sequence;
    if (o.metrics) o.metrics.sourceRows++;
    if (!ranges.some(range => range.start === bucket.start)) ranges.push({ start: bucket.start, end: bucket.end });
    const lookahead = cursor < o.barCount - 1 ? await db.marketBar.findUniqueOrThrow({
      where: { datasetId_sequence: { datasetId: o.datasetId, sequence: cursor + 1 } }, select: { timestamp: true } }) : null;
    if (o.metrics) o.metrics.sourceRows += Number(Boolean(lookahead));
    const closed = isAggregationBucketClosed(bucket.end,
      last.timestamp.getTime() + o.sourceSeconds * 1000, lookahead?.timestamp.getTime());
    if (closed) completedDisplayBucketStart = new Date(bucket.start).toISOString();
    visible++;
    if (visible >= o.count) { reachedVisibleBucket = closed || cursor === o.barCount - 1; break; }
  }
  if (cursor <= o.currentSequence) throw new Error("No source advance was planned.");
  ranges.sort((a, b) => a.start - b.start);
  return { targetSequence: cursor, ranges, completedDisplayBucketStart, reachedVisibleBucket, startedHidden };
}
