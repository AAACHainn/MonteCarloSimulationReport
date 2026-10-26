import { accountBalance } from "@/lib/paper-trading/account-funds";
import { prisma } from "@/lib/db";
import { moneyValue, requireWallet } from "./service";

const clampPage = (n: number, total: number) => Math.min(Math.max(1, Number.isFinite(n) ? Math.floor(n) : 1), Math.max(1, Math.ceil(total / 20)));
export async function readUserWallet(userId: string, requestedPage = 1, requestedAccountsPage = 1) {
  return prisma.$transaction(async tx => {
    const wallet = await requireWallet(tx, userId);
    const total = await tx.userWalletEntry.count({ where: { userId } });
    const accountsTotal = await tx.userWalletAllocation.count({ where: { userId, settledAt: null } });
    const page = clampPage(requestedPage, total), accountsPage = clampPage(requestedAccountsPage, accountsTotal);
    const [entries, allocations, sums] = await Promise.all([
      tx.userWalletEntry.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 20 }),
      tx.userWalletAllocation.findMany({ where: { userId, settledAt: null }, orderBy: [{ createdAt: "desc" }, { projectionId: "desc" }], skip: (accountsPage - 1) * 20, take: 20 }),
      tx.$queryRaw<Array<{ value: number | bigint | null }>>`SELECT COALESCE(SUM(MAX(0, ROUND((p.initialCapital+p.realizedPnl-p.totalFees+p.cashAdjustment)*100))),0) AS value FROM UserWalletAllocation a JOIN PaperTradingSession p ON p.projectionId=a.projectionId WHERE a.userId=${userId} AND a.settledAt IS NULL`,
    ]);
    const accounts = allocations.length ? await tx.paperTradingSession.findMany({ where: { projectionId: { in: allocations.map(row => row.projectionId) } }, select: { projectionId: true, initialCapital: true, cashAdjustment: true, realizedPnl: true, totalFees: true } }) : [];
    const sessions = allocations.length ? await tx.replaySession.findMany({ where: { id: { in: allocations.map(row => row.sessionId) } }, select: { id: true, name: true, datasetId: true, status: true } }) : [];
    return { available: moneyValue(wallet.balanceMinor), held: moneyValue(BigInt(sums[0].value ?? 0)), version: wallet.version,
      entries: entries.map(row => ({ id: row.id, type: row.type, amount: moneyValue(row.amountMinor), after: moneyValue(row.balanceAfterMinor), sessionId: row.sessionId, sessionName: row.sessionName, roundNumber: row.roundNumber, time: row.createdAt.toISOString() })), total, page, pageSize: 20,
      accounts: allocations.map(row => { const account = accounts.find(item => item.projectionId === row.projectionId), session = sessions.find(item => item.id === row.sessionId); return { id: row.projectionId, sessionId: row.sessionId, name: session?.name ?? row.sessionName, datasetId: session?.datasetId, status: session?.status, withdrawn: moneyValue(row.withdrawnMinor), deposited: moneyValue(row.depositedMinor), balance: account ? Math.round(accountBalance(account) * 100) / 100 : 0 }; }), accountsTotal, accountsPage };
  });
}
export type UserWalletView = Awaited<ReturnType<typeof readUserWallet>>;
