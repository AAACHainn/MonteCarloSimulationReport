import { validateTrainingDelta } from "@/lib/paper-trading/validate-training-delta";
import { hydrateTrainingLots } from "@/lib/paper-trading/serialize";
import { progressWhere, accountWhere, assertReplayWritable, markReplayMutation, getReplayScope } from '@/lib/replay-sessions/scope';
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeSourceBar } from "@/lib/market-replay/dataset";
import { MAX_REPLAY_SYNC_SOURCE_BARS } from "@/lib/market-replay/types";
import { createDeterministicEventIdFactory } from "@/lib/paper-trading/deterministic-id";
import { advancePaperTrading } from "@/lib/paper-trading/engine";
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
import { paperStateFingerprint } from "@/lib/paper-trading/speculative";
import type { PaperReplayDelta, ReplaySyncReceipt, ReplaySyncRequest } from "@/lib/market-replay/client-sync";
import type { PaperSessionState } from "@/lib/paper-trading/types";


import { marketVersionMatches } from "./history-version";

export type ReplaySyncInput = {
  historyVersion?: number;
  generation: number;
  requestId: string;
  confirmedSequence: number;
  syncVersion: number;
  expectedPaperVersion: number | null;
  targetSequence: number;
  journalContext?: PaperJournalContext | null;
};

export type ReplaySyncSuccess = {
  requestId: string;
  currentSequence: number;
  generation: number;
  syncVersion: number;
  dataVersion: number;
  fills: PaperFillData[];
  snapshot: Awaited<ReturnType<typeof getPaperSessionSnapshot>>;
};

export type ReplaySyncOutcome =
  | { status: 200; error: null; response: ReplaySyncSuccess }
  | { status: 400 | 404 | 409; error: string; code?: string; response?: never };

const ACCOUNTING_EPSILON = 1e-8;

function closeEnough(actual: number | null, expected: number | null) {
  if (actual === null || expected === null) return actual === expected;
  return Math.abs(actual - expected) <= ACCOUNTING_EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected));
}

function activeOrdersMatch(expected: PaperOrderData[], received: PaperOrderData[]) {
  if (expected.length !== received.length) return false;
  const receivedById = new Map(received.map((order) => [order.id, order]));
  return expected.every((order) => {
    const candidate = receivedById.get(order.id);
    return candidate !== undefined
      && order.status === "PENDING" && candidate.status === "PENDING"
      && order.side === candidate.side && order.type === candidate.type
      && closeEnough(order.quantity, candidate.quantity)
      && closeEnough(order.price, candidate.price)
      && closeEnough(order.stopLoss, candidate.stopLoss)
      && closeEnough(order.takeProfit, candidate.takeProfit)
      && order.reduceOnly === candidate.reduceOnly
      && order.isProtective === candidate.isProtective
      && order.ocoGroupId === candidate.ocoGroupId
      && order.createdSequence === candidate.createdSequence
      && order.activeFromSequence === candidate.activeFromSequence;
  });
}

function validateFillAccounting(start: PaperSessionState, delta: PaperReplayDelta) {
  let quantity = start.netQuantity;
  let average = start.averageEntryPrice;
  let realized = start.realizedPnl;
  let fees = start.totalFees;
  let slippage = start.totalSlippage;
  let cycleKey = start.activeCycleKey ?? null;
  let previousSequence = delta.state.lastProcessedSequence - (delta.state.version - start.version);
  for (const fill of delta.fills) {
    if (fill.sequence < previousSequence || fill.sequence > delta.state.lastProcessedSequence) return false;
    previousSequence = fill.sequence;
    const signed = fill.side === "BUY" ? fill.quantity : -fill.quantity;
    const oldSign = Math.sign(quantity);
    const signedSign = Math.sign(signed);
    const nextQuantity = Math.abs(quantity + signed) <= 1e-12 ? 0 : quantity + signed;
    const fillCycle = oldSign === 0 ? fill.id : cycleKey ?? `legacy-cycle:${start.id}`;
    if (fill.cycleKey !== undefined && fill.cycleKey !== fillCycle) return false;
    cycleKey = nextQuantity === 0 ? null : fillCycle;
    const closedQuantity = oldSign !== 0 && oldSign !== signedSign ? Math.min(Math.abs(quantity), fill.quantity) : 0;
    const openedQuantity = oldSign === 0 || oldSign === signedSign
      ? fill.quantity
      : Math.max(0, fill.quantity - closedQuantity);
    const fillRealized = closedQuantity > 0 ? (fill.price - Number(average)) * closedQuantity * oldSign : 0;
    let nextAverage = average;
    if (oldSign === 0 || oldSign === signedSign) {
      nextAverage = Math.abs(quantity) <= 1e-12
        ? fill.price
        : (Number(average) * Math.abs(quantity) + fill.price * fill.quantity) / (Math.abs(quantity) + fill.quantity);
    } else if (nextQuantity === 0) nextAverage = null;
    else if (Math.sign(nextQuantity) !== oldSign) nextAverage = fill.price;
    const fee = Math.abs(fill.price * fill.quantity) * start.commissionBps / 10_000;
    if (
      !closeEnough(fill.netQuantityAfter, nextQuantity)
      || !closeEnough(fill.averagePriceAfter, nextAverage)
      || !closeEnough(fill.closedQuantity, closedQuantity)
      || !closeEnough(fill.openedQuantity, openedQuantity)
      || !closeEnough(fill.realizedPnl, fillRealized)
      || !closeEnough(fill.fee, fee)
    ) return false;
    quantity = nextQuantity;
    average = nextAverage;
    realized += fillRealized;
    fees += fee;
    slippage += fill.slippageCost;
  }
  return closeEnough(delta.state.netQuantity, quantity)
    && (delta.state.activeCycleKey === undefined || delta.state.activeCycleKey === cycleKey)
    && closeEnough(delta.state.averageEntryPrice, average)
    && closeEnough(delta.state.realizedPnl, realized)
    && closeEnough(delta.state.totalFees, fees)
    && closeEnough(delta.state.totalSlippage, slippage);
}

