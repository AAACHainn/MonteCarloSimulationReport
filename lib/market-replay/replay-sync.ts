import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import type { MarketBar } from "@prisma/client";
import { hydrateTrainingLots } from "@/lib/paper-trading/serialize";
import { progressWhere, accountWhere, assertReplayWritable, markReplayMutation, getReplayScope } from '@/lib/replay-sessions/scope';
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { datasetSourceInterval, serializeSourceBar } from "@/lib/market-replay/dataset";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { isValidDisplayInterval, MAX_REPLAY_SYNC_SOURCE_BARS } from "@/lib/market-replay/types";
import { createDeterministicEventIdFactory } from "@/lib/paper-trading/deterministic-id";
import { advancePaperTrading } from "@/lib/paper-trading/engine";
import { advanceFlatAccount, canAdvanceFlatAccount, flatEquityPoint } from "@/lib/paper-trading/flat-advance";
import {
  ensurePaperTradeStats,
  getPaperSessionSnapshot,
  serializePaperOrder,
  serializePaperPositionLot,
  serializePaperSession,
  type SessionRecord,
} from "@/lib/paper-trading/serialize";
import type { PaperEquityPointData, PaperFillData, PaperJournalContext, PaperOrderData, ReplayJournalEntryDraft } from "@/lib/paper-trading/types";
import { persistDerivedBatch } from "@/lib/replay-sessions/persistence";
import { saveReplayCheckpoint, REPLAY_CHECKPOINT_STRIDE } from "@/lib/replay-sessions/checkpoint";
import { persistContextRuns } from "@/lib/replay-sessions/context-storage";
import { validContextRuns } from "@/lib/replay-sessions/context-runs";
import type { ReplayContextRun } from "@/lib/replay-sessions/context-runs";
import type { ReplayServerResponse, DisplayAdvanceResult } from "./server-sync-types";


import { marketVersionMatches } from "./history-version";
import { loadPropAccount, persistPropAccount } from "@/lib/prop-practice/service";
import { observeProp, preparePropDay, settlePropDay, shouldStopPropReplay } from "@/lib/prop-practice/rules";
import { propTradingDay } from "@/lib/prop-practice/trading-day";

export type ReplaySyncInput = {
  snapshotMode?: "LIVE";
  historyVersion?: number;
  dataVersion?: number;
  contextRuns?: ReplayContextRun[];
  displayAdvance?: DisplayAdvanceResult;
  generation: number;
  requestId: string;
  confirmedSequence: number;
  syncVersion: number;
  expectedPaperVersion: number | null;
  targetSequence: number;
  journalContext?: PaperJournalContext | null;
  /** Keep the former 100-source commit-boundary equity samples when coalescing manual requests. */
  preserveSyncSamples?: boolean;
};

export type ReplaySyncSuccess = ReplayServerResponse;

export type ReplaySyncOutcome =
  | { status: 200; error: null; response: ReplaySyncSuccess; processedBars?: MarketBar[] }
  | { status: 400 | 404 | 409; error: string; code?: string; response?: never };

