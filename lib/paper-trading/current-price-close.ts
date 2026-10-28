import type { PaperTradingSession, Prisma } from "@prisma/client";
import type { MarketBarData } from "@/lib/market-replay/types";
import { persistDerivedBatch } from "@/lib/replay-sessions/persistence";
import { getReplayScope } from "@/lib/replay-sessions/scope";
import { closePaperTradingAtCurrentPrice } from "./engine";
import { createDeterministicEventIdFactory } from "./deterministic-id";
import { ensurePaperTradeStats, hydrateTrainingLots, serializePaperOrder, serializePaperPositionLot, serializePaperSession } from "./serialize";

/** Caller owns the transaction, order creation, and command/checkpoint recording. */
export async function executeCurrentPriceClose(
  tx: Prisma.TransactionClient,
  account: PaperTradingSession,
  generation: number,
  bar: MarketBarData,
  orderId: string,
) {
  return (await executeCurrentPriceCloseResult(tx, account, generation, bar, orderId)).account;
}

/** Also return executions for callers composing an authoritative replay response. */
export async function executeCurrentPriceCloseResult(
  tx: Prisma.TransactionClient,
  account: PaperTradingSession,
  generation: number,
  bar: MarketBarData,
  orderId: string,
) {
  account = await ensurePaperTradeStats(account, tx) as PaperTradingSession;
  if (getReplayScope()?.mode === "TRAINING") await hydrateTrainingLots(tx, account.id);
  const [orders, lots] = await Promise.all([
    tx.paperOrder.findMany({ where: { sessionId: account.id, status: "PENDING" } }),
    tx.paperPositionLot.findMany({ where: { sessionId: account.id }, orderBy: [{ openedSequence: "asc" }, { createdAt: "asc" }] }),
  ]);
  const state = serializePaperSession(account);
  const result = closePaperTradingAtCurrentPrice({
    state, orders: orders.map(serializePaperOrder), lots: lots.map(serializePaperPositionLot),
    bar, makeId: createDeterministicEventIdFactory(state.id, generation, bar.sequence),
  }, orderId);
  const updated = await persistDerivedBatch(tx, account, generation, {
    state: result.state, orders: result.orders, fills: result.fills, lots: result.lots,
    entries: result.journalEntries, equityPoints: [],
  });
  // The current source candle may already have a sampled point. Replace it with
  // post-close equity without adding a candle or losing the existing peak.
  const point = { ...result.equityPoint, timestamp: new Date(result.equityPoint.timestamp) };
  await tx.paperEquityPoint.upsert({
    where: { sessionId_sequence: { sessionId: account.id, sequence: bar.sequence } },
    create: { ...point, sessionId: account.id }, update: point,
  });
  return { account: updated, result };
}