function validateClientPaperDelta(
  datasetId: string,
  generation: number,
  confirmedSequence: number,
  targetSequence: number,
  session: PaperSessionState,
  currentOrders: PaperOrderData[],
  delta: PaperReplayDelta,
) {
  const state = delta.state;
  if (
    state.id !== session.id || state.datasetId !== datasetId
    || state.initialCapital !== session.initialCapital || state.currency !== session.currency
    || state.commissionBps !== session.commissionBps || state.slippageBps !== session.slippageBps
    || state.lastProcessedSequence !== targetSequence
    || state.version !== session.version + targetSequence - confirmedSequence
    || (Math.abs(state.netQuantity) <= 1e-12) !== (state.averageEntryPrice === null)
    || state.totalFees < session.totalFees || state.totalSlippage < session.totalSlippage
    || state.peakEquity < session.peakEquity || state.maxDrawdown < session.maxDrawdown
    || paperStateFingerprint(state, delta.activeOrders, delta.openLots) !== delta.fingerprint
  ) return false;
  const currentOrderIds = new Set(currentOrders.map((order) => order.id));
  const changedIds = new Set<string>();
  for (const order of delta.orderChanges) {
    if (
      changedIds.has(order.id) || order.activeFromSequence < order.createdSequence
      || (!currentOrderIds.has(order.id) && !order.id.startsWith(`replay_${session.id}_${generation}_`))
      || (order.status === "FILLED" && (order.filledSequence === null || order.filledAt === null || order.filledPrice === null))
      || (order.status !== "FILLED" && order.filledSequence !== null)
    ) return false;
    changedIds.add(order.id);
    if (order.filledSequence !== null && (order.filledSequence <= confirmedSequence || order.filledSequence > targetSequence)) return false;
  }
  const finalOrders = new Map(currentOrders.map((order) => [order.id, order]));
  for (const order of delta.orderChanges) finalOrders.set(order.id, order);
  const expectedActive = [...finalOrders.values()].filter((order) => order.status === "PENDING")
    .sort((a, b) => a.id.localeCompare(b.id));
  const receivedActive = [...delta.activeOrders].sort((a, b) => a.id.localeCompare(b.id));
  if (!activeOrdersMatch(expectedActive, receivedActive)) return false;
  const fillIds = new Set<string>();
  for (const fill of delta.fills) {
    if (
      fillIds.has(fill.id) || fill.sequence <= confirmedSequence || fill.sequence > targetSequence
      || !finalOrders.has(fill.orderId)
      || !fill.id.startsWith(`replay_${session.id}_${generation}_${fill.sequence}_`)
    ) return false;
    fillIds.add(fill.id);
  }
  const equitySequences = new Set<number>();
  for (const point of delta.equityPoints) {
    if (equitySequences.has(point.sequence) || point.sequence <= confirmedSequence || point.sequence > targetSequence) return false;
    equitySequences.add(point.sequence);
  }
  const lotIds = new Set<string>();
  for (const lot of delta.openLots) {
    if (lotIds.has(lot.id) || lot.openedSequence > targetSequence || lot.remainingQuantity > lot.initialQuantity) return false;
    lotIds.add(lot.id);
  }
  const journalIds = new Set<string>();
  for (const entry of delta.journalEntries) {
    if (journalIds.has(entry.id) || entry.closedSequence <= confirmedSequence || entry.closedSequence > targetSequence
      || entry.openedSequence > entry.closedSequence) return false;
    journalIds.add(entry.id);
  }
  return validateFillAccounting(session, delta);
}

