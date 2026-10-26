import { setAccountCashAdjustment } from "@/lib/paper-trading/account-cash";
import type { Prisma, PaperTradingSession, ReplayCommand } from "@prisma/client";
import { copy } from "@/lib/i18n";
import { ReplaySessionError, getReplayScope, storageId } from "./scope";
import { orderCreateData } from "@/lib/paper-trading/persist";
import { isValidBracket } from "@/lib/paper-trading/risk-sizing";
import type { PaperOrderData, PaperAccountConfig } from "@/lib/paper-trading/types";
import { saveReplayCheckpoint } from "./checkpoint";
import { executeCurrentPriceClose } from "@/lib/paper-trading/current-price-close";
import { serializeSourceBar } from "@/lib/market-replay/dataset";

export type RecordedPayload = PaperAccountConfig & { cashAdjustment?: number; logicalAccountId?: string; equitySampleStride?: number; order?: PaperOrderData; orderIds?: string[]; executeAtCurrentClose?: boolean; generation?: number };
export async function applyRecordedCommand(tx: Prisma.TransactionClient, command: ReplayCommand, account: PaperTradingSession | null, referencePrice: number | null) {
  const scope = getReplayScope()!;
  const payload = JSON.parse(command.payload) as RecordedPayload;
  const conflict = (id = "") => new ReplaySessionError("CORRECTION_CONFLICT", 409, copy.replaySessions.correctionConflict(command.sourceSequence, id));
  if (command.type === "ACCOUNT_INIT") {
    if (account) throw conflict();
    const journal = await tx.replayJournalSession.findUnique({ where: { replaySessionId: scope.id } });
    if (!journal) throw new ReplaySessionError("HISTORY_MISSING", 409, copy.replaySessions.correctionHistoryMissing);
    account = await tx.paperTradingSession.create({ data: {
      id: storageId(payload.logicalAccountId ?? `account_${scope.id}`), projectionId: scope.projectionId, journalSessionId: journal.id,
      datasetId: scope.datasetId, initialCapital: payload.initialCapital, currency: payload.currency,
      commissionBps: payload.commissionBps, slippageBps: payload.slippageBps,
      lastProcessedSequence: command.sourceSequence, peakEquity: payload.initialCapital,
      equitySampleStride: payload.equitySampleStride ?? 1,
    } });
  } else {
    if (!account || account.lastProcessedSequence !== command.sourceSequence) throw conflict();
    if (command.type === "ORDER_CREATE") {
      const order = payload.order;
      if (!order || order.status !== "PENDING") throw conflict(order?.id);
      await tx.paperOrder.create({ data: orderCreateData(account.id, order) });
      if (payload.executeAtCurrentClose) {
        const bar = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: account.datasetId, sequence: command.sourceSequence } } });
        if (!bar || payload.generation === undefined) throw conflict(order.id);
        account = await executeCurrentPriceClose(tx, account, payload.generation, serializeSourceBar(bar), order.id);
      }
    } else if (command.type === "CASH_TRANSFER") {
      if (scope.mode !== "TRAINING" || account.netQuantity !== 0 || !Number.isFinite(payload.cashAdjustment) || await tx.paperOrder.count({ where: { sessionId: account.id, status: "PENDING" } })) throw conflict();
      account = await setAccountCashAdjustment(tx, account, payload.cashAdjustment!);
    } else if (command.type === "ORDER_UPDATE") {
      const order = payload.order;
      if (!order) throw conflict();
      const existing = await tx.paperOrder.findFirst({ where: { id: storageId(order.id), sessionId: account.id, status: "PENDING" } });
      if (!existing || referencePrice === null) throw conflict(order.id);
      if (existing.isProtective) {
        const long = account.netQuantity > 0;
        const valid = account.netQuantity !== 0 && order.price !== null && (existing.type === "STOP"
          ? long ? order.price < referencePrice : order.price > referencePrice
          : long ? order.price > referencePrice : order.price < referencePrice);
        if (!valid) throw conflict(order.id);
      } else if (!isValidBracket(order.side, order.price ?? referencePrice, order.stopLoss, order.takeProfit)) throw conflict(order.id);
      await tx.paperOrder.update({ where: { id: existing.id }, data: {
        quantity: order.quantity, riskAmount: order.riskAmount, price: order.price,
        stopLoss: order.stopLoss, takeProfit: order.takeProfit, activeFromSequence: order.activeFromSequence,
      } });
    } else if (command.type === "ORDER_CANCEL") {
      const ids = payload.orderIds ?? [];
      const updated = await tx.paperOrder.updateMany({ where: { sessionId: account.id, id: { in: ids.map(storageId) }, status: "PENDING" }, data: { status: "CANCELLED", cancelReason: "USER_CANCELLED" } });
      if (updated.count !== ids.length) throw conflict(ids[0]);
    } else throw new ReplaySessionError("HISTORY_MISSING", 409, copy.replaySessions.correctionHistoryMissing);
    if (command.type !== "CASH_TRANSFER" && !(command.type === "ORDER_CREATE" && payload.executeAtCurrentClose)) {
      account = await tx.paperTradingSession.update({ where: { id: account.id }, data: { version: { increment: 1 } } });
    }
  }
  await tx.replayProjectionCommand.create({ data: { projectionId: scope.projectionId, commandId: command.id } });
  await saveReplayCheckpoint(tx, command.sourceSequence, command.ordinal, true);
  return account;
}
