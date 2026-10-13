import { accountWhere, entryProjectionWhere } from '@/lib/replay-sessions/scope';
import type { Prisma } from "@prisma/client";
import { logicalId } from "@/lib/replay-sessions/identity";
import { prisma } from "@/lib/db";
import type {
  PaperFillData,
  PaperFillReason,
  PaperOrderData,
  PaperOrderStatus,
  PaperPositionLotData,
  PaperOrderType,
  PaperSessionSnapshot,
  PaperSessionState,
  PaperSide,
  PaperTradeData,
  PaperTradingStats,
} from "./types";
import { summarizeClosedTrades, type IncrementalTradeStats } from "./trade-stats";

export type SessionRecord = {
  id: string; datasetId: string; journalSessionId: string | null; initialCapital: number; currency: string;
  commissionBps: number; slippageBps: number; lastProcessedSequence: number;
  netQuantity: number; averageEntryPrice: number | null; realizedPnl: number;
  totalFees: number; totalSlippage: number; peakEquity: number; maxDrawdown: number; version: number;
  tradeStatsVersion: number; closedTradeCount: number; winningTradeCount: number; losingTradeCount: number;
  grossWinningPnl: number; grossLosingPnl: number; currentWinStreak: number; currentLossStreak: number;
  maxConsecutiveWins: number; maxConsecutiveLosses: number;
  activeCycleKey?: string | null;
};

export function tradeStatsFromSession(session: SessionRecord): IncrementalTradeStats {
  return {
    closedTradeCount: session.closedTradeCount,
    winningTradeCount: session.winningTradeCount,
    losingTradeCount: session.losingTradeCount,
    grossWinningPnl: session.grossWinningPnl,
    grossLosingPnl: session.grossLosingPnl,
    currentWinStreak: session.currentWinStreak,
    currentLossStreak: session.currentLossStreak,
    maxConsecutiveWins: session.maxConsecutiveWins,
    maxConsecutiveLosses: session.maxConsecutiveLosses,
  };
}

export async function ensurePaperTradeStats(
  session: SessionRecord,
  db: Prisma.TransactionClient = prisma,
): Promise<SessionRecord> {
  if (session.tradeStatsVersion >= 1) return session;
  const closedTrades = await db.paperTrade.findMany({
    where: { sessionId: session.id, status: "CLOSED" },
    orderBy: [{ closedSequence: "asc" }, { id: "asc" }],
    select: { grossPnl: true, fees: true },
  });
  const stats = summarizeClosedTrades(closedTrades.map((trade) => trade.grossPnl - trade.fees));
  return await db.paperTradingSession.update({
    where: { id: session.id },
    data: { ...stats, tradeStatsVersion: 1 },
  }) as SessionRecord;
}

export function serializePaperSession(session: SessionRecord): PaperSessionState {
  return {
    id: logicalId(session.id), datasetId: session.datasetId, initialCapital: session.initialCapital,
    currency: session.currency, commissionBps: session.commissionBps, slippageBps: session.slippageBps,
    lastProcessedSequence: session.lastProcessedSequence, netQuantity: session.netQuantity,
    averageEntryPrice: session.averageEntryPrice, realizedPnl: session.realizedPnl,
    totalFees: session.totalFees, totalSlippage: session.totalSlippage,
    peakEquity: session.peakEquity, maxDrawdown: session.maxDrawdown, version: session.version,
    activeCycleKey: session.activeCycleKey ?? null,
  };
}