export async function persistClientReplayBatch(
  datasetId: string,
  input: ReplaySyncRequest,
): Promise<{ status: 200; error: null; response: ReplaySyncReceipt } | { status: 400 | 404 | 409; error: string; code?: string }> {
  return prisma.$transaction(async (tx) => {
    await assertReplayWritable(tx);
    const [dataset, progress, sessionRecord] = await Promise.all([
      tx.marketDataset.findUnique({ where: { id: datasetId } }),
      tx.replayProgress.findFirst({ where: progressWhere(datasetId) }),
      tx.paperTradingSession.findFirst({ where: accountWhere(datasetId) }),
    ]);
    if (!dataset || !progress) return { status: 404, error: copy.marketReplay.datasetNotFound } as const;
    if (progress.lastSyncRequestId === input.requestId && progress.lastSyncResponse) {
      return { status: 200, error: null, response: JSON.parse(progress.lastSyncResponse) as ReplaySyncReceipt } as const;
    }
    if (input.historyVersion !== undefined && input.historyVersion !== dataset.historyVersion) return { status: 409, error: copy.marketSync.historyChanged, code: "HISTORY_CHANGED" } as const;
    if (
      !marketVersionMatches(dataset, input)
      || progress.generation !== input.generation
      || progress.syncVersion !== input.syncVersion || progress.currentSequence !== input.confirmedSequence
    ) return { status: 409, error: copy.paperTrading.conflict } as const;
    if (
      input.targetSequence <= progress.currentSequence || input.targetSequence >= dataset.barCount
      || input.targetSequence - progress.currentSequence > MAX_REPLAY_SYNC_SOURCE_BARS
    ) return { status: 400, error: copy.marketReplay.validation.progressOutOfRange } as const;

    let paperVersion: number | null = null;
    let fingerprint = "no-paper-session";
    if (sessionRecord) {
      if (!input.paperDelta || sessionRecord.version !== input.expectedPaperVersion
        || sessionRecord.lastProcessedSequence !== progress.currentSequence) {
        return { status: 409, error: copy.paperTrading.conflict } as const;
      }
      const statsSession = await ensurePaperTradeStats(sessionRecord as SessionRecord, tx);
      const session = serializePaperSession(statsSession);
      const currentOrders = (await tx.paperOrder.findMany({ where: { sessionId: sessionRecord.id, status: "PENDING" } }))
        .map(serializePaperOrder);
      if (!validateClientPaperDelta(datasetId, progress.generation, progress.currentSequence,
        input.targetSequence, session, currentOrders, input.paperDelta)) {
        return { status: 400, error: copy.marketReplay.syncMismatch } as const;
      }
      const delta = input.paperDelta;
      if (getReplayScope() && !validContextRuns(delta.contextRuns ?? [], progress.currentSequence + 1, input.targetSequence, progress.generation)) {
        return { status: 400, error: copy.marketReplay.syncMismatch } as const;
      }
      if (getReplayScope()?.mode === "TRAINING" && !await validateTrainingDelta(tx, sessionRecord.id, progress.generation, session, currentOrders, delta)) {
        return { status: 400, error: copy.marketReplay.syncMismatch } as const;
      }
      await persistDerivedBatch(tx, { ...sessionRecord, ...statsSession }, progress.generation, {
        state: delta.state, orders: delta.orderChanges, fills: delta.fills, lots: delta.openLots,
        entries: delta.journalEntries, equityPoints: delta.equityPoints,
      });
      await persistContextRuns(tx, delta.contextRuns ?? []);
      await saveReplayCheckpoint(tx, input.targetSequence);
      paperVersion = delta.state.version;
      fingerprint = delta.fingerprint;
    } else if (input.expectedPaperVersion !== null || input.paperDelta !== null) {
      return { status: 409, error: copy.paperTrading.conflict } as const;
    }

    const response: ReplaySyncReceipt = {
      requestId: input.requestId, currentSequence: input.targetSequence, generation: progress.generation,
      syncVersion: progress.syncVersion + 1, dataVersion: dataset.dataVersion, historyVersion: dataset.historyVersion, paperVersion, fingerprint,
    };
    await tx.replayProgress.update({
      where: { id: progress.id },
      data: {
        currentSequence: input.targetSequence, syncVersion: response.syncVersion,
        lastSyncRequestId: input.requestId, lastSyncResponse: JSON.stringify(response),
      },
    });
    await markReplayMutation(tx, input.targetSequence);
    return { status: 200, error: null, response } as const;
  }, { timeout: 120_000 });
}

