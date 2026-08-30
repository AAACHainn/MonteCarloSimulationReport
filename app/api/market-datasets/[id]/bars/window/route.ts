import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { aggregateMarketSegments, getAggregationBucket, type AggregationSegment } from "@/lib/market-replay/aggregation";
import { datasetSession, datasetSourceInterval, serializeSourceBar } from "@/lib/market-replay/dataset";
import { isValidDisplayInterval } from "@/lib/market-replay/types";
import { ensureMarketBarBlocks } from "@/lib/market-replay/bar-blocks";
import { replayWindowSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const parsed = replayWindowSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const dataset = await prisma.marketDataset.findUnique({ where: { id } });
  if (!dataset || dataset.status !== "READY") return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  const sourceSeconds = datasetSourceInterval(dataset);
  if (!sourceSeconds || !isValidDisplayInterval(sourceSeconds, parsed.data.displayIntervalSeconds)) {
    return NextResponse.json({ error: copy.marketReplay.invalidDisplayInterval }, { status: 400 });
  }
  const endSequence = Math.min(parsed.data.endSequence, dataset.barCount - 1);
  if (endSequence < 0) return NextResponse.json({ visibleBars: [], warmupBars: [], lastSourceBar: null });

  const multiplier = parsed.data.displayIntervalSeconds / sourceSeconds;
  const aggregateCount = parsed.data.visibleCount + parsed.data.warmupCount + 2;
  const sourceTake = Math.min(endSequence + 1, Math.ceil(aggregateCount * multiplier));
  const fromSequence = endSequence - sourceTake + 1;
  const session = datasetSession(dataset);
  await ensureMarketBarBlocks(id, dataset.barCount);
  const blocks = await prisma.marketBarBlock.findMany({
    where: { datasetId: id, startSequence: { gte: fromSequence }, endSequence: { lte: endSequence } },
    orderBy: { startSequence: "asc" },
  });
  const acceptedBlocks = blocks.filter((block) => {
    const first = getAggregationBucket(block.startTime.getTime(), sourceSeconds, parsed.data.displayIntervalSeconds, session);
    const last = getAggregationBucket(block.endTime.getTime(), sourceSeconds, parsed.data.displayIntervalSeconds, session);
    return first && last && first.start === last.start;
  });
  const rawRanges: Array<{ from: number; to: number }> = [];
  let cursor = fromSequence;
  for (const block of acceptedBlocks) {
    if (cursor < block.startSequence) rawRanges.push({ from: cursor, to: block.startSequence - 1 });
    cursor = block.endSequence + 1;
  }
  if (cursor <= endSequence) rawRanges.push({ from: cursor, to: endSequence });
  const rawRecords = [];
  for (let index = 0; index < rawRanges.length; index += 50) {
    rawRecords.push(...await prisma.marketBar.findMany({
      where: { datasetId: id, OR: rawRanges.slice(index, index + 50).map((range) => ({ sequence: { gte: range.from, lte: range.to } })) },
      orderBy: { sequence: "asc" },
    }));
  }
  const sourceBars = rawRecords.map(serializeSourceBar);
  const segments: AggregationSegment[] = [
    ...sourceBars.map((bar) => ({ firstSequence: bar.sequence, lastSequence: bar.sequence, timestamp: bar.timestamp, endTimestamp: bar.timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, sourceCount: 1 })),
    ...acceptedBlocks.map((block) => ({ firstSequence: block.startSequence, lastSequence: block.endSequence, timestamp: block.startTime.toISOString(), endTimestamp: block.endTime.toISOString(), open: block.open, high: block.high, low: block.low, close: block.close, volume: block.volumeCount ? block.volume : null, sourceCount: block.barCount })),
  ].sort((a, b) => a.firstSequence - b.firstSequence);
  const aggregated = aggregateMarketSegments({
    segments,
    sourceSeconds,
    displaySeconds: parsed.data.displayIntervalSeconds,
    session,
    currentSequence: endSequence,
    finalSequence: dataset.barCount - 1,
  });
  const wanted = parsed.data.visibleCount + parsed.data.warmupCount;
  const window = aggregated.slice(-wanted);
  const visibleFrom = Math.max(0, window.length - parsed.data.visibleCount);
  return NextResponse.json({
    warmupBars: window.slice(0, visibleFrom),
    visibleBars: window.slice(visibleFrom),
    lastSourceBar: endSequence >= 0 ? serializeSourceBar(await prisma.marketBar.findUniqueOrThrow({ where: { datasetId_sequence: { datasetId: id, sequence: endSequence } } })) : null,
  });
}
