import { prisma } from "@/lib/db";
import { aggregateMarketSegments, getAggregationBucket, getAdjacentAggregationBucketStart, type AggregationSegment } from "./aggregation";
import { marketBarBlockSizeForMultiplier } from "./history";
import type { AggregatedMarketBarData, TradingSessionConfig } from "./types";
import type { PdfWindow } from "@/lib/paper-trading/pdf-types";

type Options = { datasetId: string; anchorSequence: number; direction: "forward" | "backward"; count: number; warmupCount: number; endSequence: number; finalSequence?: number; sourceSeconds: number; displaySeconds: number; session: TradingSessionConfig; signal?: AbortSignal; budget?: { rows: number; queries: number } };
function checkpoint(o: Options, rows = 0) {
  o.signal?.throwIfAborted();
  if (o.budget) {
    o.budget.rows -= rows; o.budget.queries--;
    if (o.budget.rows < 0 || o.budget.queries < 0) throw new Error("EXPORT_WINDOW_BUDGET");
  }
}
const select = { sequence: true, timestamp: true, open: true, high: true, low: true, close: true, volume: true } as const;

/** Read only existing summaries, and stream uncovered rows in bounded chunks. */
async function bucketBar(o: Options, start: number, end: number) {
  checkpoint(o);
  const size = marketBarBlockSizeForMultiplier(o.displaySeconds / o.sourceSeconds);
  const blocks = size === null ? [] : await prisma.marketBarBlock.findMany({
    where: { datasetId: o.datasetId, blockSize: size, startTime: { gte: new Date(start) }, endTime: { lt: new Date(end) }, endSequence: { lte: o.endSequence } },
    orderBy: { startSequence: "asc" },
  });
  const segments: AggregationSegment[] = blocks.map((b) => ({
    firstSequence: b.startSequence, lastSequence: b.endSequence, timestamp: b.startTime.toISOString(), endTimestamp: b.endTime.toISOString(),
    open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volumeCount ? b.volume : null, sourceCount: b.barCount,
  }));
  checkpoint(o, blocks.length);
  const ranges: { start: number; end: number }[] = [];
  let cursor = start;
  for (const b of blocks) {
    const time = b.startTime.getTime();
    if (cursor < time) ranges.push({ start: cursor, end: time });
    cursor = b.endTime.getTime() + o.sourceSeconds * 1000;
  }
  if (cursor < end) ranges.push({ start: cursor, end });
  for (const range of ranges) {
    let time = range.start;
    let combined: AggregationSegment | null = null;
    while (time < range.end) {
      checkpoint(o);
      const rows = await prisma.marketBar.findMany({
        where: { datasetId: o.datasetId, sequence: { lte: o.endSequence }, timestamp: { gte: new Date(time), lt: new Date(range.end) } },
        orderBy: { timestamp: "asc" }, take: 4096, select,
      });
      checkpoint(o, rows.length);
      if (!rows.length) break;
      for (const b of rows) {
        if (!combined) combined = { firstSequence: b.sequence, lastSequence: b.sequence, timestamp: b.timestamp.toISOString(), endTimestamp: b.timestamp.toISOString(), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, sourceCount: 1 };
        else {
          combined.lastSequence = b.sequence; combined.endTimestamp = b.timestamp.toISOString(); combined.high = Math.max(combined.high, b.high);
          combined.low = Math.min(combined.low, b.low); combined.close = b.close; combined.sourceCount++;
          if (b.volume !== null) combined.volume = (combined.volume ?? 0) + b.volume;
        }
      }
      time = rows.at(-1)!.timestamp.getTime() + 1;
      if (rows.length < 4096) break;
    }
    if (combined) segments.push(combined);
  }
  return aggregateMarketSegments({ segments: segments.sort((a, b) => a.firstSequence - b.firstSequence), sourceSeconds: o.sourceSeconds, displaySeconds: o.displaySeconds, session: o.session, currentSequence: o.endSequence, finalSequence: o.finalSequence ?? o.endSequence })[0] ?? null;
}