export async function syncReplayToTarget(
  datasetId: string,
  input: ReplaySyncInput,
  maximumSourceBars = MAX_REPLAY_SYNC_SOURCE_BARS,
): Promise<ReplaySyncOutcome> {
  const outcome = await prisma.$transaction(async (tx) => {
    await assertReplayWritable(tx);
    const [dataset, progress, session] = await Promise.all([
      tx.marketDataset.findUnique({ where: { id: datasetId } }),
      tx.replayProgress.findFirst({ where: progressWhere(datasetId) }),
      tx.paperTradingSession.findFirst({ where: accountWhere(datasetId) }),
    ]);
    if (!dataset || !progress) return { status: 404, error: copy.marketReplay.datasetNotFound } as const;
    if (progress.lastSyncRequestId === input.requestId && progress.lastSyncResponse) {
      return { status: 200, error: null, response: JSON.parse(progress.lastSyncResponse) as ReplaySyncSuccess } as const;
    }
    if (input.historyVersion !== undefined && input.historyVersion !== dataset.historyVersion) return { status: 409, error: copy.marketSync.historyChanged, code: "HISTORY_CHANGED" } as const;
    if (
      progress.generation !== input.generation
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
    const dbBars = await tx.marketBar.findMany({
      where: { datasetId, sequence: { gt: progress.currentSequence, lte: input.targetSequence } },
      orderBy: { sequence: "asc" },
    });
    if (dbBars.length !== input.targetSequence - progress.currentSequence) {
      return { status: 404, error: copy.marketReplay.loadError } as const;
    }

    const fills: PaperFillData[] = [];
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
      let lots = (await tx.paperPositionLot.findMany({ where: { sessionId: account.id } })).map(serializePaperPositionLot);
      for (let offset = 0; offset < dbBars.length; offset += REPLAY_CHECKPOINT_STRIDE) {
        const bars = dbBars.slice(offset, offset + REPLAY_CHECKPOINT_STRIDE);
        const changed = new Map<string, PaperOrderData>();
        const originals = new Map(orders.map((order) => [order.id, JSON.stringify(order)]));
        const chunkFills: PaperFillData[] = [];
        const entries: ReplayJournalEntryDraft[] = [];
        const equityPoints: PaperEquityPointData[] = [];
        for (const dbBar of bars) {
          const bar = serializeSourceBar(dbBar);
          const result = advancePaperTrading({ state, orders, lots, bar,
            makeId: createDeterministicEventIdFactory(state.id, progress.generation, bar.sequence), journalContext: input.journalContext });
          state = result.state; lots = result.lots;
          for (const order of result.orders) if (originals.get(order.id) !== JSON.stringify(order)) changed.set(order.id, order);
          orders = result.orders.filter((order) => order.status === "PENDING");
          chunkFills.push(...result.fills); entries.push(...result.journalEntries);
          if (result.fills.length || bar.sequence === dataset.barCount - 1 || bar.sequence % account.equitySampleStride === 0) equityPoints.push(result.equityPoint);
        }
        account = await persistDerivedBatch(tx, account, progress.generation, { state, orders: [...changed.values()], fills: chunkFills, lots, entries, equityPoints });
        fills.push(...chunkFills);
        await persistContextRuns(tx, [{ fromSequence: bars[0].sequence, toSequence: state.lastProcessedSequence, generation: progress.generation, context: input.journalContext ?? null }]);
        await saveReplayCheckpoint(tx, state.lastProcessedSequence);
      }
    } else if (input.expectedPaperVersion !== null) {
      return { status: 409, error: copy.paperTrading.conflict } as const;
    }

    const syncVersion = progress.syncVersion + 1;
    await tx.replayProgress.update({
      where: { id: progress.id },
      data: { currentSequence: input.targetSequence, syncVersion, lastSyncRequestId: input.requestId },
    });
    const response: ReplaySyncSuccess = {
      requestId: input.requestId,
      currentSequence: input.targetSequence,
      generation: progress.generation,
      syncVersion,
      dataVersion: dataset.dataVersion,
      fills,
      snapshot: await getPaperSessionSnapshot(datasetId, tx),
    };
    await tx.replayProgress.update({
      where: { id: progress.id },
      data: { lastSyncResponse: JSON.stringify(response) },
    });
    await markReplayMutation(tx, input.targetSequence);
    return { status: 200, error: null, response } as const;
  }, { timeout: 120_000 });
  return outcome;
}
