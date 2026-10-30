import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID: uuid } = await import("node:crypto");
  return { prisma: createDatabaseClient({ datasourceUrl: `file:${join(tmpdir(), `user-wallet-${uuid()}.db`)}` }, { allowCreate: true }) };
});

import { prisma } from "@/lib/db";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { createReplaySession } from "@/lib/replay-sessions/service";
import {
  chargePropActivation,
  chargePropPurchase,
  creditPropPayout,
  fundStandardAccount,
  initializeWallet,
  settleStandardAccount,
  writeWalletEntry,
  type WalletOwner,
} from "./service";

let databaseFile = "";
let userNumber = 0;

beforeAll(async () => {
  databaseFile = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/database/init-sqlite.mjs"], {
    env: { ...process.env, DATABASE_URL: `file:${databaseFile}` },
    stdio: "pipe",
  });
  await prisma.marketDataset.create({ data: {
    id: "wallet-dataset", name: "Wallet isolated fixture", symbol: "TEST", timeframe: "1m", timezone: "UTC",
    sourceIntervalSeconds: 60, barCount: 1, startTime: new Date("2026-10-01T00:00:00Z"), endTime: new Date("2026-10-01T00:00:00Z"),
  } });
  await prisma.marketBar.create({ data: {
    datasetId: "wallet-dataset", sequence: 0, timestamp: new Date("2026-10-01T00:00:00Z"),
    open: 100, high: 101, low: 99, close: 100,
  } });
}, 30000);

afterAll(async () => {
  await prisma.$disconnect();
  if (databaseFile.includes("user-wallet-")) rmSync(databaseFile, { force: true });
});

async function makeUser() {
  const profile = await prisma.userProfile.create({ data: { nickname: `钱包测试${++userNumber}` } });
  await sqliteWriteTransaction(prisma, tx => initializeWallet(tx, profile.id));
  return profile;
}

const trainingOwner = (id: string, userId: string | null = id): WalletOwner => ({ id, name: `会话-${id}`, mode: "TRAINING", userId });
const ledgerBalance = async (userId: string) => (await prisma.userWalletEntry.aggregate({ where: { userId }, _sum: { amountMinor: true } }))._sum.amountMinor ?? BigInt(0);
const wallet = async (userId: string) => prisma.userWallet.findUniqueOrThrow({ where: { userId } });
async function makePaperSession(initialCapital: number, userId: string) {
  const replay = await createReplaySession("wallet-dataset", {
    name: `钱包会话-${randomUUID()}`, userId, mode: "TRAINING", timestamp: "2026-10-01T00:00:00Z",
    playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH",
  });
  const account = await prisma.paperTradingSession.create({ data: {
    datasetId: "wallet-dataset", projectionId: replay.activeProjectionId, initialCapital, currency: "USDT",
    lastProcessedSequence: 0, peakEquity: initialCapital,
  } });
  return { replay, account, projectionId: replay.activeProjectionId! };
}

