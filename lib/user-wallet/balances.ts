import { Prisma } from "@prisma/client";

const heldMinorSql = (balance: Prisma.Sql) => Prisma.sql`MAX(0, ROUND((${balance}) * 100))`;

/** Use the same SQLite rounding as the profile for unpersisted fill balances. */
export async function roundHeldBalancesMinor(tx: Prisma.TransactionClient, opening: number, peak: number) {
  const [row] = await tx.$queryRaw<Array<{ opening: number | bigint; peak: number | bigint }>>`
    SELECT ${heldMinorSql(Prisma.sql`${opening}`)} AS opening, ${heldMinorSql(Prisma.sql`${peak}`)} AS peak`;
  return { opening: BigInt(row.opening), peak: BigInt(row.peak) };
}

/** The held amount shown on the profile, in minor units. */
export async function readHeldBalanceMinor(tx: Prisma.TransactionClient, userId: string, excludingProjection?: string) {
  const balance = Prisma.sql`p.initialCapital + p.realizedPnl - p.totalFees + p.cashAdjustment`;
  const [row] = await tx.$queryRaw<Array<{ value: number | bigint }>>`
    SELECT COALESCE(SUM(${heldMinorSql(balance)}), 0) AS value
    FROM UserWalletAllocation a JOIN PaperTradingSession p ON p.projectionId = a.projectionId
    WHERE a.userId = ${userId} AND a.settledAt IS NULL
      ${excludingProjection ? Prisma.sql`AND a.projectionId <> ${excludingProjection}` : Prisma.empty}`;
  return BigInt(row.value);
}

export async function readUserFundsMinor(tx: Prisma.TransactionClient, userId: string, excludingProjection?: string) {
  const wallet = await tx.userWallet.findUnique({ where: { userId }, select: { balanceMinor: true } });
  return wallet ? wallet.balanceMinor + await readHeldBalanceMinor(tx, userId, excludingProjection) : null;
}
