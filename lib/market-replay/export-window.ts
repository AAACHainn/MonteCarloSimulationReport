import { prisma } from "@/lib/db";
import { getAggregationBucket, getAdjacentAggregationBucketStart } from "./aggregation";
import { accountQuery, readAggregationRanges, WindowSourceBudgetError, type TimeRange, type AggregationReadMetrics } from "./aggregation-reader";
import type { MarketDataset } from "@prisma/client";
import { REPLAY_HISTORY_RAW_SOURCE_BUDGET, REPLAY_WINDOW_READ_ROW_BUDGET, REPLAY_WINDOW_READ_QUERY_BUDGET } from "./types";
import type { TradingSessionConfig } from "./types";
import { activeAggregation } from "./aggregation-storage";
import type { PdfWindow } from "@/lib/paper-trading/pdf-types";
import { replayHistoryPageSize } from "./history";
import { aggregationFingerprint } from "./time-aggregation";

type Options = { datasetId: string; anchorSequence: number; direction: "forward" | "backward"; count: number; warmupCount: number; endSequence: number; finalSequence?: number; sourceSeconds: number; displaySeconds: number; session: TradingSessionConfig; signal?: AbortSignal; budget?: { rows: number; queries: number }; dataset?: MarketDataset; revealedEndTime?: number; metrics?: AggregationReadMetrics };
function checkpoint(o: Options) { accountQuery(o); }

/** Walk real buckets via the timestamp index, jumping closures and data gaps. */
async function collect(o: Options, time: number, direction: 1 | -1, count: number) {
  const dataset = o.dataset ?? await prisma.marketDataset.findUniqueOrThrow({ where: { id: o.datasetId } });
  const parts: import("./types").AggregatedMarketBarData[][] = [];
  const rawBudget = { remaining: REPLAY_HISTORY_RAW_SOURCE_BUDGET };
  let collected = 0;
  while (collected < count) {
    checkpoint(o);
    const row = await prisma.marketBar.findFirst({
      where: { datasetId: o.datasetId, sequence: { lte: o.endSequence }, timestamp: direction === 1 ? { gte: new Date(time), lte: new Date(o.revealedEndTime!) } : { lt: new Date(Math.min(time, o.revealedEndTime! + 1)) } },
      orderBy: { timestamp: direction === 1 ? "asc" : "desc" }, select: { timestamp: true },
    });
    o.signal?.throwIfAborted();
    if (!row) break;
    const timestamp = row.timestamp.getTime();
    let bucket = getAggregationBucket(timestamp, o.sourceSeconds, o.displaySeconds, o.session);
    if (!bucket) {
      const adjacent = getAdjacentAggregationBucketStart(timestamp, direction, o.displaySeconds, o.session);
      if (adjacent === null) break;
      const next = getAggregationBucket(adjacent, o.sourceSeconds, o.displaySeconds, o.session);
      if (!next) break;
      time = direction === 1 ? next.start : next.end;
      continue;
    }
    const ranges: TimeRange[] = [];
    while (bucket && ranges.length < count - collected && bucket.end > dataset.startTime.getTime() && bucket.start <= o.revealedEndTime!) {
      ranges.push({ start: bucket.start, end: bucket.end });
      const adjacent = getAdjacentAggregationBucketStart(bucket.start, direction, o.displaySeconds, o.session);
      bucket = adjacent === null ? null : getAggregationBucket(adjacent, o.sourceSeconds, o.displaySeconds, o.session);
    }
    if (!ranges.length) break;
    let selected = direction === 1 ? ranges : ranges.reverse();
    let shortened = false;
    for (;;) {
      try {
        const bars = await readAggregationRanges({ ...o, dataset, rawBudget }, selected);
        parts.push(bars); collected += bars.length;
        break;
      } catch (error) {
        if (!(error instanceof WindowSourceBudgetError)) throw error;
        if (selected.length <= 1) {
          if (!collected) throw error;
          shortened = true; break;
        }
        shortened = true;
        const size = Math.max(1, Math.floor(selected.length / 2));
        selected = direction === 1 ? selected.slice(0, size) : selected.slice(-size);
      }
    }
    time = direction === 1 ? selected.at(-1)!.end : selected[0].start;
    if (shortened) break;
  }
  return (direction === 1 ? parts : parts.reverse()).flat();
}

export async function readExportWindow(o: Options): Promise<PdfWindow> {
  o = { ...o, dataset: o.dataset ?? await prisma.marketDataset.findUniqueOrThrow({ where: { id: o.datasetId } }) };
  if (o.displaySeconds > o.sourceSeconds) await activeAggregation(o.dataset!);
  const last = await prisma.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: o.datasetId, sequence: o.endSequence } }, select: { timestamp: true } });
  if (!last) return { bars: [], warmupBars: [], previousSequence: null, nextSequence: null };
  o.revealedEndTime = last.timestamp.getTime();
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

export class WindowVersionChangedError extends Error {}

function windowVersion(dataset: MarketDataset) {
  return JSON.stringify([dataset.dataVersion, dataset.historyVersion, dataset.activeAggregationId,
    dataset.barEmissionMode, aggregationFingerprint(dataset)]);
}

/** Restore the complete requested indicator history without enlarging any raw page.
 * Every page keeps the original revealed cutoff and shares a cumulative work budget.
 * A budget or version failure rejects the whole window, never a false short history.
 */
export async function readCompleteWindow(o: Options): Promise<PdfWindow> {
  const dataset = o.dataset ?? await prisma.marketDataset.findUniqueOrThrow({ where: { id: o.datasetId } });
  const budget = o.budget ?? { rows: REPLAY_WINDOW_READ_ROW_BUDGET, queries: REPLAY_WINDOW_READ_QUERY_BUDGET };
  const options = { ...o, dataset, budget };
  const pageSize = replayHistoryPageSize(o.sourceSeconds, o.displaySeconds);
  async function pages(anchor: number, direction: Options["direction"], count: number) {
    const parts: import("./types").AggregatedMarketBarData[][] = [];
    let remaining = count;
    while (anchor >= 0 && remaining > 0) {
      const page = await readExportWindow({ ...options, anchorSequence: anchor, direction,
        count: Math.min(pageSize, remaining), warmupCount: 0 });
      if (!page.bars.length) break; // The real source/session history is exhausted.
      parts.push(page.bars);
      remaining -= page.bars.length;
      const next = direction === "backward" ? page.previousSequence : page.nextSequence;
      if (next === null) break;
      if (direction === "backward" ? next >= anchor : next <= anchor) throw new Error("Window cursor did not advance.");
      anchor = next;
    }
    return (direction === "backward" ? parts.reverse() : parts).flat();
  }
  const bars = await pages(o.anchorSequence, o.direction, o.count);
  const warmupBars = bars.length && o.warmupCount
    ? await pages(bars[0].firstSequence - 1, "backward", o.warmupCount) : [];
  o.signal?.throwIfAborted();
  const current = await prisma.marketDataset.findUnique({ where: { id: o.datasetId } });
  if (!current || windowVersion(current) !== windowVersion(dataset)) throw new WindowVersionChangedError();
  return { bars, warmupBars,
    previousSequence: bars.length && bars[0].firstSequence > 0 ? bars[0].firstSequence - 1 : null,
    nextSequence: bars.length && bars.at(-1)!.lastSequence < o.endSequence ? bars.at(-1)!.lastSequence + 1 : null };
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