export async function syncReplayToTarget(
  datasetId: string,
  input: ReplaySyncInput,
  maximumSourceBars = MAX_REPLAY_SYNC_SOURCE_BARS,
): Promise<ReplaySyncOutcome & { phases: Record<string, number> }> {
  const startedAt = performance.now();
  let enteredAt = startedAt;
  let completedAt = startedAt;
  const phases: Record<string, number> = {};
  const outcome = await sqliteWriteTransaction(prisma, async (tx) => {
    enteredAt = performance.now();
    const isProp = getReplayScope()?.accountCategory === "PROP_PRACTICE";
    if (!isProp) await assertReplayWritable(tx);
    const [dataset, progress, session] = await Promise.all([
      tx.marketDataset.findUnique({ where: { id: datasetId } }),
      tx.replayProgress.findFirst({ where: progressWhere(datasetId) }),
      tx.paperTradingSession.findFirst({ where: accountWhere(datasetId) }),
    ]);
    if (!dataset || !progress) return { status: 404, error: copy.marketReplay.datasetNotFound } as const;
    if (progress.lastSyncRequestId === input.requestId && progress.lastSyncResponse) {
      const receipt = JSON.parse(progress.lastSyncResponse) as ReplaySyncSuccess;
      if (receipt.fromSequence !== input.confirmedSequence || (receipt.requestedTargetSequence ?? receipt.currentSequence) !== input.targetSequence
        || receipt.generation !== input.generation) return { status: 409, error: copy.paperTrading.conflict } as const;
      return { status: 200, error: null, response: receipt } as const;
    }
    if (isProp) await assertReplayWritable(tx);
    const prop = await loadPropAccount(tx);
    let previousProp = prop ? structuredClone(prop.state) : null;
    let stopped = false;
    const processedBars: MarketBar[] = [];
    if (input.historyVersion !== undefined && input.historyVersion !== dataset.historyVersion) return { status: 409, error: copy.marketSync.historyChanged, code: "HISTORY_CHANGED" } as const;
    if (
      (input.dataVersion !== undefined && !marketVersionMatches(dataset, { dataVersion: input.dataVersion, historyVersion: input.historyVersion }))
      || progress.generation !== input.generation
      || progress.syncVersion !== input.syncVersion
      || progress.currentSequence !== input.confirmedSequence
    ) {
      return { status: 409, error: copy.paperTrading.conflict } as const;
    }
    if (
      input.targetSequence <= progress.currentSequence
      || input.targetSequence >= dataset.barCount
      || input.targetSequence - progress.currentSequence > maximumSourceBars
    ) {
      return { status: 400, error: copy.marketReplay.validation.progressOutOfRange } as const;
    }
    if (input.contextRuns && !validContextRuns(input.contextRuns, progress.currentSequence + 1, input.targetSequence, progress.generation)) {
      return { status: 400, error: copy.marketReplay.validation.progressInvalid } as const;
    }
    const sourceSeconds = datasetSourceInterval(dataset);
    if (input.contextRuns?.some(({ context }) => context && (!sourceSeconds
      || !isValidDisplayInterval(sourceSeconds, context.displayIntervalSeconds)
      || !resolveDisplaySession(dataset, context.displaySession) || context.priceTickSize !== dataset.priceTickSize))) {
      return { status: 400, error: copy.marketReplay.invalidDisplayInterval } as const;
    }
    const dbBars = await tx.marketBar.findMany({
      where: { datasetId, sequence: { gt: progress.currentSequence, lte: input.targetSequence } },
      orderBy: { sequence: "asc" },
    });
    if (dbBars.length !== input.targetSequence - progress.currentSequence) {
      return { status: 404, error: copy.marketReplay.loadError } as const;
    }

    const fills: PaperFillData[] = [];
    let historyChanged = false;
    let snapshotSession: SessionRecord | null = session;
    let snapshotGate = getReplayScope()?.trainingGate;
    if (session) {
      if (session.version !== input.expectedPaperVersion || session.lastProcessedSequence !== progress.currentSequence) {
        return { status: 409, error: copy.paperTrading.conflict } as const;
      }
      const statsSession = await ensurePaperTradeStats(session as SessionRecord, tx);
      let account = { ...session, ...statsSession };
      if (getReplayScope()?.mode === "TRAINING") await hydrateTrainingLots(tx, session.id);
      let state = serializePaperSession(statsSession);
      let orders = (await tx.paperOrder.findMany({
        where: { sessionId: account.id, status: "PENDING" }, orderBy: [{ createdSequence: "asc" }, { id: "asc" }],
      })).map(serializePaperOrder);
      let lots = (await tx.paperPositionLot.findMany({ where: { sessionId: account.id }, orderBy: [{ openedSequence: "asc" }, { createdAt: "asc" }, { id: "asc" }] })).map(serializePaperPositionLot);
      let contextIndex = 0;
      for (let offset = 0; offset < dbBars.length && !stopped; offset += REPLAY_CHECKPOINT_STRIDE) {
        const previousLots = lots;
        const bars = dbBars.slice(offset, offset + REPLAY_CHECKPOINT_STRIDE);
        const changed = new Map<string, PaperOrderData>();
        const originals = new Map(orders.map((order) => [order.id, JSON.stringify(order)]));
        const chunkFills: PaperFillData[] = [];
        const entries: ReplayJournalEntryDraft[] = [];
        const equityPoints: PaperEquityPointData[] = [];
        const flat = !prop && canAdvanceFlatAccount(state, orders.length, lots.length);
        let chunkProcessed = 0;
        let lastPoint: PaperEquityPointData | null = null;
        for (const dbBar of bars) {
          if (prop) {
            const day = propTradingDay(dbBar.timestamp, prop.snapshot.calendar);
            if (!day) { prop.state.pause = "BOUNDARY"; stopped = true; break; }
            const prepared = preparePropDay(prop.snapshot.rules, prop.state, day.day);
            prop.state = prepared.state;
            if (prepared.stop) { stopped = true; break; }
          }
          processedBars.push(dbBar); chunkProcessed++;
          if (flat) {
            if (dbBar.sequence === input.targetSequence || dbBar.sequence === dataset.barCount - 1
              || dbBar.sequence % account.equitySampleStride === 0
              || (input.preserveSyncSamples && (dbBar.sequence - progress.currentSequence) % MAX_REPLAY_SYNC_SOURCE_BARS === 0)) {
              state = advanceFlatAccount(state, dbBar.sequence);
              equityPoints.push(flatEquityPoint(state, dbBar.sequence, dbBar.timestamp.toISOString()));
            }
            continue;
          }
          const bar = serializeSourceBar(dbBar);
          while (input.contextRuns?.[contextIndex] && input.contextRuns[contextIndex].toSequence < bar.sequence) contextIndex++;
          const journalContext = input.contextRuns ? input.contextRuns[contextIndex].context : input.journalContext;
          const result = advancePaperTrading({ state, orders, lots, bar,
            makeId: createDeterministicEventIdFactory(state.id, progress.generation, bar.sequence), journalContext });
          state = result.state; lots = result.lots;
          for (const order of result.orders) if (originals.get(order.id) !== JSON.stringify(order)) changed.set(order.id, order);
          orders = result.orders.filter((order) => order.status === "PENDING");
          chunkFills.push(...result.fills); entries.push(...result.journalEntries);
          lastPoint = result.equityPoint;
          if (prop && prop.state.pause === "NONE") {
            const day = propTradingDay(dbBar.timestamp, prop.snapshot.calendar)!;
            prop.state = observeProp(prop.snapshot.rules, prop.state, { sequence: bar.sequence, day: day.day,
              rawNet: state.realizedPnl - state.totalFees, unrealized: result.equityPoint.equity - result.equityPoint.balance,
              flat: state.netQuantity === 0, pending: orders.length, hadFill: result.fills.length > 0 });
            if (day.eod && state.netQuantity === 0) prop.state = settlePropDay(prop.snapshot.rules, prop.state);
            if (prop.state.result || prop.state.pause === "STAGE_WAIT") stopped = true;
          }
          if (result.fills.length || bar.sequence === input.targetSequence || bar.sequence === dataset.barCount - 1
            || bar.sequence % account.equitySampleStride === 0
            || (input.preserveSyncSamples && (bar.sequence - progress.currentSequence) % MAX_REPLAY_SYNC_SOURCE_BARS === 0)) equityPoints.push(result.equityPoint);
          if (stopped) break;
        }
        if (!chunkProcessed) break;
        if (prop && lastPoint && equityPoints.at(-1)?.sequence !== lastPoint.sequence) equityPoints.push(lastPoint);
        if (flat && state.lastProcessedSequence < bars.at(-1)!.sequence) state = advanceFlatAccount(state, bars.at(-1)!.sequence);
        account = await persistDerivedBatch(tx, account, progress.generation, { state, orders: [...changed.values()], fills: chunkFills, lots, entries, equityPoints },
          { previousLots, updateProjection: false });
        fills.push(...chunkFills);
        historyChanged ||= changed.size > 0 || chunkFills.length > 0;
        await persistContextRuns(tx, input.contextRuns
          ? input.contextRuns.filter(run => run.toSequence >= bars[0].sequence && run.fromSequence <= state.lastProcessedSequence)
            .map(run => ({ ...run, fromSequence: Math.max(run.fromSequence, bars[0].sequence), toSequence: Math.min(run.toSequence, state.lastProcessedSequence) }))
          : [{ fromSequence: bars[0].sequence, toSequence: state.lastProcessedSequence, generation: progress.generation, context: input.journalContext ?? null }]);
        if (!prop) await saveReplayCheckpoint(tx, state.lastProcessedSequence);
      }
      snapshotSession = account;
      snapshotGate = state.trainingGate;
    } else if (input.expectedPaperVersion !== null) {
      return { status: 409, error: copy.paperTrading.conflict } as const;
    }

    const actualSequence = processedBars.at(-1)?.sequence ?? (prop ? progress.currentSequence : input.targetSequence);
    if (prop && previousProp) {
      if (actualSequence === dataset.barCount - 1 && !prop.state.result && prop.state.pause === "NONE") prop.state.pause = "DATA_END";
      await persistPropAccount(tx, prop, previousProp);
      previousProp = prop.state;
      await saveReplayCheckpoint(tx, actualSequence, 0, true);
    }

    phases.advance = performance.now() - enteredAt;
    const snapshotStartedAt = performance.now();
    const snapshot = await getPaperSessionSnapshot(datasetId, tx, {
      session: snapshotSession, trainingGate: snapshotGate, trainingLotsHydrated: true,
      currentBar: processedBars.at(-1) ?? (prop && progress.currentSequence >= 0
        ? await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId, sequence: progress.currentSequence } } }) : dbBars.at(-1)),
      includeHistory: input.snapshotMode !== "LIVE" || historyChanged,
    });
    phases.snapshot = performance.now() - snapshotStartedAt;
    const receiptStartedAt = performance.now();
    const syncVersion = progress.syncVersion + 1;
    const response: ReplaySyncSuccess = {
      requestId: input.requestId,
      fromSequence: progress.currentSequence,
      historyVersion: dataset.historyVersion,
      ...(input.displayAdvance ? { displayAdvance: input.displayAdvance } : {}),
      currentSequence: actualSequence,
      ...(prop ? { requestedTargetSequence: input.targetSequence, propStopped: stopped || shouldStopPropReplay(prop.state) } : {}),
      generation: progress.generation,
      syncVersion,
      dataVersion: dataset.dataVersion,
      fills,
      snapshot,
    };
    await tx.replayProgress.update({
      where: { id: progress.id },
      data: { currentSequence: actualSequence, syncVersion, lastSyncRequestId: input.requestId, lastSyncResponse: JSON.stringify(response) },
    });
    await markReplayMutation(tx, actualSequence);
    completedAt = performance.now();
    phases.receipt = completedAt - receiptStartedAt;
    // Internal reuse by the display advance route; API handlers only serialize response.
    return { status: 200, error: null, response, processedBars: prop ? processedBars : dbBars } as const;
  }, { timeout: 120_000 });
  phases.transaction = performance.now() - startedAt;
  phases.wait = enteredAt - startedAt;
  if (completedAt > startedAt) phases.commit = performance.now() - completedAt;
  return { ...outcome, phases };
}
