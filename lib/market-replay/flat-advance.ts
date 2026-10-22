import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import type { paperAdvanceSchema } from "@/lib/validations";
import { accountWhere, assertReplayWritable, getReplayScope, markReplayMutation, progressWhere } from "@/lib/replay-sessions/scope";
import { persistContextRuns } from "@/lib/replay-sessions/context-storage";
import { REPLAY_CHECKPOINT_STRIDE, type CheckpointState } from "@/lib/replay-sessions/checkpoint";
import { paperStateUpdate } from "@/lib/replay-sessions/persistence";
import { advanceFlatAccount, canAdvanceFlatAccount, flatEquityPoint, flatSampleSequences } from "@/lib/paper-trading/flat-advance";
import { ensureReplayJournalSession } from "@/lib/paper-trading/journal-storage";
import { ensurePaperTradeStats, getPaperSessionSnapshot, serializePaperSession, tradeStatsFromSession, type SessionRecord } from "@/lib/paper-trading/serialize";
import { datasetSourceInterval, serializeSourceBar } from "./dataset";
import { resolveDisplaySession } from "./chart-sessions";
import { planFlatDisplayAdvance } from "./flat-display-plan";
import { readAggregationRanges, WindowSourceBudgetError, type AggregationReadMetrics } from "./aggregation-reader";
import { AggregationNotReadyError } from "./aggregation-storage";
import { closeAggregatedBar } from "./bar-quality";
import { isValidDisplayInterval, MAX_DISPLAY_ADVANCE_SOURCE_BARS, type AggregatedMarketBarData, type MarketBarData } from "./types";
import type { ReplayServerResult } from "./server-sync-types";

type Input = z.infer<typeof paperAdvanceSchema>;
type FlatResponse = ReplayServerResult & { aggregatedBars: AggregatedMarketBarData[]; lastSourceBar: MarketBarData;
  completedDisplayBucketStart: string | null; reachedVisibleBucket: boolean; flatAdvanceKey: string };
type Outcome = { status: 200; response: FlatResponse | { flatAdvanceUnavailable: true }; metrics?: AggregationReadMetrics }
  | { status: 400 | 404 | 409; error: string; code?: string };
const unavailable = { status: 200, response: { flatAdvanceUnavailable: true } } as const;
const MAX_FLAT_SAMPLES = 4096;

