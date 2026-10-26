import type { Prisma } from "@prisma/client";
import { copy } from "@/lib/i18n";
import { getReplayScope, ReplaySessionError } from "@/lib/replay-sessions/scope";
import { confirmPropPayoutInTransaction, loadPropAccount } from "@/lib/prop-practice/service";
import { funds, payoutPreview } from "@/lib/prop-practice/rules";
import { moneyMinor, moneyValue, requireWallet, settleStandardAccount, standardSettlement, walletManaged } from "./service";

export type DeleteSettlement = { kind: "WITHDRAW" | "PAYOUT" | "FORFEIT"; amount: number; requestId: string };
export async function sessionWalletPreview(tx: Prisma.TransactionClient) {
  const scope = getReplayScope()!;
  const owner = await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id } });
  if (owner.activeProjectionId !== scope.projectionId || owner.version !== scope.version) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
  const base = { managed: walletManaged(owner), category: owner.accountCategory, version: owner.version, kind: "FORFEIT" as DeleteSettlement["kind"], amount: 0, received: 0, abandoned: 0, blocked: !!owner.pendingCorrectionId, settled: false, hasAccount: false, available: 0 };
  if (!base.managed) return base;
  base.available = moneyValue((await requireWallet(tx, owner.userId!)).balanceMinor);
  if (owner.accountCategory !== "PROP_PRACTICE") {
    const result = await standardSettlement(tx, owner, scope.projectionId);
    return result ? { ...base, hasAccount: true, kind: result.allocation.settledAt ? "FORFEIT" as const : "WITHDRAW" as const, amount: moneyValue(result.amount), received: moneyValue(result.amount), blocked: base.blocked || result.blocked, settled: !!result.allocation.settledAt } : base;
  }
  const runtime = await loadPropAccount(tx);
  if (!runtime) return base;
  const account = await tx.paperTradingSession.findUniqueOrThrow({ where: { projectionId: scope.projectionId } });
  const pending = await tx.paperOrder.count({ where: { sessionId: account.id, status: "PENDING" } });
  const preview = payoutPreview(runtime.snapshot.rules, runtime.state);
  const eligible = !base.blocked && owner.status === "ACTIVE" && account.netQuantity === 0 && !pending && preview.eligible;
  const amount = eligible ? preview.maximum : 0;
  return { ...base, hasAccount: true, kind: eligible ? "PAYOUT" as const : "FORFEIT" as const, amount, received: Math.round(amount * runtime.snapshot.rules.payout.traderShare * 100) / 100, abandoned: Math.round(Math.max(0, funds(runtime.state).profit - amount) * 100) / 100 };
}
export type SessionWalletPreview = Awaited<ReturnType<typeof sessionWalletPreview>>;
export async function settleSessionDeletion(tx: Prisma.TransactionClient, input?: DeleteSettlement) {
  const scope = getReplayScope()!;
  const preview = await sessionWalletPreview(tx);
  if (!preview.managed || !preview.hasAccount || preview.settled) return;
  if (preview.blocked) throw new ReplaySessionError("WALLET_NOT_FLAT", 409, copy.userWallet.deleteBlocked);
  if (!input || input.kind !== preview.kind || moneyMinor(input.amount) !== moneyMinor(preview.amount)) throw new ReplaySessionError("WALLET_CONFLICT", 409, copy.userWallet.conflict);
  if (input.kind === "WITHDRAW") {
    const owner = await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id } });
    await settleStandardAccount(tx, owner, scope.projectionId);
  } else if (input.kind === "PAYOUT") {
    await confirmPropPayoutInTransaction(tx, { expectedVersion: preview.version, amount: input.amount, requestId: input.requestId });
  }
}