describe("user wallet service with isolated SQLite", () => {
  it("initializes each owner once and never replenishes a zero balance", async () => {
    const user = await makeUser();
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(1_000_000) });
    await sqliteWriteTransaction(prisma, tx => writeWalletEntry(tx, {
      userId: user.id, sourceKey: `TEST-SPEND:${user.id}`, type: "PURCHASE", amountMinor: BigInt(-1_000_000),
    }));
    await sqliteWriteTransaction(prisma, tx => initializeWallet(tx, user.id));
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(0) });
    expect(await prisma.userWalletEntry.count({ where: { userId: user.id, type: "INITIAL" } })).toBe(1);
    expect(await ledgerBalance(user.id)).toBe(BigInt(0));
  });

  it("deduplicates retries and concurrent identical source keys without double credit", async () => {
    const user = await makeUser();
    const input = { userId: user.id, sourceKey: `PAYOUT:retry:${user.id}`, type: "PAYOUT", amountMinor: BigInt(125_075) };
    await Promise.all([0, 1].map(() => sqliteWriteTransaction(prisma, tx => writeWalletEntry(tx, input))));
    await sqliteWriteTransaction(prisma, tx => writeWalletEntry(tx, input));
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(1_125_075) });
    expect(await prisma.userWalletEntry.count({ where: { sourceKey: input.sourceKey } })).toBe(1);
    expect(await ledgerBalance(user.id)).toBe(BigInt(1_125_075));
  });

  it("reserves a standard account deposit and returns only its realized net amount once flat", async () => {
    const user = await makeUser();
    const { replay, account, projectionId } = await makePaperSession(4000, user.id);
    await prisma.paperTradingSession.update({ where: { id: account.id }, data: { realizedPnl: 250, totalFees: 50 } });
    const owner = trainingOwner(replay.id, user.id);
    await sqliteWriteTransaction(prisma, tx => fundStandardAccount(tx, owner, projectionId, 4000));
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(600_000) });

    const settled = await sqliteWriteTransaction(prisma, tx => settleStandardAccount(tx, owner, projectionId));
    expect(settled).toMatchObject({ amount: BigInt(420_000), blocked: false });
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(1_020_000) });
    await sqliteWriteTransaction(prisma, tx => settleStandardAccount(tx, owner, projectionId));
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(1_020_000) });
    expect(await ledgerBalance(user.id)).toBe(BigInt(1_020_000));
    expect(await prisma.userWalletEntry.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { type: true, amountMinor: true } })).toEqual([
      { type: "INITIAL", amountMinor: BigInt(1_000_000) },
      { type: "DEPOSIT", amountMinor: BigInt(-400_000) },
      { type: "WITHDRAWAL", amountMinor: BigInt(420_000) },
    ]);
  });

  it("blocks standard withdrawals while a position or pending order exists, without partial settlement", async () => {
    const user = await makeUser();
    const { replay, account, projectionId } = await makePaperSession(1000, user.id);
    await prisma.paperTradingSession.update({ where: { id: account.id }, data: { netQuantity: 1 } });
    const session = await prisma.paperTradingSession.findUniqueOrThrow({ where: { id: account.id } });
    const owner = trainingOwner(replay.id, user.id);
    await sqliteWriteTransaction(prisma, tx => fundStandardAccount(tx, owner, projectionId, 1000));
    await expect(sqliteWriteTransaction(prisma, tx => settleStandardAccount(tx, owner, projectionId))).rejects.toMatchObject({ code: "WALLET_NOT_FLAT" });
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(900_000) });
    expect(await prisma.userWalletEntry.count({ where: { userId: user.id, type: "WITHDRAWAL" } })).toBe(0);

    await prisma.paperTradingSession.update({ where: { id: session.id }, data: { netQuantity: 0 } });
    await prisma.paperOrder.create({ data: {
      sessionId: session.id, side: "BUY", type: "LIMIT", status: "PENDING", quantity: 1,
      createdSequence: 0, activeFromSequence: 1,
    } });
    await expect(sqliteWriteTransaction(prisma, tx => settleStandardAccount(tx, owner, projectionId))).rejects.toMatchObject({ code: "WALLET_NOT_FLAT" });
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(900_000) });
  });

  it("returns less than deposited principal when a standard account closes at a net loss", async () => {
    const user = await makeUser();
    const { replay, projectionId } = await makePaperSession(2000, user.id);
    await prisma.paperTradingSession.update({ where: { projectionId }, data: { realizedPnl: -700, totalFees: 100 } });
    const owner = trainingOwner(replay.id, user.id);
    await sqliteWriteTransaction(prisma, tx => fundStandardAccount(tx, owner, projectionId, 2000));
    const result = await sqliteWriteTransaction(prisma, tx => settleStandardAccount(tx, owner, projectionId));
    expect(result?.amount).toBe(BigInt(120_000));
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(920_000) });
    expect(await ledgerBalance(user.id)).toBe(BigInt(920_000));
  });

  it("charges only the purchase amount after checking purchase plus activation and charges each round again", async () => {
    const user = await makeUser();
    const owner = trainingOwner("prop-purchase", user.id);
    await sqliteWriteTransaction(prisma, tx => chargePropPurchase(tx, owner, 1, { purchaseCost: 9800, activationCost: 200 }));
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(20_000) });
    await sqliteWriteTransaction(prisma, tx => chargePropActivation(tx, owner, 1, 200));
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(0) });
    await expect(sqliteWriteTransaction(prisma, tx => chargePropPurchase(tx, owner, 2, { purchaseCost: 1, activationCost: 1 }))).rejects.toMatchObject({ code: "WALLET_INSUFFICIENT" });
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(0) });

    const second = await makeUser();
    const secondOwner = trainingOwner("prop-rounds", second.id);
    await sqliteWriteTransaction(prisma, tx => chargePropPurchase(tx, secondOwner, 1, { purchaseCost: 100, activationCost: 50 }));
    await sqliteWriteTransaction(prisma, tx => chargePropPurchase(tx, secondOwner, 2, { purchaseCost: 100, activationCost: 50 }));
    expect(await wallet(second.id)).toMatchObject({ balanceMinor: BigInt(980_000) });
    expect(await prisma.userWalletEntry.count({ where: { userId: second.id, type: "PURCHASE" } })).toBe(2);
  });

  it("rolls back an activation charge when available balance is insufficient", async () => {
    const user = await makeUser();
    const owner = trainingOwner("prop-activation", user.id);
    await sqliteWriteTransaction(prisma, tx => chargePropPurchase(tx, owner, 1, { purchaseCost: 9990, activationCost: 10 }));
    await sqliteWriteTransaction(prisma, tx => writeWalletEntry(tx, {
      userId: user.id, sourceKey: `TEST-OTHER-SPEND:${user.id}`, type: "PURCHASE", amountMinor: BigInt(-900),
    }));
    await expect(sqliteWriteTransaction(prisma, tx => chargePropActivation(tx, owner, 1, 10))).rejects.toMatchObject({ code: "WALLET_INSUFFICIENT" });
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(100) });
    expect(await prisma.userWalletEntry.count({ where: { userId: user.id, type: "ACTIVATION" } })).toBe(0);
    expect(await ledgerBalance(user.id)).toBe(BigInt(100));
  });

  it("credits only actual payout received and keeps ledger evidence after session records are removed", async () => {
    const user = await makeUser();
    const owner = trainingOwner("prop-payout-session", user.id);
    await sqliteWriteTransaction(prisma, tx => creditPropPayout(tx, owner, { id: "payout-record", received: 321.45, roundNumber: 2 }));
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(1_032_145) });
    const payoutEntry = await prisma.userWalletEntry.findUniqueOrThrow({ where: { sourceKey: "PAYOUT:payout-record" } });
    expect(payoutEntry.amountMinor).toBe(BigInt(32_145));

    const { replay, account, projectionId } = await makePaperSession(100, user.id);
    const session = await prisma.paperTradingSession.findUniqueOrThrow({ where: { id: account.id } });
    await sqliteWriteTransaction(prisma, tx => fundStandardAccount(tx, trainingOwner(replay.id, user.id), projectionId, 100));
    await prisma.paperTradingSession.delete({ where: { id: session.id } });
    expect(await prisma.userWalletEntry.findUnique({ where: { id: payoutEntry.id } })).not.toBeNull();
    expect(await prisma.userWalletAllocation.findUnique({ where: { projectionId } })).toMatchObject({ sessionId: replay.id, userId: user.id });
  });

  it("does not manage unassigned, ALL_USERS, or live replay owners", async () => {
    const user = await makeUser();
    const owners: WalletOwner[] = [
      { id: "unassigned", name: "未归属", mode: "TRAINING", userId: null },
      { id: "live-replay", name: "实盘重演", mode: "LIVE_REPLAY", userId: user.id },
    ];
    for (const owner of owners) {
      await sqliteWriteTransaction(prisma, tx => fundStandardAccount(tx, owner, randomUUID(), 5000));
      await sqliteWriteTransaction(prisma, tx => chargePropPurchase(tx, owner, 1, { purchaseCost: 100, activationCost: 50 }));
      await sqliteWriteTransaction(prisma, tx => chargePropActivation(tx, owner, 1, 50));
      await sqliteWriteTransaction(prisma, tx => creditPropPayout(tx, owner, { id: `payout-${owner.id}`, received: 100, roundNumber: 1 }));
    }
    expect(await wallet(user.id)).toMatchObject({ balanceMinor: BigInt(1_000_000) });
    expect(await prisma.userWalletEntry.count({ where: { userId: user.id, type: { in: ["DEPOSIT", "PURCHASE", "ACTIVATION", "PAYOUT"] } } })).toBe(0);
    expect(await prisma.userWalletAllocation.count({ where: { userId: user.id } })).toBe(0);
  });
});