export function serializePaperOrder(order: {
  id: string; side: string; type: string; status: string; quantity: number; price: number | null;
  riskAmount: number | null;
  stopLoss: number | null; takeProfit: number | null; reduceOnly: boolean; isProtective: boolean;
  ocoGroupId: string | null; parentOrderId?: string | null; createdSequence: number; activeFromSequence: number;
  filledSequence: number | null; filledAt: Date | null; filledPrice: number | null;
  cancelReason: string | null; createdAt?: Date;
}): PaperOrderData {
  return { id: logicalId(order.id), side: order.side as PaperSide, type: order.type as PaperOrderType,
    status: order.status as PaperOrderStatus, quantity: order.quantity, riskAmount: order.riskAmount,
    price: order.price, stopLoss: order.stopLoss, takeProfit: order.takeProfit, reduceOnly: order.reduceOnly,
    isProtective: order.isProtective, ocoGroupId: order.ocoGroupId, parentOrderId: order.parentOrderId ?? null,
    createdSequence: order.createdSequence, activeFromSequence: order.activeFromSequence,
    filledSequence: order.filledSequence, filledAt: order.filledAt?.toISOString() ?? null,
    filledPrice: order.filledPrice, cancelReason: order.cancelReason, createdAt: order.createdAt?.toISOString() };
}

export function serializePaperFill(fill: {
  id: string; orderId: string; cycleKey?: string | null; sequence: number; timestamp: Date; side: string; price: number;
  quantity: number; fee: number; slippageCost: number; realizedPnl: number; closedQuantity: number;
  openedQuantity: number; netQuantityAfter: number; averagePriceAfter: number | null; reason: string;
}): PaperFillData {
  return { id: logicalId(fill.id), orderId: logicalId(fill.orderId), cycleKey: fill.cycleKey ?? null,
    sequence: fill.sequence, timestamp: fill.timestamp.toISOString(), side: fill.side as PaperSide,
    price: fill.price, quantity: fill.quantity, fee: fill.fee, slippageCost: fill.slippageCost,
    realizedPnl: fill.realizedPnl, closedQuantity: fill.closedQuantity, openedQuantity: fill.openedQuantity,
    netQuantityAfter: fill.netQuantityAfter, averagePriceAfter: fill.averagePriceAfter, reason: fill.reason as PaperFillReason };
}

export function serializePaperTrade(trade: {
  id: string; side: string; status: string; openedSequence: number; openedAt: Date;
  closedSequence: number | null; closedAt: Date | null; grossPnl: number; fees: number; plannedRisk: number | null;
}): PaperTradeData {
  return { id: logicalId(trade.id), side: trade.side as "LONG" | "SHORT", status: trade.status as "OPEN" | "CLOSED",
    openedSequence: trade.openedSequence, openedAt: trade.openedAt.toISOString(),
    closedSequence: trade.closedSequence, closedAt: trade.closedAt?.toISOString() ?? null,
    grossPnl: trade.grossPnl, fees: trade.fees, plannedRisk: trade.plannedRisk };
}

export function serializePaperPositionLot(lot: {
  id: string; entryFillId: string; side: string; openedSequence: number; openedAt: Date;
  entryPrice: number; entryOrderType: string | null; initialStopPrice: number | null; initialQuantity: number; remainingQuantity: number; initialRisk: number | null;
  actualRisk: number; abrValue: number | null; abrLength: number; displayIntervalSeconds: number;
  displaySession: string; displayUtcOffsetMinutes: number; priceTickSize: number;
}): PaperPositionLotData {
  return { id: logicalId(lot.id), entryFillId: logicalId(lot.entryFillId), side: lot.side as "LONG" | "SHORT",
    openedSequence: lot.openedSequence, openedAt: lot.openedAt.toISOString(), entryPrice: lot.entryPrice,
    entryOrderType: lot.entryOrderType as PaperPositionLotData["entryOrderType"], initialStopPrice: lot.initialStopPrice,
    initialQuantity: lot.initialQuantity, remainingQuantity: lot.remainingQuantity, initialRisk: lot.initialRisk,
    actualRisk: lot.actualRisk, abrValue: lot.abrValue, abrLength: lot.abrLength,
    displayIntervalSeconds: lot.displayIntervalSeconds, displaySession: lot.displaySession as "ETH" | "RTH",
    displayUtcOffsetMinutes: lot.displayUtcOffsetMinutes, priceTickSize: lot.priceTickSize };
}

