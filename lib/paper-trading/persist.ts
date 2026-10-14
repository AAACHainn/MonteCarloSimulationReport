import type { Prisma } from "@prisma/client";
import { storageId, getReplayScope } from "@/lib/replay-sessions/scope";
import type { PaperOrderData, PaperFillData } from "./types";
import { derivePaperTradeTransitions } from "./reducers";
import { recordClosedTrade, type IncrementalTradeStats } from "./trade-stats";

export function orderCreateData(sessionId: string, order: PaperOrderData) {
  return {
    discipline: order.discipline ? JSON.stringify(order.discipline) : null,
    id: storageId(order.id), sessionId, side: order.side, type: order.type, status: order.status,
    quantity: order.quantity, riskAmount: order.riskAmount, price: order.price,
    stopLoss: order.stopLoss, takeProfit: order.takeProfit, reduceOnly: order.reduceOnly,
    isProtective: order.isProtective, ocoGroupId: order.ocoGroupId, parentOrderId: order.parentOrderId,
    createdSequence: order.createdSequence, activeFromSequence: order.activeFromSequence,
    filledSequence: order.filledSequence, filledAt: order.filledAt ? new Date(order.filledAt) : null,
    filledPrice: order.filledPrice, cancelReason: order.cancelReason,
    ...(order.createdAt ? { createdAt: new Date(order.createdAt) } : {}),
  };
}

export async function persistTrades(
  tx: Prisma.TransactionClient,
  sessionId: string,
  orders: PaperOrderData[],
  fills: PaperFillData[],
  initialStats: IncrementalTradeStats,
) {
  let stats = initialStats;
  let activeTrade = fills.length
    ? await tx.paperTrade.findFirst({ where: { sessionId, status: "OPEN" } })
    : null;
  for (const transition of derivePaperTradeTransitions(orders, fills)) {
    const fill = transition.fill;
    if (transition.kind === "ENTRY") {
      activeTrade = await tx.paperTrade.create({
        data: { ...(getReplayScope() ? { id: storageId(`speculative_${fill.id}`) } : {}), sessionId, side: fill.netQuantityAfter > 0 ? "LONG" : "SHORT", openedSequence: fill.sequence, openedAt: new Date(fill.timestamp), fees: fill.fee, plannedRisk: transition.plannedRisk },
      });
    } else if (transition.kind === "ADD" && activeTrade) {
      activeTrade = await tx.paperTrade.update({
        where: { id: activeTrade.id },
        data: { fees: { increment: fill.fee }, plannedRisk: transition.plannedRisk == null ? undefined : { increment: transition.plannedRisk } },
      });
    } else if (transition.kind === "REDUCE" && activeTrade) {
      activeTrade = await tx.paperTrade.update({
        where: { id: activeTrade.id },
        data: { grossPnl: { increment: fill.realizedPnl }, fees: { increment: fill.fee } },
      });
    } else if ((transition.kind === "CLOSE" || transition.kind === "STOP_LOSS" || transition.kind === "TAKE_PROFIT") && activeTrade) {
      const closed = await tx.paperTrade.update({
        where: { id: activeTrade.id },
        data: { status: "CLOSED", grossPnl: { increment: fill.realizedPnl }, fees: { increment: fill.fee }, closedSequence: fill.sequence, closedAt: new Date(fill.timestamp) },
      });
      stats = recordClosedTrade(stats, closed.grossPnl - closed.fees);
      activeTrade = null;
    } else if (transition.kind === "REVERSE") {
      const closingFee = transition.closingFee;
      if (activeTrade) {
        const closed = await tx.paperTrade.update({
          where: { id: activeTrade.id },
          data: { status: "CLOSED", grossPnl: { increment: fill.realizedPnl }, fees: { increment: closingFee }, closedSequence: fill.sequence, closedAt: new Date(fill.timestamp) },
        });
        stats = recordClosedTrade(stats, closed.grossPnl - closed.fees);
      }
      activeTrade = await tx.paperTrade.create({
        data: { ...(getReplayScope() ? { id: storageId(`speculative_${fill.id}`) } : {}), sessionId, side: fill.netQuantityAfter > 0 ? "LONG" : "SHORT", openedSequence: fill.sequence, openedAt: new Date(fill.timestamp), fees: fill.fee - closingFee, plannedRisk: transition.plannedRisk },
      });
    }
  }
  return stats;
}

