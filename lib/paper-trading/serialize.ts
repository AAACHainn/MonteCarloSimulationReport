import { prisma } from "@/lib/db";
import type {
  PaperFillData,
  PaperFillReason,
  PaperOrderData,
  PaperOrderStatus,
  PaperOrderType,
  PaperSessionSnapshot,
  PaperSessionState,
  PaperSide,
  PaperTradeData,
  PaperTradingStats,
} from "./types";

type SessionRecord = {
  id: string; datasetId: string; initialCapital: number; currency: string;
  commissionBps: number; slippageBps: number; lastProcessedSequence: number;
  netQuantity: number; averageEntryPrice: number | null; realizedPnl: number;
  totalFees: number; totalSlippage: number; peakEquity: number; maxDrawdown: number; version: number;
};

export function serializePaperSession(session: SessionRecord): PaperSessionState {
  return {
    id: session.id, datasetId: session.datasetId, initialCapital: session.initialCapital,
    currency: session.currency, commissionBps: session.commissionBps, slippageBps: session.slippageBps,
    lastProcessedSequence: session.lastProcessedSequence, netQuantity: session.netQuantity,
    averageEntryPrice: session.averageEntryPrice, realizedPnl: session.realizedPnl,
    totalFees: session.totalFees, totalSlippage: session.totalSlippage,
    peakEquity: session.peakEquity, maxDrawdown: session.maxDrawdown, version: session.version,
  };
}

export function serializePaperOrder(order: {
  id: string; side: string; type: string; status: string; quantity: number; price: number | null;
  stopLoss: number | null; takeProfit: number | null; reduceOnly: boolean; isProtective: boolean;
  ocoGroupId: string | null; createdSequence: number; activeFromSequence: number;
  filledSequence: number | null; filledAt: Date | null; filledPrice: number | null;
  cancelReason: string | null; createdAt?: Date;
}): PaperOrderData {
  return {
    ...order,
    side: order.side as PaperSide,
    type: order.type as PaperOrderType,
    status: order.status as PaperOrderStatus,
    filledAt: order.filledAt?.toISOString() ?? null,
    createdAt: order.createdAt?.toISOString(),
  };
}

export function serializePaperFill(fill: {
  id: string; orderId: string; sequence: number; timestamp: Date; side: string; price: number;
  quantity: number; fee: number; slippageCost: number; realizedPnl: number; closedQuantity: number;
  openedQuantity: number; netQuantityAfter: number; averagePriceAfter: number | null; reason: string;
}): PaperFillData {
  return { ...fill, side: fill.side as PaperSide, reason: fill.reason as PaperFillReason, timestamp: fill.timestamp.toISOString() };
}

export function serializePaperTrade(trade: {
  id: string; side: string; status: string; openedSequence: number; openedAt: Date;
  closedSequence: number | null; closedAt: Date | null; grossPnl: number; fees: number; plannedRisk: number | null;
}): PaperTradeData {
  return {
    ...trade, side: trade.side as "LONG" | "SHORT", status: trade.status as "OPEN" | "CLOSED",
    openedAt: trade.openedAt.toISOString(), closedAt: trade.closedAt?.toISOString() ?? null,
  };
}

function streaks(values: number[]) {
  let wins = 0; let losses = 0; let maxWins = 0; let maxLosses = 0;
  for (const value of values) {
    if (value > 0) { wins += 1; losses = 0; maxWins = Math.max(maxWins, wins); }
    else if (value < 0) { losses += 1; wins = 0; maxLosses = Math.max(maxLosses, losses); }
    else { wins = 0; losses = 0; }
  }
  return { maxWins, maxLosses };
}

export async function getPaperSessionSnapshot(datasetId: string): Promise<PaperSessionSnapshot | null> {
  const session = await prisma.paperTradingSession.findUnique({ where: { datasetId } });
  if (!session) return null;
  const [activeOrders, recentOrders, recentFills, recentTrades, closedTrades, currentBar] = await Promise.all([
    prisma.paperOrder.findMany({ where: { sessionId: session.id, status: "PENDING" }, orderBy: [{ createdSequence: "asc" }, { createdAt: "asc" }] }),
    prisma.paperOrder.findMany({ where: { sessionId: session.id, status: { not: "PENDING" } }, orderBy: { updatedAt: "desc" }, take: 30 }),
    prisma.paperFill.findMany({ where: { sessionId: session.id }, orderBy: [{ sequence: "desc" }, { createdAt: "desc" }], take: 50 }),
    prisma.paperTrade.findMany({ where: { sessionId: session.id }, orderBy: { openedSequence: "desc" }, take: 30 }),
    prisma.paperTrade.findMany({ where: { sessionId: session.id, status: "CLOSED" }, orderBy: { closedSequence: "asc" } }),
    session.lastProcessedSequence >= 0
      ? prisma.marketBar.findUnique({ where: { datasetId_sequence: { datasetId, sequence: session.lastProcessedSequence } } })
      : Promise.resolve(null),
  ]);
  const unrealizedPnl = currentBar && session.averageEntryPrice !== null
    ? (currentBar.close - session.averageEntryPrice) * session.netQuantity : 0;
  const balance = session.initialCapital + session.realizedPnl - session.totalFees;
  const equity = balance + unrealizedPnl;
  const pnls = closedTrades.map((trade) => trade.grossPnl - trade.fees);
  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0);
  const grossWins = wins.reduce((sum, value) => sum + value, 0);
  const grossLosses = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const streak = streaks(pnls);
  const stats: PaperTradingStats = {
    balance, equity, unrealizedPnl, netPnl: equity - session.initialCapital,
    tradeCount: closedTrades.length,
    winRate: closedTrades.length ? wins.length / closedTrades.length : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? null : 0,
    averageWin: wins.length ? grossWins / wins.length : 0,
    averageLoss: losses.length ? -grossLosses / losses.length : 0,
    maxConsecutiveWins: streak.maxWins, maxConsecutiveLosses: streak.maxLosses,
    maxDrawdown: session.maxDrawdown, totalFees: session.totalFees, totalSlippage: session.totalSlippage,
  };
  return {
    session: serializePaperSession(session),
    activeOrders: activeOrders.map(serializePaperOrder),
    recentOrders: recentOrders.map(serializePaperOrder),
    recentFills: recentFills.map(serializePaperFill),
    recentTrades: recentTrades.map(serializePaperTrade),
    stats,
  };
}