/** Walk real buckets via the timestamp index, jumping closures and data gaps. */
async function collect(o: Options, time: number, direction: 1 | -1, count: number) {
  const bars: AggregatedMarketBarData[] = [];
  while (bars.length < count) {
    checkpoint(o);
    const row = await prisma.marketBar.findFirst({
      where: { datasetId: o.datasetId, sequence: { lte: o.endSequence }, timestamp: direction === 1 ? { gte: new Date(time) } : { lt: new Date(time) } },
      orderBy: { timestamp: direction === 1 ? "asc" : "desc" }, select: { timestamp: true },
    });
    o.signal?.throwIfAborted();
    if (!row) break;
    const timestamp = row.timestamp.getTime();
    const bucket = getAggregationBucket(timestamp, o.sourceSeconds, o.displaySeconds, o.session);
    if (!bucket) {
      const adjacent = getAdjacentAggregationBucketStart(timestamp, direction, o.displaySeconds, o.session);
      if (adjacent === null) break;
      const next = getAggregationBucket(adjacent, o.sourceSeconds, o.displaySeconds, o.session);
      if (!next) break;
      time = direction === 1 ? next.start : next.end;
      continue;
    }
    const bar = await bucketBar(o, bucket.start, bucket.end);
    if (bar) bars.push(bar);
    time = direction === 1 ? bucket.end : bucket.start;
  }
  return direction === 1 ? bars : bars.reverse();
}

export async function readExportWindow(o: Options): Promise<PdfWindow> {
  const anchor = await prisma.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: o.datasetId, sequence: o.anchorSequence } }, select: { timestamp: true } });
  if (!anchor) return { bars: [], warmupBars: [], previousSequence: null, nextSequence: null };
  const time = anchor.timestamp.getTime();
  const bucket = getAggregationBucket(time, o.sourceSeconds, o.displaySeconds, o.session);
  const direction = o.direction === "forward" ? 1 : -1;
  const start = bucket ? direction === 1 ? bucket.start : bucket.end : time + (direction === -1 ? 1 : 0);
  const bars = await collect(o, start, direction, o.count);
  const warmupBars = bars.length && o.warmupCount ? await collect(o, new Date(bars[0].timestamp).getTime(), -1, o.warmupCount) : [];
  return { bars, warmupBars, previousSequence: bars.length && bars[0].firstSequence > 0 ? bars[0].firstSequence - 1 : null, nextSequence: bars.length && bars.at(-1)!.lastSequence < o.endSequence ? bars.at(-1)!.lastSequence + 1 : null };
}

/** Freeze the start of a background window using indexed identities, without aggregating its OHLC. */
export async function planExportWindow(o: Omit<Options, "direction" | "warmupCount">) {
  const anchor = await prisma.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: o.datasetId, sequence: o.anchorSequence } }, select: { timestamp: true } });
  if (!anchor) return { fromSequence: o.anchorSequence, count: 0 };
  let time = anchor.timestamp.getTime() + 1, fromSequence = o.anchorSequence, count = 0;
  const options: Options = { ...o, direction: "backward", warmupCount: 0 };
  while (count < o.count) {
    checkpoint(options);
    const last = await prisma.marketBar.findFirst({ where: { datasetId: o.datasetId, sequence: { lte: o.endSequence }, timestamp: { lt: new Date(time) } }, orderBy: { timestamp: "desc" }, select: { timestamp: true } });
    if (!last) break;
    const bucket = getAggregationBucket(last.timestamp.getTime(), o.sourceSeconds, o.displaySeconds, o.session);
    if (!bucket) {
      const adjacent = getAdjacentAggregationBucketStart(last.timestamp.getTime(), -1, o.displaySeconds, o.session);
      if (adjacent === null) break;
      const previous = getAggregationBucket(adjacent, o.sourceSeconds, o.displaySeconds, o.session);
      if (!previous) break;
      time = previous.end; continue;
    }
    checkpoint(options);
    const first = await prisma.marketBar.findFirst({ where: { datasetId: o.datasetId, sequence: { lte: o.endSequence }, timestamp: { gte: new Date(bucket.start), lt: new Date(bucket.end) } }, orderBy: { timestamp: "asc" }, select: { sequence: true } });
    if (first) { fromSequence = first.sequence; count++; }
    time = bucket.start;
  }
  o.signal?.throwIfAborted();
  return { fromSequence, count };
}
