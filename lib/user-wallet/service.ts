import { accountBalance } from "@/lib/paper-trading/account-funds";
import type { Prisma } from "@prisma/client";
import { copy } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import { ReplaySessionError } from "@/lib/replay-sessions/scope";

const t = copy.userWallet;
export const INITIAL_BALANCE_MINOR = BigInt(1_000_000);
const LIMIT = BigInt(Number.MAX_SAFE_INTEGER);
export function moneyMinor(value: number, exact = true): bigint {
  const rounded = Math.round(value * 100);
  if (!Number.isFinite(value) || !Number.isSafeInteger(rounded) || (exact && Math.abs(value * 100 - rounded) > 0.00001)) throw new ReplaySessionError("WALLET_AMOUNT_INVALID", 400, t.invalidMoney);
  return BigInt(rounded);
}
export function moneyValue(value: bigint): number {
  if (value > LIMIT || value < -LIMIT) throw new ReplaySessionError("WALLET_AMOUNT_INVALID", 400, t.invalidMoney);
  return Number(value) / 100;
}
export type WalletOwner = { id: string; name: string; mode: string; userId: string | null };
export function walletManaged(owner: Pick<WalletOwner, "mode" | "userId">) { return owner.mode === "TRAINING" && !!owner.userId; }
export async function initializeWallet(tx: Prisma.TransactionClient, userId: string) {
  const existing = await tx.userWallet.findUnique({ where: { userId } });
  if (existing) return existing;
  const wallet = await tx.userWallet.create({ data: { userId, balanceMinor: INITIAL_BALANCE_MINOR } });
  await tx.userWalletEntry.create({ data: { userId, sourceKey: `INITIAL:${userId}`, type: "INITIAL", amountMinor: INITIAL_BALANCE_MINOR, balanceAfterMinor: INITIAL_BALANCE_MINOR } });
  return wallet;
}
export async function requireWallet(tx: Prisma.TransactionClient, userId: string) {
  const wallet = await tx.userWallet.findUnique({ where: { userId } });
  if (!wallet) throw new ReplaySessionError("WALLET_MISSING", 409, t.missing);
  return wallet;
}
async function sufficient(tx: Prisma.TransactionClient, userId: string, amount: bigint) {
  const wallet = await requireWallet(tx, userId);
  if (amount < BigInt(0) || amount > LIMIT) throw new ReplaySessionError("WALLET_AMOUNT_INVALID", 400, t.invalidMoney);
  if (wallet.balanceMinor < amount) throw new ReplaySessionError("WALLET_INSUFFICIENT", 409, t.insufficient(formatNumber(moneyValue(wallet.balanceMinor)), formatNumber(moneyValue(amount))));
  return wallet;
}
type Entry = { userId: string; sourceKey: string; type: string; amountMinor: bigint; sessionId?: string; sessionName?: string; roundNumber?: number };
export async function writeWalletEntry(tx: Prisma.TransactionClient, input: Entry) {
  const existing = await tx.userWalletEntry.findUnique({ where: { sourceKey: input.sourceKey } });
  if (existing) {
    if (existing.userId !== input.userId || existing.type !== input.type || existing.amountMinor !== input.amountMinor || existing.sessionId !== (input.sessionId ?? null)) throw new ReplaySessionError("WALLET_CONFLICT", 409, t.conflict);
    return existing;
  }
  const wallet = input.amountMinor < BigInt(0) ? await sufficient(tx, input.userId, -input.amountMinor) : await requireWallet(tx, input.userId);
  const balance = wallet.balanceMinor + input.amountMinor;
  moneyValue(balance);
  const saved = await tx.userWallet.updateMany({ where: { userId: input.userId, version: wallet.version, balanceMinor: wallet.balanceMinor }, data: { balanceMinor: balance, version: { increment: 1 } } });
  if (saved.count !== 1) throw new ReplaySessionError("WALLET_CONFLICT", 409, t.conflict);
  return tx.userWalletEntry.create({ data: { ...input, balanceAfterMinor: balance } });
}
export async function fundStandardAccount(tx: Prisma.TransactionClient, owner: WalletOwner, projectionId: string, initialCapital: number) {
  if (!walletManaged(owner)) return;
  const amount = moneyMinor(initialCapital);
  if (amount <= BigInt(0)) throw new ReplaySessionError("WALLET_AMOUNT_INVALID", 400, t.invalidMoney);
  await writeWalletEntry(tx, { userId: owner.userId!, type: "DEPOSIT", sourceKey: `DEPOSIT:${projectionId}`, amountMinor: -amount, sessionId: owner.id, sessionName: owner.name });
  await tx.userWalletAllocation.create({ data: { projectionId, userId: owner.userId!, sessionId: owner.id, sessionName: owner.name, depositedMinor: amount } });
}
export async function chargePropPurchase(tx: Prisma.TransactionClient, owner: WalletOwner, roundNumber: number, rules: { purchaseCost?: number | null; activationCost?: number | null }) {
  if (!walletManaged(owner)) return;
  const cost = moneyMinor(rules.purchaseCost ?? 0), activation = moneyMinor(rules.activationCost ?? 0);
  await sufficient(tx, owner.userId!, cost + activation);
  await writeWalletEntry(tx, { userId: owner.userId!, type: "PURCHASE", sourceKey: `PURCHASE:${owner.id}:${roundNumber}`, amountMinor: -cost, sessionId: owner.id, sessionName: owner.name, roundNumber });
}
export async function chargePropActivation(tx: Prisma.TransactionClient, owner: WalletOwner, roundNumber: number, cost: number) {
  if (!walletManaged(owner) || cost === 0) return;
  await writeWalletEntry(tx, { userId: owner.userId!, type: "ACTIVATION", sourceKey: `ACTIVATION:${owner.id}:${roundNumber}`, amountMinor: -moneyMinor(cost), sessionId: owner.id, sessionName: owner.name, roundNumber });
}
export async function creditPropPayout(tx: Prisma.TransactionClient, owner: WalletOwner, payout: { id: string; received: number; roundNumber: number }) {
  if (!walletManaged(owner)) return;
  await writeWalletEntry(tx, { userId: owner.userId!, type: "PAYOUT", sourceKey: `PAYOUT:${payout.id}`, amountMinor: moneyMinor(payout.received), sessionId: owner.id, sessionName: owner.name, roundNumber: payout.roundNumber });
}
export async function standardSettlement(tx: Prisma.TransactionClient, owner: WalletOwner, projectionId: string) {
  if (!walletManaged(owner)) return null;
  const account = await tx.paperTradingSession.findUnique({ where: { projectionId } });
  if (!account) return null;
  const allocation = await tx.userWalletAllocation.findUnique({ where: { projectionId } });
  if (!allocation || allocation.userId !== owner.userId) throw new ReplaySessionError("WALLET_CONFLICT", 409, t.conflict);
  const pending = await tx.paperOrder.count({ where: { sessionId: account.id, status: "PENDING" } });
  const blocked = !allocation.settledAt && (account.netQuantity !== 0 || pending > 0);
  const amount = allocation.settledAt ? BigInt(0) : moneyMinor(Math.max(0, accountBalance(account)), false);
  return { account, allocation, amount, blocked };
}
/** Final settlement for deletion/restart only; regular transfers keep the allocation open. */
export async function settleStandardAccount(tx: Prisma.TransactionClient, owner: WalletOwner, projectionId: string) {
  const result = await standardSettlement(tx, owner, projectionId);
  if (!result || result.allocation.settledAt) return result;
  if (result.blocked) throw new ReplaySessionError("WALLET_NOT_FLAT", 409, t.mustBeFlat);
  await writeWalletEntry(tx, { userId: owner.userId!, type: "WITHDRAWAL", sourceKey: `WITHDRAWAL:${projectionId}`, amountMinor: result.amount, sessionId: owner.id, sessionName: owner.name });
  await tx.userWalletAllocation.update({ where: { projectionId }, data: { withdrawnMinor: { increment: result.amount }, settledAt: new Date() } });
  return result;
}
