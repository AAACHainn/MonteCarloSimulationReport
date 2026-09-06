import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { aggregateMarketBars, getAggregationBucket } from "@/lib/market-replay/aggregation";
import { datasetSession, datasetSourceInterval, serializeSourceBar } from "@/lib/market-replay/dataset";
import { syncReplayToTarget } from "@/lib/market-replay/replay-sync";
import { MAX_DISPLAY_ADVANCE_SOURCE_BARS, isValidDisplayInterval } from "@/lib/market-replay/types";
import { paperAdvanceSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = paperAdvanceSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const [dataset, progress] = await Promise.all([
    prisma.marketDataset.findUnique({ where: { id } }),
    prisma.replayProgress.findUnique({ where: { datasetId: id } }),
  ]);
  if (!dataset || !progress) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  if (progress.currentSequence !== parsed.data.expectedCurrentSequence) {
    return NextResponse.json({ error: copy.paperTrading.conflict }, { status: 409 });
  }
  if (progress.currentSequence >= dataset.barCount - 1) {
    return NextResponse.json({ error: copy.paperTrading.noNextBar }, { status: 400 });
  }

  let targetSequence = Math.min(dataset.barCount - 1, progress.currentSequence + parsed.data.count);
  let aggregationStart: Date | null = null;
  let completedDisplayBucketStart: string | null = null;
  if (parsed.data.displayIntervalSeconds !== undefined) {
    const sourceSeconds = datasetSourceInterval(dataset);
    if (!sourceSeconds || !isValidDisplayInterval(sourceSeconds, parsed.data.displayIntervalSeconds)) {
      return NextResponse.json({ error: copy.marketReplay.invalidDisplayInterval }, { status: 400 });
    }
    const multiplier = parsed.data.displayIntervalSeconds / sourceSeconds;
    if (parsed.data.count > 1) {
      const displayCount = Math.min(
        parsed.data.count,
        Math.max(1, Math.floor(MAX_DISPLAY_ADVANCE_SOURCE_BARS / multiplier)),
      );
      const candidates = await prisma.marketBar.findMany({
        where: { datasetId: id, sequence: { gt: progress.currentSequence } },
        orderBy: { sequence: "asc" },
        take: multiplier * displayCount,
      });
      const buckets = aggregateMarketBars({
        bars: candidates.map(serializeSourceBar),
        sourceSeconds,
        displaySeconds: parsed.data.displayIntervalSeconds,
        session: datasetSession(dataset),
        currentSequence: candidates.at(-1)?.sequence ?? progress.currentSequence,
        finalSequence: dataset.barCount - 1,
      });
      const target = buckets[Math.min(displayCount, buckets.length) - 1];
      if (!target) return NextResponse.json({ error: copy.paperTrading.noNextBar }, { status: 400 });
      targetSequence = target.lastSequence;
      aggregationStart = new Date(buckets[0].timestamp);
      completedDisplayBucketStart = target.timestamp;
    } else {
      const nextBar = await prisma.marketBar.findUnique({
        where: { datasetId_sequence: { datasetId: id, sequence: progress.currentSequence + 1 } },
      });
      if (!nextBar) return NextResponse.json({ error: copy.paperTrading.noNextBar }, { status: 400 });
      const bucket = getAggregationBucket(
        nextBar.timestamp.getTime(), sourceSeconds, parsed.data.displayIntervalSeconds, datasetSession(dataset),
      );
      if (!bucket) return NextResponse.json({ error: copy.marketReplay.invalidDisplayInterval }, { status: 400 });
      const target = await prisma.marketBar.findFirst({
        where: { datasetId: id, timestamp: { gte: new Date(bucket.start), lt: new Date(bucket.end) } },
        orderBy: { timestamp: "desc" },
      });
      if (!target) return NextResponse.json({ error: copy.marketReplay.loadError }, { status: 404 });
      targetSequence = target.sequence;
      aggregationStart = new Date(bucket.start);
      completedDisplayBucketStart = aggregationStart.toISOString();
    }
  }

  const outcome = await syncReplayToTarget(id, {
    generation: progress.generation,
    requestId: `legacy_${randomUUID()}`,
    confirmedSequence: progress.currentSequence,
    syncVersion: progress.syncVersion,
    expectedPaperVersion: parsed.data.expectedVersion ?? null,
    targetSequence,
  }, MAX_DISPLAY_ADVANCE_SOURCE_BARS);
  if (outcome.status !== 200) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  const advanced = await prisma.marketBar.findMany({
    where: { datasetId: id, sequence: { gt: progress.currentSequence, lte: targetSequence } },
    orderBy: { sequence: "asc" },
  });
  const prefix = aggregationStart && advanced[0]?.timestamp > aggregationStart
    ? await prisma.marketBar.findMany({
      where: {
        datasetId: id,
        timestamp: { gte: aggregationStart, lt: advanced[0].timestamp },
        sequence: { lte: progress.currentSequence },
      },
      orderBy: { sequence: "asc" },
    })
    : [];
  const aggregatedBars = parsed.data.displayIntervalSeconds === undefined ? [] : aggregateMarketBars({
    bars: [...prefix, ...advanced].map(serializeSourceBar),
    sourceSeconds: datasetSourceInterval(dataset)!,
    displaySeconds: parsed.data.displayIntervalSeconds,
    session: datasetSession(dataset),
    currentSequence: targetSequence,
    finalSequence: dataset.barCount - 1,
  }).map((bar) => ({
    ...bar,
    status: bar.sourceCount === bar.expectedCount ? "COMPLETE" as const : "INCOMPLETE" as const,
  }));

  return NextResponse.json({
    currentSequence: targetSequence,
    advancedBars: parsed.data.displayIntervalSeconds === undefined ? advanced.map(serializeSourceBar) : [],
    completedDisplayBucketStart,
    aggregatedBars,
    lastSourceBar: advanced.length ? serializeSourceBar(advanced.at(-1)!) : null,
    snapshot: outcome.response.snapshot,
    generation: outcome.response.generation,
    syncVersion: outcome.response.syncVersion,
  });
}
