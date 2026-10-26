import type { Prisma, PaperTradingSession } from "@prisma/client";
import { getReplayScope, storageId } from "./scope";
import { projectionRecordId } from "./identity";
import type { PaperSessionState, PaperOrderData, PaperFillData, PaperPositionLotData, ReplayJournalEntryDraft, PaperEquityPointData } from "@/lib/paper-trading/types";
import { orderCreateData, persistTrades } from "@/lib/paper-trading/persist";
import { ensureReplayJournalSession, persistPaperJournalState } from "@/lib/paper-trading/journal-storage";
import { tradeStatsFromSession } from "@/lib/paper-trading/serialize";

export function paperStateUpdate(state: PaperSessionState) {
  return {
    cashAdjustment: state.cashAdjustment ?? 0,
    lastProcessedSequence: state.lastProcessedSequence, netQuantity: state.netQuantity, activeCycleKey: state.activeCycleKey ?? null,
    averageEntryPrice: state.averageEntryPrice, realizedPnl: state.realizedPnl,
    totalFees: state.totalFees, totalSlippage: state.totalSlippage,
    peakEquity: state.peakEquity, maxDrawdown: state.maxDrawdown, version: state.version,
  };
}
export type DerivedBatch = {
  state: PaperSessionState;
  orders: PaperOrderData[];
  fills: PaperFillData[];
  lots: PaperPositionLotData[];
  entries: ReplayJournalEntryDraft[];
  equityPoints: PaperEquityPointData[];
};
export async function persistDerivedBatch(tx: Prisma.TransactionClient, account: PaperTradingSession, generation: number, batch: DerivedBatch,
  options: { previousLots?: PaperPositionLotData[]; updateProjection?: boolean } = {}) {
  const scope = getReplayScope();
  const owner = scope && batch.orders.some(order => !order.createdAt)
    ? await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id }, select: { activeProjectionId: true } }) : null;
  if (scope?.mode === "TRAINING" && batch.state.trainingGate
    && JSON.stringify(batch.state.trainingGate) !== JSON.stringify(scope.trainingGate)) {
    await tx.replaySession.update({ where: { id: scope.id }, data: { trainingGate: JSON.stringify(batch.state.trainingGate) } });
  }
  for (const order of batch.orders) {
    const create = orderCreateData(account.id, order);
    if (!create.createdAt && owner?.activeProjectionId && owner.activeProjectionId !== scope?.projectionId) {
      const original = await tx.paperOrder.findUnique({ where: { id: projectionRecordId(owner.activeProjectionId, order.id) }, select: { createdAt: true } });
      if (original) create.createdAt = original.createdAt;
    }
    const { id: _id, sessionId: _sessionId, ...update } = create;
    void _id; void _sessionId;
    await tx.paperOrder.upsert({ where: { id: storageId(order.id) }, create, update });
  }
  if (batch.fills.length) await tx.paperFill.createMany({ data: batch.fills.map((fill) => ({
    ...fill, id: storageId(fill.id), orderId: storageId(fill.orderId), cycleKey: fill.cycleKey ?? null,
    sessionId: account.id, timestamp: new Date(fill.timestamp),
  })) });
  const stats = await persistTrades(tx, account.id, batch.orders, batch.fills, tradeStatsFromSession(account));
  const journalId = await ensureReplayJournalSession(tx, account, generation);
  const lotsChanged = options.previousLots === undefined || JSON.stringify(options.previousLots) !== JSON.stringify(batch.lots);
  await persistPaperJournalState(tx, account.datasetId, account.id, journalId, batch.lots, batch.entries, { persistLots: lotsChanged });
  if (batch.equityPoints.length) await tx.paperEquityPoint.createMany({ data: batch.equityPoints.map((point) => ({
    ...point, sessionId: account.id, timestamp: new Date(point.timestamp),
  })) });
  const updated = await tx.paperTradingSession.update({ where: { id: account.id }, data: {
    ...paperStateUpdate(batch.state), ...stats, tradeStatsVersion: 1, journalSessionId: journalId,
  } });
  if (scope && options.updateProjection !== false) await tx.replayProjection.update({ where: { id: scope.projectionId }, data: { currentSequence: batch.state.lastProcessedSequence } });
  return updated;
}
