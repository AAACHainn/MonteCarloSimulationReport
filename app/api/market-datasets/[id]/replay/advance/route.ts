import { withReplaySessionRoute } from '@/lib/replay-sessions/scope';
import { progressWhere } from '@/lib/replay-sessions/scope';
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma, replayDatabaseQueryCount } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { planDisplayAdvance } from "@/lib/market-replay/display-advance";
import { aggregateMarketBars, getAggregationBucket } from "@/lib/market-replay/aggregation";
import { barEmissionMode, closeAggregatedBar } from "@/lib/market-replay/bar-quality";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { datasetSourceInterval, serializeSourceBar } from "@/lib/market-replay/dataset";
import type { ReplayServerResponse } from "@/lib/market-replay/server-sync-types";
import { syncReplayToTarget } from "@/lib/market-replay/replay-sync";
import { MAX_DISPLAY_ADVANCE_SOURCE_BARS, isValidDisplayInterval } from "@/lib/market-replay/types";
import { paperAdvanceSchema } from "@/lib/validations";
import { attachReplayDiagnostics } from "@/lib/market-replay/server-diagnostics";
import { tryFlatDisplayAdvance } from "@/lib/market-replay/flat-advance";

type RouteContext = { params: Promise<{ id: string }> };

async function handlePOST(request: Request, context: RouteContext) {
  const startedAt = performance.now();
  const queryStart = replayDatabaseQueryCount();
  const { id } = await context.params;
  const parsed = paperAdvanceSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  if (parsed.data.flatOnly) {
    const outcome = await tryFlatDisplayAdvance(id, parsed.data);
    const response = outcome.status === 200 ? NextResponse.json(outcome.response)
      : NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
    if (outcome.status === 200 && outcome.metrics) {
      response.headers.set("X-Replay-Source-Rows", String(outcome.metrics.sourceRows));
      response.headers.set("X-Replay-Summary-Rows", String(outcome.metrics.summaryRows));
    }
    return attachReplayDiagnostics(response, { startedAt, queryStart, strategy: "flat-display-advance", phases: outcome.phases });
  }

  const [dataset, progress] = await Promise.all([
    prisma.marketDataset.findUnique({ where: { id } }),
    prisma.replayProgress.findFirst({ where: progressWhere(id) }),
  ]);
  if (!dataset || !progress) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  if (parsed.data.historyVersion !== undefined && parsed.data.historyVersion !== dataset.historyVersion) return NextResponse.json({ error: copy.marketSync.historyChanged, code: "HISTORY_CHANGED" }, { status: 409 });
  const cached = parsed.data.requestId && progress.lastSyncRequestId === parsed.data.requestId && progress.lastSyncResponse
    ? JSON.parse(progress.lastSyncResponse) as ReplayServerResponse : null;
  if (cached && (cached.fromSequence !== parsed.data.expectedCurrentSequence || !cached.displayAdvance)) {
    return NextResponse.json({ error: copy.paperTrading.conflict }, { status: 409 });
  }
  if (!cached && progress.currentSequence !== parsed.data.expectedCurrentSequence) {
    return NextResponse.json({ error: copy.paperTrading.conflict }, { status: 409 });
  }
  if (!cached && progress.currentSequence >= dataset.barCount - 1) {
    return NextResponse.json({ error: copy.paperTrading.noNextBar }, { status: 400 });
  }

  let targetSequence = cached?.currentSequence ?? Math.min(dataset.barCount - 1, progress.currentSequence + parsed.data.count);
  let aggregationStart: Date | null = null;
  let completedDisplayBucketStart: string | null = cached?.displayAdvance?.completedDisplayBucketStart ?? null;
  let reachedVisibleBucket = cached?.displayAdvance?.reachedVisibleBucket ?? (parsed.data.displayIntervalSeconds === undefined);
  let displaySessionConfig: NonNullable<ReturnType<typeof resolveDisplaySession>> | null = null;
  if (!cached && parsed.data.displayIntervalSeconds !== undefined) {
    const sourceSeconds = datasetSourceInterval(dataset);
    if (!sourceSeconds || !isValidDisplayInterval(sourceSeconds, parsed.data.displayIntervalSeconds)) {
      return NextResponse.json({ error: copy.marketReplay.invalidDisplayInterval }, { status: 400 });
    }
    displaySessionConfig = resolveDisplaySession(dataset, parsed.data.displaySession);
    if (!displaySessionConfig) {
      return NextResponse.json({ error: copy.marketReplay.unsupportedDisplaySession }, { status: 400 });
    }
    const plan = await planDisplayAdvance({ currentSequence: progress.currentSequence, barCount: dataset.barCount,
      sourceSeconds, displaySeconds: parsed.data.displayIntervalSeconds, session: displaySessionConfig, count: parsed.data.count },
      (after, take) => prisma.marketBar.findMany({ where: { datasetId: id, sequence: { gt: after } },
        orderBy: { sequence: "asc" }, take, select: { sequence: true, timestamp: true } }));
    if (!plan) return NextResponse.json({ error: copy.paperTrading.noNextBar }, { status: 400 });
    ({ targetSequence, aggregationStart, completedDisplayBucketStart, reachedVisibleBucket } = plan);
  }

  const outcome = cached ? { status: 200 as const, response: cached, error: null, processedBars: undefined } : await syncReplayToTarget(id, {
    snapshotMode: parsed.data.snapshotMode,
    historyVersion: parsed.data.historyVersion,
    generation: progress.generation,
    requestId: parsed.data.requestId ?? `legacy_${randomUUID()}`,
    displayAdvance: { completedDisplayBucketStart, reachedVisibleBucket },
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
  if (outcome.status !== 200) return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });

  const advanced = outcome.processedBars ?? await prisma.marketBar.findMany({
    where: { datasetId: id, sequence: { gt: parsed.data.expectedCurrentSequence, lte: targetSequence } },
    orderBy: { sequence: "asc" },
  });
  if (parsed.data.displayIntervalSeconds !== undefined && !displaySessionConfig) displaySessionConfig = resolveDisplaySession(dataset, parsed.data.displaySession);
  if (!aggregationStart && advanced[0] && parsed.data.displayIntervalSeconds !== undefined) {
    const bucket = getAggregationBucket(advanced[0].timestamp.getTime(), datasetSourceInterval(dataset)!, parsed.data.displayIntervalSeconds, displaySessionConfig!);
    if (bucket) aggregationStart = new Date(bucket.start);
  }
  const prefix = aggregationStart && advanced[0]?.timestamp > aggregationStart
    ? await prisma.marketBar.findMany({
      where: {
        datasetId: id,
        timestamp: { gte: aggregationStart, lt: advanced[0].timestamp },
        sequence: { lte: parsed.data.expectedCurrentSequence },
      },
      orderBy: { sequence: "asc" },
    })
    : [];
  const aggregatedBars = parsed.data.displayIntervalSeconds === undefined ? [] : aggregateMarketBars({
    emissionMode: barEmissionMode(dataset.barEmissionMode),
    bars: [...prefix, ...advanced].map(serializeSourceBar),
    sourceSeconds: datasetSourceInterval(dataset)!,
    displaySeconds: parsed.data.displayIntervalSeconds,
    session: displaySessionConfig!,
    currentSequence: targetSequence,
    finalSequence: dataset.barCount - 1,
  }).map((bar) => bar.timestamp === completedDisplayBucketStart ? closeAggregatedBar(bar) : bar);

  const response = NextResponse.json({
    ...outcome.response,
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
  return attachReplayDiagnostics(response, {
    startedAt,
    queryStart,
    strategy: parsed.data.displayIntervalSeconds === undefined ? "source-advance" : "display-bucket-advance",
    phases: "phases" in outcome ? outcome.phases : undefined,
  });
}

export const POST = withReplaySessionRoute(handlePOST, { write: true, annotation: false, diagnostics: true });