export async function getPaperSessionSnapshot(datasetId: string, db: Prisma.TransactionClient = prisma): Promise<PaperSessionSnapshot | null> {
  const storedSession = await db.paperTradingSession.findFirst({ where: accountWhere(datasetId) });
  if (!storedSession) return null;
  const session = await ensurePaperTradeStats(storedSession as SessionRecord, db);
  const [activeOrders, recentOrders, recentFills, recentTrades, openLots, currentBar, journalEntryCount] = await Promise.all([
    db.paperOrder.findMany({ where: { sessionId: session.id, status: "PENDING" }, orderBy: [{ createdSequence: "asc" }, { createdAt: "asc" }] }),
    db.paperOrder.findMany({ where: { sessionId: session.id, status: { not: "PENDING" } }, orderBy: { updatedAt: "desc" }, take: 30 }),
    db.paperFill.findMany({ where: { sessionId: session.id }, orderBy: [{ sequence: "desc" }, { createdAt: "desc" }], take: 50 }),
    db.paperTrade.findMany({ where: { sessionId: session.id }, orderBy: { openedSequence: "desc" }, take: 30 }),
    db.paperPositionLot.findMany({ where: { sessionId: session.id }, orderBy: [{ openedSequence: "asc" }, { createdAt: "asc" }] }),
    session.lastProcessedSequence >= 0
      ? db.marketBar.findUnique({ where: { datasetId_sequence: { datasetId, sequence: session.lastProcessedSequence } } })
      : Promise.resolve(null),
    session.journalSessionId
      ? db.replayJournalEntry.count({ where: { journalSessionId: session.journalSessionId, ...entryProjectionWhere() } })
      : Promise.resolve(0),
  ]);
  const recentOrderIds = new Set(recentOrders.map((order) => order.id));
  const recentParentSequences = new Set(recentOrders
    .filter((order) => !order.isProtective && order.filledSequence !== null)
    .map((order) => order.filledSequence!));
  const missingParentSequences = [...new Set(activeOrders
    .filter((order) => order.isProtective && !recentParentSequences.has(order.createdSequence))
    .map((order) => order.createdSequence))];
  const protectiveParents = missingParentSequences.length === 0
    ? []
    : await db.paperOrder.findMany({
      where: {
        sessionId: session.id,
        isProtective: false,
        filledSequence: { in: missingParentSequences },
      },
    });
  const snapshotRecentOrders = [
    ...recentOrders,
    ...protectiveParents.filter((order) => !recentOrderIds.has(order.id)),
  ];
  const unrealizedPnl = currentBar && session.averageEntryPrice !== null
    ? (currentBar.close - session.averageEntryPrice) * session.netQuantity : 0;
  const balance = session.initialCapital + session.realizedPnl - session.totalFees;
  const equity = balance + unrealizedPnl;
  const stats: PaperTradingStats = {
    balance, equity, unrealizedPnl, netPnl: equity - session.initialCapital,
    tradeCount: session.closedTradeCount,
    journalEntryCount,
    winRate: session.closedTradeCount ? session.winningTradeCount / session.closedTradeCount : 0,
    profitFactor: session.grossLosingPnl > 0
      ? session.grossWinningPnl / session.grossLosingPnl
      : session.grossWinningPnl > 0 ? null : 0,
    averageWin: session.winningTradeCount ? session.grossWinningPnl / session.winningTradeCount : 0,
    averageLoss: session.losingTradeCount ? -session.grossLosingPnl / session.losingTradeCount : 0,
    maxConsecutiveWins: session.maxConsecutiveWins,
    maxConsecutiveLosses: session.maxConsecutiveLosses,
    maxDrawdown: session.maxDrawdown, totalFees: session.totalFees, totalSlippage: session.totalSlippage,
  };
  return {
    session: serializePaperSession(session),
    activeOrders: activeOrders.map(serializePaperOrder),
    recentOrders: snapshotRecentOrders.map(serializePaperOrder),
    recentFills: recentFills.map(serializePaperFill),
    recentTrades: recentTrades.map(serializePaperTrade),
    openLots: openLots.map(serializePaperPositionLot),
    stats,
  };
}
