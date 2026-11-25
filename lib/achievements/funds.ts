import type { PaperTradingSession, Prisma } from "@prisma/client";
import { accountBalance } from "@/lib/paper-trading/account-funds";
import type { PaperFillData, PaperSessionState } from "@/lib/paper-trading/types";
import { readHeldBalanceMinor, readUserFundsMinor, roundHeldBalancesMinor } from "@/lib/user-wallet/balances";
import { achievementCatalog, achievementKeys, fundsFingerprint, fundsMetric, tierKey } from "./catalog";
import { progressIdentity, publishAwards } from "./projection";

const milestones = achievementKeys.flatMap(key => {
  const entry = achievementCatalog[key];
  return entry.metric === fundsMetric ? [{ key, threshold: entry.thresholds[0] }] : [];
});
const highestThreshold = BigInt(Math.max(...milestones.map(row => row.threshold)));
const zero = BigInt(0);
const cell = (userId: string) => progressIdentity(userId, fundsMetric, fundsFingerprint);

export function readFundMilestones(tx: Prisma.TransactionClient, userId: string) {
  return tx.userAchievementProgress.findUnique({ where: { userId_metricKey_generation_scopeKey: cell(userId) }, select: { best: true } });
}

async function recordFundPeak(tx: Prisma.TransactionClient, userId: string, previousBest: number | undefined, opening: bigint, peak: bigint) {
  // Only the range up to the highest milestone is needed. It fits Prisma Int.
  const best = Number(peak > highestThreshold ? highestThreshold : peak > zero ? peak : zero);
  if (previousBest !== undefined && best <= previousBest) return;
  const now = new Date();
  const awards = milestones.filter(row => row.threshold > (previousBest ?? 0) && row.threshold <= best).map(({ key, threshold }) => {
    const historical = previousBest === undefined && BigInt(threshold) <= opening;
    return { userId, achievementKey: key, tierKey: tierKey(0), threshold, fingerprint: fundsFingerprint,
      attainedAt: historical ? null : now, historical, growthFactId: null };
  });
  await publishAwards(tx, awards);
  const identity = cell(userId);
  await tx.userAchievementProgress.upsert({ where: { userId_metricKey_generation_scopeKey: identity }, create: { ...identity, best }, update: { best } });
}

/** Observe both sides of an external credit, and the opening balance before any other ledger mutation. */
export async function observeWalletFunds(tx: Prisma.TransactionClient, userId: string, previousBalance: bigint, payout: bigint) {
  const progress = await readFundMilestones(tx, userId);
  if (progress && (payout <= zero || BigInt(progress.best) >= highestThreshold)) return;
  const opening = previousBalance + await readHeldBalanceMinor(tx, userId);
  await recordFundPeak(tx, userId, progress?.best, opening, opening + payout);
}

/** Track realized fills in execution order so batching cannot hide a reached milestone. */
export async function observeTradingFunds(tx: Prisma.TransactionClient, account: PaperTradingSession, state: PaperSessionState, fills: PaperFillData[]) {
  if (!account.projectionId || !fills.length) return;
  const allocation = await tx.userWalletAllocation.findUnique({ where: { projectionId: account.projectionId }, select: { userId: true, settledAt: true } });
  if (!allocation || allocation.settledAt) return;
  const progress = await readFundMilestones(tx, allocation.userId);
  if (progress && BigInt(progress.best) >= highestThreshold) return;

  const openingBalance = accountBalance(account);
  let peakBalance = Math.max(openingBalance, accountBalance(state));
  // The engine updates these two running balances separately for each fill.
  const settled = { initialCapital: account.initialCapital, cashAdjustment: account.cashAdjustment,
    realizedPnl: account.realizedPnl, totalFees: account.totalFees };
  for (const fill of fills) {
    settled.realizedPnl += fill.realizedPnl;
    settled.totalFees += fill.fee;
    peakBalance = Math.max(peakBalance, accountBalance(settled));
  }
  if (progress && peakBalance <= Math.max(0, openingBalance)) return;
  // Clamping and rounding are monotonic, so only the opening and peak need conversion.
  const { opening, peak } = await roundHeldBalancesMinor(tx, openingBalance, peakBalance);
  if (progress && peak === opening) return;
  const otherFunds = await readUserFundsMinor(tx, allocation.userId, account.projectionId);
  if (otherFunds === null) return;
  await recordFundPeak(tx, allocation.userId, progress?.best, otherFunds + opening, otherFunds + peak);
}

export function pendingFundBaselines(db: Pick<Prisma.TransactionClient, "$queryRaw">, limit: number) {
  return db.$queryRaw<Array<{ userId: string }>>`
    SELECT w.userId FROM UserWallet w
    WHERE NOT EXISTS (
      SELECT 1 FROM UserAchievementProgress p
      WHERE p.userId = w.userId AND p.metricKey = ${fundsMetric} AND p.generation = ${fundsFingerprint} AND p.scopeKey = ''
    ) ORDER BY w.userId LIMIT ${limit}`;
}

export async function captureFundBaseline(tx: Prisma.TransactionClient, userId: string) {
  // A settlement or another worker may have observed this profile since selection.
  if (await readFundMilestones(tx, userId)) return;
  const total = await readUserFundsMinor(tx, userId);
  if (total !== null) await recordFundPeak(tx, userId, undefined, total, total);
}
