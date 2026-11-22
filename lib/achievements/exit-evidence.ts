import type { Prisma } from "@prisma/client";
import { logicalId } from "@/lib/replay-sessions/identity";

export const ExitReason = {
  STOP_LOSS: 1,
  TAKE_PROFIT: 2,
  MANUAL: 4,
  REVERSE: 8,
  FORCED: 16,
  UNKNOWN: 32,
} as const;

export function accumulateExitReason(mask: number | null, reason: string, forced = false): number {
  const latest = forced ? ExitReason.FORCED
    : reason === "STOP_LOSS" ? ExitReason.STOP_LOSS
    : reason === "TAKE_PROFIT" ? ExitReason.TAKE_PROFIT
    : reason === "REVERSE" ? ExitReason.REVERSE
    : reason === "REDUCE" || reason === "CLOSE" ? ExitReason.MANUAL : ExitReason.UNKNOWN;
  return (mask ?? ExitReason.UNKNOWN) | latest;
}

const maxFills = 200;
const fillSelect = {
  id: true, sequence: true, timestamp: true, reason: true, side: true,
  closedQuantity: true, openedQuantity: true, netQuantityAfter: true,
} satisfies Prisma.PaperFillSelect;
type CycleStart = { id: string; sessionId: string; openedSequence: number; openedAt: Date; side: string };

const sameQuantity = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

export async function verifiedExitMask(
  tx: Prisma.TransactionClient, trade: CycleStart, expectedNet: number, throughSequence: number,
) {
  const fills = await tx.paperFill.findMany({
    where: { sessionId: trade.sessionId, sequence: { gte: trade.openedSequence, lte: throughSequence } },
    orderBy: { sequence: "asc" }, take: maxFills + 1, select: fillSelect,
  });
  const first = fills[0], last = fills.at(-1);
  if (fills.length > maxFills || !first || !last
    || first.sequence !== trade.openedSequence || first.timestamp.getTime() !== trade.openedAt.getTime()
    || `speculative_${logicalId(first.id)}` !== logicalId(trade.id)
    || !sameQuantity(last.netQuantityAfter, expectedNet)
    || (expectedNet === 0 && (last.netQuantityAfter !== 0 || last.sequence !== throughSequence || last.closedQuantity <= 0))) return null;
  const direction = trade.side === "LONG" ? 1 : -1;
  if ((first.reason !== "ENTRY" || first.closedQuantity !== 0) && (first.reason !== "REVERSE" || first.closedQuantity <= 0)) return null;
  if (first.side !== (direction > 0 ? "BUY" : "SELL") || first.openedQuantity <= 0
    || !sameQuantity(first.netQuantityAfter, direction * first.openedQuantity)) return null;
  let mask = 0, previous = first;
  for (const fill of fills.slice(1)) {
    if (fill.side !== "BUY" && fill.side !== "SELL") return null;
    const direction = fill.side === "BUY" ? 1 : -1;
    const expected = previous.netQuantityAfter + direction * (fill.closedQuantity + fill.openedQuantity);
    if (fill.sequence === previous.sequence || !previous.netQuantityAfter || !sameQuantity(expected, fill.netQuantityAfter)
      || (fill.netQuantityAfter !== 0 && Math.sign(fill.netQuantityAfter) !== Math.sign(previous.netQuantityAfter))) return null;
    if (fill.closedQuantity > 0) mask = accumulateExitReason(mask, fill.reason);
    previous = fill;
  }
  return mask;
}

export function reconcileExitMask(recorded: number | null, verified: number | null) {
  const known = (recorded ?? 0) & ~ExitReason.UNKNOWN;
  return verified !== null && !(verified & ExitReason.UNKNOWN) && (verified & known) === known ? verified : recorded;
}
