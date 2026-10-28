import type { Prisma } from "@prisma/client";
import { serializeSourceBar } from "@/lib/market-replay/dataset";
import { executeCurrentPriceCloseResult } from "@/lib/paper-trading/current-price-close";
import { createDeterministicEventIdFactory } from "@/lib/paper-trading/deterministic-id";
import { parseTrainingGate } from "@/lib/paper-trading/training-gate";
import type { PaperFillData } from "@/lib/paper-trading/types";
import { logicalId } from "@/lib/replay-sessions/identity";
import { accountWhere, getReplayScope, progressWhere, runWithReplayScope, storageId } from "@/lib/replay-sessions/scope";
import { settlePropLiquidation, type PropState } from "./rules";
import type { PropRuntime } from "./service";

/** The caller owns the transaction: a newly failed round must finish flat before its failure is saved. */
export async function liquidatePropFailure(tx: Prisma.TransactionClient, runtime: PropRuntime, previous: PropState) {
  if (previous.result || runtime.state.result !== "FAILED") return null;
  const scope = getReplayScope()!;
  const observation = runtime.state.last!;
  const [original, progress, owner, bar] = await Promise.all([
    tx.paperTradingSession.findFirstOrThrow({ where: accountWhere(scope.datasetId) }),
    tx.replayProgress.findFirstOrThrow({ where: progressWhere(scope.datasetId) }),
    tx.replaySession.findUniqueOrThrow({ where: { id: scope.id }, select: { trainingGate: true } }),
    tx.marketBar.findUniqueOrThrow({ where: { datasetId_sequence: { datasetId: scope.datasetId, sequence: observation.sequence } } }),
  ]);
  if (original.lastProcessedSequence !== observation.sequence) throw new Error("Failure close must use the last processed source candle.");
  let trainingGate = parseTrainingGate(owner.trainingGate);
  const cancelled = await tx.paperOrder.updateMany({ where: { sessionId: original.id, status: "PENDING" },
    data: { status: "CANCELLED", cancelReason: "PROP_FAILED" } });
  let account = original;
  let fills: PaperFillData[] = [];
  if (account.netQuantity !== 0) {
    const id = createDeterministicEventIdFactory(logicalId(account.id), progress.generation, bar.sequence)("prop-failure-close");
    await tx.paperOrder.create({ data: {
      id: storageId(id), sessionId: account.id, side: account.netQuantity > 0 ? "SELL" : "BUY", type: "MARKET",
      quantity: Math.abs(account.netQuantity), reduceOnly: true, createdSequence: bar.sequence, activeFromSequence: bar.sequence,
    } });
    // Use the just-persisted gate, without leaking a speculative settlement into the caller's scope.
    const close = await runWithReplayScope({ ...scope, trainingGate },
      () => executeCurrentPriceCloseResult(tx, account, progress.generation, serializeSourceBar(bar), id));
    account = close.account; fills = close.result.fills;
    trainingGate = close.result.state.trainingGate!;
  } else if (cancelled.count) {
    account = await tx.paperTradingSession.update({ where: { id: account.id }, data: { version: { increment: 1 } } });
  }
  runtime.state = settlePropLiquidation(runtime.snapshot.rules, runtime.state, { ...observation,
    rawNet: account.realizedPnl - account.totalFees, realizedPnl: account.realizedPnl, totalFees: account.totalFees,
    unrealized: 0, flat: true, pending: 0, hadFill: observation.hadFill || fills.length > 0 });
  return { account, fills, trainingGate };
}
