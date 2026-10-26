import type { Prisma } from "@prisma/client";
import { copy } from "@/lib/i18n";
import { accountBalance, tradingBalance } from "@/lib/paper-trading/account-funds";
import { setAccountCashAdjustment } from "@/lib/paper-trading/account-cash";
import { assertSessionMetadataWritable, getReplayScope, markReplayMutation, ReplaySessionError } from "@/lib/replay-sessions/scope";
import { recordReplayCommand } from "@/lib/replay-sessions/service";
import { moneyMinor, moneyValue, standardSettlement, walletManaged, writeWalletEntry } from "./service";

export type TransferInput = { userId: string; kind: "DEPOSIT" | "WITHDRAW"; amount: number; expectedVersion: number; requestId: string };
export async function transferStandardAccount(tx: Prisma.TransactionClient, input: TransferInput) {
  const scope = getReplayScope()!;
  const owner = await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id } });
  if (!walletManaged(owner) || owner.accountCategory !== "STANDARD" || owner.userId !== input.userId) {
    throw new ReplaySessionError("WALLET_EXCLUDED", 409, copy.userWallet.excluded);
  }
  const amount = moneyMinor(input.amount);
  if (amount <= BigInt(0)) throw new ReplaySessionError("WALLET_AMOUNT_INVALID", 400, copy.userWallet.invalidMoney);
  const sourceKey = `TRANSFER:${owner.id}:${input.requestId}`;
  const signed = input.kind === "DEPOSIT" ? -amount : amount;
  const type = input.kind === "DEPOSIT" ? "DEPOSIT" : "WITHDRAWAL";
  const previous = await tx.userWalletEntry.findUnique({ where: { sourceKey } });
  if (previous) {
    if (previous.userId !== input.userId || previous.sessionId !== owner.id || previous.type !== type || previous.amountMinor !== signed) {
      throw new ReplaySessionError("WALLET_CONFLICT", 409, copy.userWallet.conflict);
    }
    return { amount: input.amount, kind: input.kind };
  }
  await assertSessionMetadataWritable(tx);
  if (owner.version !== input.expectedVersion) throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.userWallet.conflict);
  if (input.kind === "DEPOSIT" && owner.status !== "ACTIVE") throw new ReplaySessionError("SESSION_ARCHIVED", 409, copy.userWallet.archivedDeposit);
  const result = await standardSettlement(tx, owner, scope.projectionId);
  if (!result || result.allocation.settledAt) throw new ReplaySessionError("WALLET_SETTLED", 409, copy.userWallet.legacySettled);
  if (result.blocked || await tx.paperPositionLot.count({ where: { sessionId: result.account.id, remainingQuantity: { gt: 0 } } })) {
    throw new ReplaySessionError("WALLET_NOT_FLAT", 409, copy.userWallet.mustBeFlat);
  }
  if (input.kind === "WITHDRAW" && amount > result.amount) throw new ReplaySessionError("WALLET_INSUFFICIENT", 409, copy.userWallet.insufficientAccount);
  const before = moneyMinor(accountBalance(result.account), false);
  const remaining = before + (input.kind === "DEPOSIT" ? amount : -amount);
  // Round at the money boundary; never rewrite trading PnL/fees to make cash balance fit.
  const cashAdjustment = moneyValue(remaining) - tradingBalance(result.account);
  await writeWalletEntry(tx, { userId: input.userId, sourceKey, type, amountMinor: signed, sessionId: owner.id, sessionName: owner.name });
  await tx.userWalletAllocation.update({ where: { projectionId: scope.projectionId }, data: input.kind === "DEPOSIT"
    ? { depositedMinor: { increment: amount } } : { withdrawnMinor: { increment: amount } } });
  const account = await setAccountCashAdjustment(tx, result.account, cashAdjustment);
  await recordReplayCommand(tx, account.lastProcessedSequence, "CASH_TRANSFER", { cashAdjustment });
  await markReplayMutation(tx);
  return { amount: input.amount, kind: input.kind };
}
