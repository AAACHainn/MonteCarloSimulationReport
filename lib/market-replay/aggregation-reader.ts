import { Prisma, type MarketDataset } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aggregateMarketSegments, type AggregationSegment } from "./aggregation";
import { activeAggregation } from "./aggregation-storage";
import { barEmissionMode } from "./bar-quality";
import { aggregationLayers, aggregationSessionKey } from "./time-aggregation";
import type { TradingSessionConfig } from "./types";
import { REPLAY_HISTORY_RAW_SOURCE_BUDGET } from "./types";

export type TimeRange = { start: number; end: number };
export type AggregationReadMetrics = { sourceRows: number; summaryRows: number };
export class WindowSourceBudgetError extends Error {}
type ReadOptions = {
  db?: Prisma.TransactionClient;
  dataset: MarketDataset; endSequence: number; sourceSeconds: number; displaySeconds: number;
  session: TradingSessionConfig; signal?: AbortSignal; budget?: { rows: number; queries: number }; finalSequence?: number;
  rawBudget?: { remaining: number };
  revealedEndTime?: number;
  metrics?: AggregationReadMetrics;
};
export function accountQuery(o: Pick<ReadOptions, "signal" | "budget">, rows?: number) {
  o.signal?.throwIfAborted();
  if (o.budget) {
    if (rows === undefined) o.budget.queries--; else o.budget.rows -= rows;
    if (o.budget.rows < 0 || o.budget.queries < 0) throw new Error("EXPORT_WINDOW_BUDGET");
  }
}

/** Each UNION branch has its own lower/upper bound and index seek. Never a dataset-only OR scan. */
export async function readAggregationRanges(o: ReadOptions, ranges: TimeRange[]) {
  const db = o.db ?? prisma;
  const generation = o.displaySeconds > o.sourceSeconds ? await activeAggregation(o.dataset, db) : null;
  const layers = aggregationLayers(o.dataset).filter((layer) => layer.seconds <= o.displaySeconds
    && (layer.scope === "BASE" || aggregationSessionKey(layer.session) === aggregationSessionKey(o.session)))
    .sort((a, b) => b.seconds - a.seconds);
  let uncovered = ranges;
  const streams: AggregationSegment[][] = [];
  for (const layer of generation ? layers : []) {
    const eligible = uncovered.filter((range) => range.end - range.start >= layer.seconds * 1000);
    const selected: Array<{ bucketStart: Date; bucketEnd: Date; firstSequence: number; lastSequence: number; firstTime: Date; lastTime: Date; open: number; high: number; low: number; close: number; volume: number | null; sourceCount: number }> = [];
    for (let offset = 0; offset < eligible.length; offset += 50) {
      accountQuery(o);
      const branches = eligible.slice(offset, offset + 50).map((range) => Prisma.sql`
        SELECT * FROM "MarketAggregatedBar" WHERE "generationId" = ${generation!.id}
        AND "scope" = ${layer.scope} AND "intervalSeconds" = ${layer.seconds}
        AND "bucketStart" >= ${range.start} AND "bucketStart" < ${range.end}
        AND "bucketEnd" <= ${range.end} AND "lastSequence" <= ${o.endSequence}`);
      const rows = await db.$queryRaw<typeof selected>(Prisma.sql`${Prisma.join(branches, " UNION ALL ")} ORDER BY "bucketStart"`);
      accountQuery(o, rows.length);
      if (o.metrics) o.metrics.summaryRows += rows.length;
      selected.push(...rows.map((row) => ({ ...row, firstSequence: Number(row.firstSequence), lastSequence: Number(row.lastSequence), sourceCount: Number(row.sourceCount) })));
    }
    const remaining: TimeRange[] = [];
    const stream: AggregationSegment[] = [];
    let index = 0;
    for (const range of uncovered) {
      let cursor = range.start;
      while (index < selected.length && selected[index].bucketStart.getTime() < range.end) {
        const row = selected[index++];
        if (cursor < row.bucketStart.getTime()) remaining.push({ start: cursor, end: row.bucketStart.getTime() });
        cursor = row.bucketEnd.getTime();
        stream.push({ ...row, timestamp: row.firstTime.toISOString(), endTimestamp: row.lastTime.toISOString() });
      }
      if (cursor < range.end) remaining.push({ start: cursor, end: range.end });
    }
    uncovered = remaining;
    streams.push(stream);
  }
  let rawRows = 0;
  const maximumRawRows = o.rawBudget?.remaining ?? REPLAY_HISTORY_RAW_SOURCE_BUDGET;
  if (o.revealedEndTime !== undefined) uncovered = uncovered.map((range) => ({ ...range, end: Math.min(range.end, o.revealedEndTime! + o.sourceSeconds * 1000) })).filter((range) => range.start < range.end);
  // Summary selection preserves target boundaries. Raw reads can coalesce adjacent
  // uncovered ranges because the shared aggregator reconstructs those boundaries.
  const rawRanges: TimeRange[] = [];
  for (const range of uncovered) {
    const previous = rawRanges.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else rawRanges.push({ ...range });
  }
  const rawStream: AggregationSegment[] = [];
  for (let offset = 0; offset < rawRanges.length; offset += 50) {
    accountQuery(o);
    const branches = rawRanges.slice(offset, offset + 50).map((range) => Prisma.sql`
      SELECT "sequence", "timestamp", "open", "high", "low", "close", "volume" FROM "MarketBar"
      INDEXED BY "MarketBar_datasetId_timestamp_key" WHERE "datasetId" = ${o.dataset.id}
      AND "timestamp" >= ${range.start} AND "timestamp" < ${range.end} AND "sequence" <= ${o.endSequence}`);
    const rows = await db.$queryRaw<Array<{ sequence: number; timestamp: Date; open: number; high: number; low: number; close: number; volume: number | null }>>(
      Prisma.sql`${Prisma.join(branches, " UNION ALL ")} ORDER BY "timestamp" LIMIT ${maximumRawRows - rawRows + 1}`);
    accountQuery(o, rows.length);
    if (o.metrics) o.metrics.sourceRows += rows.length;
    rawRows += rows.length;
    if (rawRows > maximumRawRows) throw new WindowSourceBudgetError();
    for (const row of rows) rawStream.push({ ...row, firstSequence: Number(row.sequence), lastSequence: Number(row.sequence),
      timestamp: row.timestamp.toISOString(), endTimestamp: row.timestamp.toISOString(), sourceCount: 1 });
  }
  if (o.rawBudget) o.rawBudget.remaining -= rawRows;
  streams.push(rawStream);
  // A constant number of sorted layer streams: linear merge, no full-window sort.
  const cursors = streams.map(() => 0);
  const segments: AggregationSegment[] = [];
  for (;;) {
    let selected = -1;
    for (let i = 0; i < streams.length; i++) {
      if (cursors[i] < streams[i].length && (selected < 0 || streams[i][cursors[i]].firstSequence < streams[selected][cursors[selected]].firstSequence)) selected = i;
    }
    if (selected < 0) break;
    segments.push(streams[selected][cursors[selected]++]);
  }
  return aggregateMarketSegments({ segments, sourceSeconds: o.sourceSeconds, displaySeconds: o.displaySeconds,
    session: o.session, currentSequence: o.endSequence, finalSequence: o.finalSequence ?? o.endSequence,
    emissionMode: barEmissionMode(o.dataset.barEmissionMode),
    revealedThroughMs: o.revealedEndTime === undefined ? undefined : o.revealedEndTime + o.sourceSeconds * 1000 });
}
