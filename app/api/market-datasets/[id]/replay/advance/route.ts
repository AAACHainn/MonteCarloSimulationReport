import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { aggregateMarketBars, getAggregationBucket } from "@/lib/market-replay/aggregation";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { datasetSourceInterval, serializeSourceBar } from "@/lib/market-replay/dataset";
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
  let reachedVisibleBucket = parsed.data.displayIntervalSeconds === undefined;
  let displaySessionConfig: NonNullable<ReturnType<typeof resolveDisplaySession>> | null = null;
  if (parsed.data.displayIntervalSeconds !== undefined) {
    const sourceSeconds = datasetSourceInterval(dataset);
    if (!sourceSeconds || !isValidDisplayInterval(sourceSeconds, parsed.data.displayIntervalSeconds)) {
      return NextResponse.json({ error: copy.marketReplay.invalidDisplayInterval }, { status: 400 });
    }
    displaySessionConfig = resolveDisplaySession(dataset, parsed.data.displaySession);
    if (!displaySessionConfig) {
      return NextResponse.json({ error: copy.marketReplay.unsupportedDisplaySession }, { status: 400 });
    }
    const candidates = await prisma.marketBar.findMany({
      where: { datasetId: id, sequence: { gt: progress.currentSequence } },
      orderBy: { sequence: "asc" },
      take: MAX_DISPLAY_ADVANCE_SOURCE_BARS + 1,
    });
    if (!candidates.length) return NextResponse.json({ error: copy.paperTrading.noNextBar }, { status: 400 });
    const cappedLast = candidates[Math.min(candidates.length, MAX_DISPLAY_ADVANCE_SOURCE_BARS) - 1];
    const bucketStarts: number[] = [];
    let previousVisibleSequence: number | null = null;
    for (const candidate of candidates) {
      const bucket = getAggregationBucket(
        candidate.timestamp.getTime(), sourceSeconds, parsed.data.displayIntervalSeconds, displaySessionConfig,
      );
      if (!bucket) continue;
      if (bucketStarts.at(-1) !== bucket.start) {
        if (bucketStarts.length >= parsed.data.count) {
          targetSequence = previousVisibleSequence!;
          reachedVisibleBucket = true;
          completedDisplayBucketStart = new Date(bucketStarts.at(-1)!).toISOString();
          break;
        }
        bucketStarts.push(bucket.start);
      }
      previousVisibleSequence = candidate.sequence;
    }
    if (!reachedVisibleBucket) {
      targetSequence = cappedLast.sequence;
      if (targetSequence === dataset.barCount - 1 && bucketStarts.length >= parsed.data.count) {
        reachedVisibleBucket = true;
        completedDisplayBucketStart = new Date(bucketStarts.at(-1)!).toISOString();
      }
    }
    if (bucketStarts.length) aggregationStart = new Date(bucketStarts[0]);
  }

  const outcome = await syncReplayToTarget(id, {
    generation: progress.generation,
    requestId: `legacy_${randomUUID()}`,
    confirmedSequence: progress.currentSequence,
    syncVersion: progress.syncVersion,
    expectedPaperVersion: parsed.data.expectedVersion ?? null,
    targetSequence,
    journalContext: parsed.data.displayIntervalSeconds === undefined ? null : {
      abrValue: parsed.data.abrValue ?? null,
      abrLength: parsed.data.abrLength,
      displayIntervalSeconds: parsed.data.displayIntervalSeconds,
      displaySession: parsed.data.displaySession,
      displayUtcOffsetMinutes: parsed.data.displayUtcOffsetMinutes,
      priceTickSize: dataset.priceTickSize,
    },
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
    session: displaySessionConfig!,
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
    reachedVisibleBucket,
    aggregatedBars,
    lastSourceBar: advanced.length ? serializeSourceBar(advanced.at(-1)!) : null,
    snapshot: outcome.response.snapshot,
    generation: outcome.response.generation,
    syncVersion: outcome.response.syncVersion,
  });
}
