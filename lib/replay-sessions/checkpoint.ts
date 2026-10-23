import type { Prisma } from "@prisma/client";
import { getReplayScope } from "./scope";
import { getPaperSessionSnapshot, serializePaperTrade, tradeStatsFromSession } from "@/lib/paper-trading/serialize";
import type { PaperSessionState, PaperOrderData, PaperPositionLotData, PaperTradeData } from "@/lib/paper-trading/types";
import type { IncrementalTradeStats } from "@/lib/paper-trading/trade-stats";

export const REPLAY_CHECKPOINT_STRIDE = 4096;
export type CheckpointState = {
  propAccount?: import("@/lib/prop-practice/service").PropRuntime | null;
  account: PaperSessionState | null;
  stats: IncrementalTradeStats | null;
  activeOrders?: PaperOrderData[];
  lots?: PaperPositionLotData[];
  activeTrade?: PaperTradeData | null;
  equitySampleStride?: number;
};
export async function saveReplayCheckpoint(tx: Prisma.TransactionClient, sourceSequence: number, commandOrdinal = 0, force = false) {
  const scope = getReplayScope();
  if (!scope) return;
  const previous = await tx.replayCheckpoint.findFirst({ where: { projectionId: scope.projectionId }, orderBy: [{ sourceSequence: "desc" }, { commandOrdinal: "desc" }] });
  if (!force && previous && sourceSequence - previous.sourceSequence < REPLAY_CHECKPOINT_STRIDE) return;
  if (previous?.sourceSequence === sourceSequence && previous.commandOrdinal === commandOrdinal) return;
  const account = await tx.paperTradingSession.findUnique({ where: { projectionId: scope.projectionId } });
  const snapshot = account ? await getPaperSessionSnapshot(scope.datasetId, tx) : null;
  const activeTrade = account ? await tx.paperTrade.findFirst({ where: { sessionId: account.id, status: "OPEN" } }) : null;
  const state: CheckpointState = {
    ...(snapshot?.propAccount ? { propAccount: snapshot.propAccount } : {}),
    account: snapshot?.session ?? null, stats: account ? tradeStatsFromSession(account) : null,
    activeOrders: snapshot?.activeOrders ?? [], lots: snapshot?.openLots ?? [],
    activeTrade: activeTrade ? serializePaperTrade(activeTrade) : null, equitySampleStride: account?.equitySampleStride,
  };
  await tx.replayCheckpoint.create({ data: { projectionId: scope.projectionId, sourceSequence, commandOrdinal, state: JSON.stringify(state) } });
}
