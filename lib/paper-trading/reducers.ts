import type {
  PaperFillData,
  PaperOrderData,
  PaperSessionSnapshot,
  PaperTradeData,
  PaperTradingStats,
} from "./types";

export type PaperTradeTransition = {
  kind: PaperFillData["reason"];
  fill: PaperFillData;
  plannedRisk: number | null;
  closingFee: number;
};

export function derivePaperTradeTransitions(orders: PaperOrderData[], fills: PaperFillData[]): PaperTradeTransition[] {
  return fills.map((fill) => {
    const parent = orders.find((order) => order.id === fill.orderId);
    const plannedRisk = parent?.riskAmount != null && fill.quantity > 0
      ? parent.riskAmount * fill.openedQuantity / fill.quantity
      : parent?.stopLoss == null ? null : Math.abs(fill.price - parent.stopLoss) * fill.openedQuantity;
    return {
      kind: fill.reason,
      fill,
      plannedRisk,
      closingFee: fill.quantity ? fill.fee * fill.closedQuantity / fill.quantity : 0,
    };
  });
}

export function reduceRecentPaperTrades(
  recentTrades: PaperTradeData[],
  transitions: PaperTradeTransition[],
): PaperTradeData[] {
  const trades = recentTrades.map((trade) => ({ ...trade }));
  let active = trades.find((trade) => trade.status === "OPEN") ?? null;
  const open = (transition: PaperTradeTransition, fee: number) => {
    const trade: PaperTradeData = {
      id: `speculative_${transition.fill.id}`,
      side: transition.fill.netQuantityAfter > 0 ? "LONG" : "SHORT",
      status: "OPEN",
      openedSequence: transition.fill.sequence,
      openedAt: transition.fill.timestamp,
      closedSequence: null,
      closedAt: null,
      grossPnl: 0,
      fees: fee,
      plannedRisk: transition.plannedRisk,
    };
    trades.unshift(trade);
    return trade;
  };
  const close = (transition: PaperTradeTransition, fee: number) => {
    if (!active) return;
    active.status = "CLOSED";
    active.grossPnl += transition.fill.realizedPnl;
    active.fees += fee;
    active.closedSequence = transition.fill.sequence;
    active.closedAt = transition.fill.timestamp;
    active = null;
  };
  for (const transition of transitions) {
    if (transition.kind === "ENTRY") {
      active = open(transition, transition.fill.fee);
    } else if (transition.kind === "ADD" && active) {
      active.fees += transition.fill.fee;
      if (transition.plannedRisk !== null) active.plannedRisk = (active.plannedRisk ?? 0) + transition.plannedRisk;
    } else if (transition.kind === "REDUCE" && active) {
      active.grossPnl += transition.fill.realizedPnl;
      active.fees += transition.fill.fee;
    } else if (transition.kind === "CLOSE" || transition.kind === "STOP_LOSS" || transition.kind === "TAKE_PROFIT") {
      close(transition, transition.fill.fee);
    } else if (transition.kind === "REVERSE") {
      close(transition, transition.closingFee);
      active = open(transition, transition.fill.fee - transition.closingFee);
    }
  }
  return trades.slice(0, 50);
}

export function applyLiveAccountStats(
  stats: PaperTradingStats,
  snapshot: Pick<PaperSessionSnapshot, "session">,
  balance: number,
  equity: number,
): PaperTradingStats {
  return {
    ...stats,
    balance,
    equity,
    unrealizedPnl: equity - balance,
    netPnl: equity - snapshot.session.initialCapital,
    maxDrawdown: snapshot.session.maxDrawdown,
    totalFees: snapshot.session.totalFees,
    totalSlippage: snapshot.session.totalSlippage,
  };
}