/** This endpoint never trusts the browser's empty-account hint. Eligibility and commit share a transaction. */
export async function tryFlatDisplayAdvance(datasetId: string, input: Input): Promise<Outcome> {
  return sqliteWriteTransaction(prisma, async tx => {
    await assertReplayWritable(tx);
    const [dataset, progress, stored] = await Promise.all([
      tx.marketDataset.findUnique({ where: { id: datasetId } }), tx.replayProgress.findFirst({ where: progressWhere(datasetId) }),
      tx.paperTradingSession.findFirst({ where: accountWhere(datasetId) }),
    ]);
    if (!dataset || !progress) return { status: 404, error: copy.marketReplay.datasetNotFound };
    if (input.historyVersion !== undefined && input.historyVersion !== dataset.historyVersion) return { status: 409, error: copy.marketSync.historyChanged, code: "HISTORY_CHANGED" };
    const key = JSON.stringify([input.expectedCurrentSequence, input.expectedVersion, input.count,
      input.displayIntervalSeconds, input.displaySession, input.abrLength, input.displayUtcOffsetMinutes, input.abrHistoryStartSequence]);
    if (input.requestId && progress.lastSyncRequestId === input.requestId && progress.lastSyncResponse) {
      const cached = JSON.parse(progress.lastSyncResponse) as FlatResponse;
      return cached.flatAdvanceKey === key ? { status: 200, response: cached }
        : { status: 409, error: copy.paperTrading.conflict };
    }
    if (progress.currentSequence !== input.expectedCurrentSequence || (stored?.version ?? null) !== (input.expectedVersion ?? null)
      || (stored && stored.lastProcessedSequence !== progress.currentSequence)) return { status: 409, error: copy.paperTrading.conflict };
    if (progress.currentSequence >= dataset.barCount - 1) return { status: 400, error: copy.paperTrading.noNextBar };
    const sourceSeconds = datasetSourceInterval(dataset);
    const displaySeconds = input.displayIntervalSeconds;
    const session = resolveDisplaySession(dataset, input.displaySession);
    if (!sourceSeconds || !displaySeconds || !isValidDisplayInterval(sourceSeconds, displaySeconds) || !session) return unavailable;
    if (stored) {
      const [pending, lot, openTrade] = await Promise.all([
        tx.paperOrder.findFirst({ where: { sessionId: stored.id, status: "PENDING" }, select: { id: true } }),
        tx.paperPositionLot.findFirst({ where: { sessionId: stored.id }, select: { id: true } }),
        tx.paperTrade.findFirst({ where: { sessionId: stored.id, status: "OPEN" }, select: { id: true } }),
      ]);
      if (!canAdvanceFlatAccount(stored, Number(Boolean(pending)), Number(Boolean(lot))) || openTrade) return unavailable;
    }
    const stride = stored?.equitySampleStride ?? MAX_DISPLAY_ADVANCE_SOURCE_BARS;
    if (!Number.isSafeInteger(stride) || stride < 1) return unavailable;
    const maximumSources = Math.floor(Math.min(MAX_DISPLAY_ADVANCE_SOURCE_BARS,
      Math.floor((MAX_FLAT_SAMPLES - 2) / (1 / stride + 1 / 100))) / 100) * 100;
    const metrics: AggregationReadMetrics = { sourceRows: 0, summaryRows: 0 };
    const plan = await planFlatDisplayAdvance(tx, { datasetId, currentSequence: progress.currentSequence,
      barCount: dataset.barCount, maximumSources, sourceSeconds, displaySeconds, session, count: input.count, metrics });
    const last = await tx.marketBar.findUniqueOrThrow({ where: { datasetId_sequence: { datasetId, sequence: plan.targetSequence } } });
    metrics.sourceRows++;
    let aggregates: AggregatedMarketBarData[];
    try {
      aggregates = await readAggregationRanges({ db: tx, dataset, endSequence: plan.targetSequence, sourceSeconds, displaySeconds,
        session, finalSequence: dataset.barCount - 1, revealedEndTime: last.timestamp.getTime(), metrics,
        budget: { rows: 30_000, queries: 1000 } }, plan.ranges);
    } catch (error) {
      if (error instanceof AggregationNotReadyError || error instanceof WindowSourceBudgetError) return unavailable;
      throw error;
    }
    aggregates = aggregates.map(bar => bar.timestamp === plan.completedDisplayBucketStart ? closeAggregatedBar(bar) : bar);
    let account = stored ? await ensurePaperTradeStats(stored as SessionRecord, tx) : null;
    if (account) {
      await ensureReplayJournalSession(tx, account, progress.generation);
      const before = serializePaperSession(account);
      const state = advanceFlatAccount(before, plan.targetSequence);
      const samples = flatSampleSequences(progress.currentSequence, plan.targetSequence, stride, !plan.startedHidden);
      if (samples.length > MAX_FLAT_SAMPLES) throw new Error("Flat sampling budget exceeded.");
      for (let offset = 0; offset < samples.length; offset += 500) {
        const sequences = samples.slice(offset, offset + 500);
        const times = await tx.marketBar.findMany({ where: { datasetId, sequence: { in: sequences } },
          select: { sequence: true, timestamp: true }, orderBy: { sequence: "asc" } });
        if (times.length !== sequences.length) throw new Error("Flat sampling source is missing.");
        metrics.sourceRows += times.length;
        await tx.paperEquityPoint.createMany({ data: times.map(row => ({ sessionId: account!.id,
          ...flatEquityPoint(state, row.sequence, row.timestamp.toISOString()), timestamp: row.timestamp })) });
      }
      const scope = getReplayScope();
      if (scope) {
        const previous = await tx.replayCheckpoint.findFirst({ where: { projectionId: scope.projectionId }, orderBy: { sourceSequence: "desc" } });
        const checkpoints: number[] = previous ? [] : [progress.currentSequence];
        let checkpointSequence = previous?.sourceSequence ?? progress.currentSequence;
        if (checkpointSequence + REPLAY_CHECKPOINT_STRIDE <= progress.currentSequence) {
          checkpoints.push(progress.currentSequence); checkpointSequence = progress.currentSequence;
        }
        while (checkpointSequence + REPLAY_CHECKPOINT_STRIDE <= plan.targetSequence) {
          checkpointSequence += REPLAY_CHECKPOINT_STRIDE; checkpoints.push(checkpointSequence);
        }
        const base: CheckpointState = { account: before, stats: tradeStatsFromSession(account), activeOrders: [], lots: [], activeTrade: null, equitySampleStride: stride };
        if (checkpoints.length) await tx.replayCheckpoint.createMany({ data: checkpoints.map(sequence => ({ projectionId: scope.projectionId,
          sourceSequence: sequence, commandOrdinal: 0, state: JSON.stringify({ ...base,
            account: sequence === progress.currentSequence ? before : advanceFlatAccount(before, sequence) }) })) });
      }
      account = await tx.paperTradingSession.update({ where: { id: account.id }, data: paperStateUpdate(state) });
    }
    await persistContextRuns(tx, [{ fromSequence: progress.currentSequence + 1, toSequence: plan.targetSequence,
      generation: progress.generation, context: null, flatAdvance: { kind: "FLAT_ADVANCE_V1", historyVersion: dataset.historyVersion,
        abrLength: input.abrLength, displayIntervalSeconds: displaySeconds, displaySession: input.displaySession,
        displayUtcOffsetMinutes: input.displayUtcOffsetMinutes, priceTickSize: dataset.priceTickSize,
        abrHistoryStartSequence: input.abrHistoryStartSequence ?? 0 } }]);
    const response: FlatResponse = { requestId: input.requestId!, fromSequence: progress.currentSequence, currentSequence: plan.targetSequence,
      generation: progress.generation, syncVersion: progress.syncVersion + 1, historyVersion: dataset.historyVersion, dataVersion: dataset.dataVersion,
      fills: [], snapshot: await getPaperSessionSnapshot(datasetId, tx, { session: account, trainingGate: getReplayScope()?.trainingGate,
        trainingLotsHydrated: true, currentBar: last }), aggregatedBars: aggregates, lastSourceBar: serializeSourceBar(last),
      completedDisplayBucketStart: plan.completedDisplayBucketStart, reachedVisibleBucket: plan.reachedVisibleBucket,
      displayAdvance: { completedDisplayBucketStart: plan.completedDisplayBucketStart, reachedVisibleBucket: plan.reachedVisibleBucket }, flatAdvanceKey: key };
    await tx.replayProgress.update({ where: { id: progress.id }, data: { currentSequence: plan.targetSequence,
      syncVersion: response.syncVersion, lastSyncRequestId: input.requestId, lastSyncResponse: JSON.stringify(response) } });
    await markReplayMutation(tx, plan.targetSequence);
    return { status: 200, response, metrics };
  }, { timeout: 120_000 });
}
