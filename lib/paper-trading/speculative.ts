import type { PaperAdvanceResult, PaperOrderData, PaperSessionSnapshot, PaperSessionState } from "./types";
import { applyLiveAccountStats, derivePaperTradeTransitions, reduceRecentPaperTrades } from "./reducers";

function pendingOrders(orders: PaperOrderData[]) {
  return orders.filter((order) => order.status === "PENDING");
}

export function applySpeculativeAdvance(snapshot: PaperSessionSnapshot, result: PaperAdvanceResult): PaperSessionSnapshot {
  const activeOrders = pendingOrders(result.orders);
  const recentOrderMap = new Map(snapshot.recentOrders.map((order) => [order.id, order]));
  for (const order of result.orders) recentOrderMap.set(order.id, order);
  const recentOrders = [...recentOrderMap.values()]
    .sort((a, b) => b.createdSequence - a.createdSequence || b.id.localeCompare(a.id))
    .slice(0, 50);
  const recentFills = [...result.fills].reverse().concat(snapshot.recentFills).slice(0, 50);
  const balance = result.equityPoint.balance;
  const equity = result.equityPoint.equity;
  const transitions = derivePaperTradeTransitions(result.orders, result.fills);
  const sessionSnapshot = { session: result.state };
  return {
    ...snapshot,
    session: result.state,
    activeOrders,
    recentOrders,
    recentFills,
    recentTrades: reduceRecentPaperTrades(snapshot.recentTrades, transitions),
    stats: applyLiveAccountStats(snapshot.stats, sessionSnapshot, balance, equity),
  };
}

export function paperStateFingerprint(session: PaperSessionState, activeOrders: PaperOrderData[]) {
  const state = {
    lastProcessedSequence: session.lastProcessedSequence,
    netQuantity: session.netQuantity,
    averageEntryPrice: session.averageEntryPrice,
    realizedPnl: session.realizedPnl,
    totalFees: session.totalFees,
    totalSlippage: session.totalSlippage,
    peakEquity: session.peakEquity,
    maxDrawdown: session.maxDrawdown,
    version: session.version,
    orders: [...activeOrders].sort((a, b) => a.id.localeCompare(b.id)).map((order) => ({
      id: order.id,
      status: order.status,
      quantity: order.quantity,
      price: order.price,
      activeFromSequence: order.activeFromSequence,
      filledSequence: order.filledSequence,
      filledPrice: order.filledPrice,
      cancelReason: order.cancelReason,
    })),
  };
  return JSON.stringify(state);
}

export function paperCheckpointFingerprint(snapshot: PaperSessionSnapshot | null) {
  return snapshot ? paperStateFingerprint(snapshot.session, snapshot.activeOrders) : "no-paper-session";
}
