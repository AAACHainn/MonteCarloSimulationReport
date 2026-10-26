import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID: uuid } = await import("node:crypto");
  return { prisma: createDatabaseClient({ datasourceUrl: `file:${join(tmpdir(), `user-wallet-lifecycle-${uuid()}.db`)}` }, { allowCreate: true }) };
});

import { prisma } from "@/lib/db";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { saveProfile } from "@/lib/user-growth/service";
import { createReplaySession, restartReplaySession } from "@/lib/replay-sessions/service";
import { loadReplayScope, runWithReplayScope } from "@/lib/replay-sessions/scope";
import { defaultPropRules, type PropRules } from "@/lib/prop-practice/rules";
import { savePropTemplate, confirmPropPromotion, confirmPropPayout } from "@/lib/prop-practice/service";
import { writeWalletEntry } from "./service";
import { POST as paperAccountPOST } from "@/app/api/market-datasets/[id]/paper-session/route";
import { GET as walletPreviewGET, POST as walletWithdrawPOST } from "@/app/api/replay-sessions/[sessionId]/wallet/route";
import { GET as userWalletGET } from "@/app/api/users/[userId]/wallet/route";
import { DELETE as sessionDELETE } from "@/app/api/replay-sessions/[sessionId]/route";
import { DELETE as datasetDELETE } from "@/app/api/market-datasets/[id]/route";
import { POST as propResetPOST } from "@/app/api/replay-sessions/[sessionId]/prop-practice/reset/route";

let databaseFile = "";
let userNumber = 0;
const datasetId = "wallet-lifecycle";
const times = ["2026-10-01T23:58:00Z", "2026-10-01T23:59:00Z", "2026-10-02T00:00:00Z", "2026-10-02T00:01:00Z", "2026-10-02T23:59:00Z", "2026-10-03T00:00:00Z", "2026-10-03T23:59:00Z", "2026-10-04T00:00:00Z"];

beforeAll(async () => {
  databaseFile = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${databaseFile}` }, stdio: "pipe" });
  await prisma.marketDataset.create({ data: {
    id: datasetId, name: "Wallet lifecycle fixture", symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60,
    barCount: times.length, startTime: new Date(times[0]), endTime: new Date(times.at(-1)!),
  } });
  await prisma.marketBar.createMany({ data: times.map((timestamp, sequence) => ({
    datasetId, sequence, timestamp: new Date(timestamp), open: 100 + sequence * 10, high: 115 + sequence * 10,
    low: 95 + sequence * 10, close: 110 + sequence * 10,
  })) });
}, 30000);

afterAll(async () => {
  await prisma.$disconnect();
  if (databaseFile.includes("user-wallet-lifecycle-")) rmSync(databaseFile, { force: true });
});

const context = { params: Promise.resolve({ id: datasetId }) };
function datasetContext(id: string) { return { params: Promise.resolve({ id }) }; }
const config = { initialCapital: 1000, currency: "USDT", commissionBps: 0, slippageBps: 0 };
type Session = Awaited<ReturnType<typeof createReplaySession>>;
function apiRequest(session: Session, method: string, body?: unknown) {
  return new Request(`http://localhost/api/test?replaySessionId=${session.id}`, {
    method, headers: { "Content-Type": "application/json", "X-Replay-Projection": session.activeProjectionId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function makeUser() {
  const profile = await saveProfile({ nickname: `生命周期钱包${++userNumber}` });
  return profile;
}
async function createStandard(userId: string, capital = 1000, marketId = datasetId) {
  const session = await createReplaySession(marketId, {
    name: `标准钱包会话-${randomUUID()}`, mode: "TRAINING", userId, timestamp: times[0],
    playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH",
  });
  const response = await paperAccountPOST(apiRequest(session, "POST", { ...config, initialCapital: capital }), datasetContext(marketId));
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return session;
}
function propRules(purchaseCost = 0, activationCost = 0): PropRules {
  const rules = structuredClone(defaultPropRules);
  rules.name = "Wallet lifecycle rules";
  rules.purchaseCost = purchaseCost;
  rules.activationCost = activationCost;
  rules.evaluation.risk = { initialCapital: 1000, drawdown: 900, mode: "STATIC", capOffset: null };
  rules.funded.risk = { ...rules.evaluation.risk };
  rules.evaluation.target = 1;
  rules.evaluation.minTradingDays = null;
  rules.evaluation.consistency = null;
  rules.funded.qualifyingDays = null;
  rules.payout = { minimum: 1, fraction: 1, maximum: null, buffer: null, traderShare: 0.9, permanentFloorOffset: null };
  return rules;
}
async function createProp(userId: string, purchaseCost = 0, activationCost = 0, marketId = datasetId) {
  const template = await savePropTemplate(propRules(purchaseCost, activationCost));
  return createReplaySession(marketId, {
    name: `自营钱包会话-${randomUUID()}`, mode: "TRAINING", userId, timestamp: times[0],
    playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH", accountCategory: "PROP_PRACTICE",
    propTemplateVersionId: template.versions[0].id, propAccountConfig: { currency: "USDT", commissionBps: 0, slippageBps: 0 },
  });
}
async function seedPromotableProp(sessionId: string) {
  const scope = await loadReplayScope(sessionId);
  await prisma.replayProgress.update({ where: { replaySessionId: sessionId }, data: { currentSequence: 0 } });
  await prisma.paperTradingSession.update({ where: { projectionId: scope.projectionId }, data: { lastProcessedSequence: 0, realizedPnl: 10 } });
  const row = await prisma.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: sessionId } });
  const state = JSON.parse(row.state);
  state.stages[0].days = [{ day: "2026-10-01T00:00:00.000Z", startRawNet: 0, endRawNet: 10, balance: 1010, traded: true, settled: true }];
  state.last = { sequence: 0, day: "2026-10-01T00:00:00.000Z", rawNet: 10, realizedPnl: 10, totalFees: 0, unrealized: 0, flat: true, pending: 0, hadFill: true };
  await prisma.propPracticeAccount.update({ where: { replaySessionId: sessionId }, data: { state: JSON.stringify(state) } });
  return scope;
}
async function seedPayoutReadyProp(sessionId: string) {
  const scope = await loadReplayScope(sessionId);
  await prisma.replayProgress.update({ where: { replaySessionId: sessionId }, data: { currentSequence: 0 } });
  await prisma.paperTradingSession.update({ where: { projectionId: scope.projectionId }, data: { lastProcessedSequence: 0, realizedPnl: 100 } });
  const row = await prisma.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: sessionId } });
  const state = JSON.parse(row.state);
  const stage = state.stages[0];
  Object.assign(stage, { kind: "FUNDED", anchor: 0, initialCapital: 1000, trailingFloor: 100, permanentFloor: null, grossPayout: 0, qualifyingAfterDay: null, days: [] });
  state.phase = "FUNDED";
  state.pause = "NONE";
  state.last = { sequence: 0, day: "2026-10-01T00:00:00.000Z", rawNet: 100, realizedPnl: 100, totalFees: 0, unrealized: 0, flat: true, pending: 0, hadFill: true };
  await prisma.propPracticeAccount.update({ where: { replaySessionId: sessionId }, data: { state: JSON.stringify(state) } });
  return scope;
}
async function ownerWallet(userId: string) { return prisma.userWallet.findUniqueOrThrow({ where: { userId } }); }

describe("wallet lifecycle APIs with isolated SQLite", () => {
  it("creates a standard training account only within available balance and exposes held funds in user wallet", async () => {
    const user = await makeUser();
    const response = await userWalletGET(new Request("http://localhost/api/test"), { params: Promise.resolve({ userId: user.id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ available: 10_000, held: 0 });

    const session = await createStandard(user.id, 7000);
    expect(await ownerWallet(user.id)).toMatchObject({ balanceMinor: BigInt(300_000) });
    const allocation = await prisma.userWalletAllocation.findUniqueOrThrow({ where: { projectionId: session.activeProjectionId } });
    expect(allocation).toMatchObject({ userId: user.id, depositedMinor: BigInt(700_000), settledAt: null });
    const view = await userWalletGET(new Request("http://localhost/api/test"), { params: Promise.resolve({ userId: user.id }) });
    expect(await view.json()).toMatchObject({ available: 3000, held: 7000, accountsTotal: 1 });

    const poor = await makeUser();
    const outOfBounds = await createReplaySession(datasetId, { name: "Too large", mode: "TRAINING", userId: poor.id, timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    const rejected = await paperAccountPOST(apiRequest(outOfBounds, "POST", { ...config, initialCapital: 10_001 }), context);
    expect(rejected.status).toBe(409);
    expect(await prisma.paperTradingSession.findUnique({ where: { projectionId: outOfBounds.activeProjectionId } })).toBeNull();
    expect(await ownerWallet(poor.id)).toMatchObject({ balanceMinor: BigInt(1_000_000) });
  });

  it("withdraws a standard account in full, archives it, and keeps the same projection settled", async () => {
    const user = await makeUser();
    const session = await createStandard(user.id, 3000);
    const current = await loadReplayScope(session.id);
    const previewResponse = await walletPreviewGET(new Request(`http://localhost/api/test?replaySessionId=${session.id}`), { params: Promise.resolve({ sessionId: session.id }) });
    expect(await previewResponse.json()).toMatchObject({ kind: "WITHDRAW", amount: 3000, blocked: false });
    const response = await walletWithdrawPOST(new Request("http://localhost/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: current.version, requestId: randomUUID() }) }), { params: Promise.resolve({ sessionId: session.id }) });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, amount: 3000 });
    expect(await ownerWallet(user.id)).toMatchObject({ balanceMinor: BigInt(1_000_000) });
    expect(await prisma.userWalletAllocation.findUniqueOrThrow({ where: { projectionId: session.activeProjectionId } })).toMatchObject({ withdrawnMinor: BigInt(300_000), settledAt: expect.any(Date) });
    expect(await prisma.userWalletEntry.count({ where: { userId: user.id, type: "WITHDRAWAL" } })).toBe(1);
    expect(await prisma.replaySession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ status: "ARCHIVED" });
  });

  it("rolls back wallet settlement and ledger writes when the withdrawal or session delete fails", async () => {
    const user = await makeUser();
    const session = await createStandard(user.id, 1000);
    const scope = await loadReplayScope(session.id);
    const settlement = { kind: "WITHDRAW", amount: 1000, requestId: randomUUID() } as const;
    await prisma.$executeRawUnsafe("CREATE TRIGGER reject_wallet_withdrawal BEFORE INSERT ON UserWalletEntry WHEN NEW.type='WITHDRAWAL' BEGIN SELECT RAISE(ABORT, 'wallet ledger failure'); END");
    try {
      const failedLedger = await sessionDELETE(new Request("http://localhost", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: scope.version, settlement }) }), { params: Promise.resolve({ sessionId: session.id }) });
      expect(failedLedger.status).toBe(500);
    } finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_wallet_withdrawal"); }
    expect(await ownerWallet(user.id)).toMatchObject({ balanceMinor: BigInt(900_000) });
    expect(await prisma.userWalletAllocation.findUniqueOrThrow({ where: { projectionId: session.activeProjectionId } })).toMatchObject({ settledAt: null, withdrawnMinor: BigInt(0) });
    expect(await prisma.replaySession.findUnique({ where: { id: session.id } })).not.toBeNull();

    await prisma.$executeRawUnsafe("CREATE TRIGGER reject_replay_delete BEFORE DELETE ON ReplaySession BEGIN SELECT RAISE(ABORT, 'session delete failure'); END");
    try {
      const failedDelete = await sessionDELETE(new Request("http://localhost", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: scope.version, settlement }) }), { params: Promise.resolve({ sessionId: session.id }) });
      expect(failedDelete.status).toBe(500);
    } finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_replay_delete"); }
    expect(await ownerWallet(user.id)).toMatchObject({ balanceMinor: BigInt(900_000) });
    expect(await prisma.userWalletEntry.count({ where: { userId: user.id, type: "WITHDRAWAL" } })).toBe(0);
    expect(await prisma.userWalletAllocation.findUniqueOrThrow({ where: { projectionId: session.activeProjectionId } })).toMatchObject({ settledAt: null, withdrawnMinor: BigInt(0) });
    expect(await prisma.replaySession.findUnique({ where: { id: session.id } })).not.toBeNull();
  });

  it("restarts a standard account atomically and rolls back old settlement when new capital cannot be afforded", async () => {
    const fundedUser = await makeUser();
    const funded = await createStandard(fundedUser.id, 3000);
    const next = await runWithReplayScope(await loadReplayScope(funded.id), () => restartReplaySession());
    expect(await ownerWallet(fundedUser.id)).toMatchObject({ balanceMinor: BigInt(700_000) });
    expect(await prisma.userWalletAllocation.findUniqueOrThrow({ where: { projectionId: funded.activeProjectionId } })).toMatchObject({ settledAt: expect.any(Date), withdrawnMinor: BigInt(300_000) });
    expect(await prisma.userWalletAllocation.findUniqueOrThrow({ where: { projectionId: next.activeProjectionId } })).toMatchObject({ settledAt: null, depositedMinor: BigInt(300_000) });

    const constrainedUser = await makeUser();
    const existing = await createStandard(constrainedUser.id, 7000);
    await prisma.paperTradingSession.update({ where: { projectionId: existing.activeProjectionId }, data: { realizedPnl: -500, totalFees: 0 } });
    await sqliteWriteTransaction(prisma, tx => writeWalletEntry(tx, { userId: constrainedUser.id, sourceKey: `TEST-SPEND:${constrainedUser.id}`, type: "PURCHASE", amountMinor: BigInt(-300_000) }));
    await expect(runWithReplayScope(await loadReplayScope(existing.id), () => restartReplaySession())).rejects.toMatchObject({ code: "WALLET_INSUFFICIENT" });
    expect(await ownerWallet(constrainedUser.id)).toMatchObject({ balanceMinor: BigInt(0) });
    expect(await prisma.userWalletAllocation.findUniqueOrThrow({ where: { projectionId: existing.activeProjectionId } })).toMatchObject({ settledAt: null, withdrawnMinor: BigInt(0) });
    expect(await prisma.replaySession.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ status: "ACTIVE", activeProjectionId: existing.activeProjectionId });
    expect(await prisma.replaySession.count({ where: { userId: constrainedUser.id } })).toBe(1);
  });

  it("charges prop purchase on initialization and every reset, with insufficient reset rolling back", async () => {
    const user = await makeUser();
    const session = await createProp(user.id, 250, 0);
    expect(await ownerWallet(user.id)).toMatchObject({ balanceMinor: BigInt(975_000) });
    const prop = await prisma.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: session.id } });
    const state = JSON.parse(prop.state);
    state.result = "FAILED";
    state.last = { sequence: -1, day: "2026-10-01T00:00:00.000Z", rawNet: 0, realizedPnl: 0, totalFees: 0, unrealized: 0, flat: true, pending: 0, hadFill: false };
    await prisma.propPracticeAccount.update({ where: { replaySessionId: session.id }, data: { state: JSON.stringify(state) } });
    const scope = await loadReplayScope(session.id);
    const requestId = randomUUID();
    const response = await propResetPOST(new Request("http://localhost/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: scope.version, expectedProjectionId: scope.projectionId, requestId }) }), { params: Promise.resolve({ sessionId: session.id }) });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(await ownerWallet(user.id)).toMatchObject({ balanceMinor: BigInt(950_000) });
    expect(await prisma.userWalletEntry.count({ where: { userId: user.id, type: "PURCHASE" } })).toBe(2);

    const limited = await makeUser();
    const limitedSession = await createProp(limited.id, 6000, 0);
    await sqliteWriteTransaction(prisma, tx => writeWalletEntry(tx, { userId: limited.id, sourceKey: `TEST-SPEND:${limited.id}`, type: "PURCHASE", amountMinor: BigInt(-400_000) }));
    const limitedProp = await prisma.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: limitedSession.id } });
    const failed = JSON.parse(limitedProp.state);
    failed.result = "FAILED";
    failed.last = { sequence: -1, day: "2026-10-01T00:00:00.000Z", rawNet: 0, realizedPnl: 0, totalFees: 0, unrealized: 0, flat: true, pending: 0, hadFill: false };
    await prisma.propPracticeAccount.update({ where: { replaySessionId: limitedSession.id }, data: { state: JSON.stringify(failed) } });
    const limitedScope = await loadReplayScope(limitedSession.id);
    const blocked = await propResetPOST(new Request("http://localhost/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: limitedScope.version, expectedProjectionId: limitedScope.projectionId, requestId: randomUUID() }) }), { params: Promise.resolve({ sessionId: limitedSession.id }) });
    expect(blocked.status).toBe(409);
    expect(await ownerWallet(limited.id)).toMatchObject({ balanceMinor: BigInt(0) });
    expect(await prisma.propPracticeRound.count({ where: { replaySessionId: limitedSession.id } })).toBe(1);
    expect(await prisma.replaySession.findUniqueOrThrow({ where: { id: limitedSession.id } })).toMatchObject({ activeProjectionId: limitedSession.activeProjectionId, version: limitedScope.version });
  });

  it("deducts activation only on successful evaluation promotion and rolls failed activation back", async () => {
    const user = await makeUser();
    const session = await createProp(user.id, 100, 300);
    const scope = await seedPromotableProp(session.id);
    await runWithReplayScope(scope, () => confirmPropPromotion({ expectedVersion: scope.version, requestId: randomUUID() }));
    expect(await ownerWallet(user.id)).toMatchObject({ balanceMinor: BigInt(960_000) });
    expect(await prisma.userWalletEntry.count({ where: { userId: user.id, type: "ACTIVATION", amountMinor: BigInt(-30_000) } })).toBe(1);

    const poor = await makeUser();
    const blockedSession = await createProp(poor.id, 100, 300);
    await sqliteWriteTransaction(prisma, tx => writeWalletEntry(tx, { userId: poor.id, sourceKey: `TEST-SPEND:${poor.id}`, type: "PURCHASE", amountMinor: BigInt(-990_000) }));
    const blockedScope = await seedPromotableProp(blockedSession.id);
    await expect(runWithReplayScope(blockedScope, () => confirmPropPromotion({ expectedVersion: blockedScope.version, requestId: randomUUID() }))).rejects.toMatchObject({ code: "WALLET_INSUFFICIENT" });
    expect(await ownerWallet(poor.id)).toMatchObject({ balanceMinor: BigInt(0) });
    expect(await prisma.propPracticeEvent.count({ where: { replaySessionId: blockedSession.id, type: "PROMOTED" } })).toBe(0);
    expect(JSON.parse((await prisma.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: blockedSession.id } })).state).phase).toBe("EVALUATION");
  });

  it("credits only the actual payout received after an eligible funded payout", async () => {
    const user = await makeUser();
    const session = await createProp(user.id, 100, 0);
    const scope = await seedPayoutReadyProp(session.id);
    const payout = await runWithReplayScope(scope, () => confirmPropPayout({ expectedVersion: scope.version, requestId: randomUUID(), amount: 50 }));
    expect(payout).toMatchObject({ amount: 50, received: 45 });
    expect(await ownerWallet(user.id)).toMatchObject({ balanceMinor: BigInt(994_500) });
    expect(await prisma.userWalletEntry.findUniqueOrThrow({ where: { sourceKey: `PAYOUT:${payout.id}` } })).toMatchObject({ type: "PAYOUT", amountMinor: BigInt(4500) });
  });

  it("deletes standard sessions only after exact previewed withdrawal and rejects held positions", async () => {
    const user = await makeUser();
    const session = await createStandard(user.id, 2000);
    const scope = await loadReplayScope(session.id);
    const previewResponse = await walletPreviewGET(new Request("http://localhost"), { params: Promise.resolve({ sessionId: session.id }) });
    const preview = await previewResponse.json();
    expect(preview).toMatchObject({ kind: "WITHDRAW", amount: 2000 });
    const mismatch = await sessionDELETE(new Request("http://localhost", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: scope.version, settlement: { kind: "WITHDRAW", amount: 1999, requestId: randomUUID() } }) }), { params: Promise.resolve({ sessionId: session.id }) });
    expect(mismatch.status).toBe(409);
    expect(await prisma.replaySession.findUnique({ where: { id: session.id } })).not.toBeNull();
    const deleted = await sessionDELETE(new Request("http://localhost", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: scope.version, settlement: { kind: "WITHDRAW", amount: preview.amount, requestId: randomUUID() } }) }), { params: Promise.resolve({ sessionId: session.id }) });
    expect(deleted.status, JSON.stringify(await deleted.clone().json())).toBe(200);
    expect(await prisma.replaySession.findUnique({ where: { id: session.id } })).toBeNull();
    expect(await ownerWallet(user.id)).toMatchObject({ balanceMinor: BigInt(1_000_000) });
    expect(await prisma.userWalletEntry.count({ where: { userId: user.id, type: "WITHDRAWAL", sessionId: session.id } })).toBe(1);

    const heldUser = await makeUser();
    const heldSession = await createStandard(heldUser.id, 500);
    await prisma.paperTradingSession.update({ where: { projectionId: heldSession.activeProjectionId }, data: { netQuantity: 1 } });
    const heldScope = await loadReplayScope(heldSession.id);
    const blockedPreviewResponse = await walletPreviewGET(new Request("http://localhost"), { params: Promise.resolve({ sessionId: heldSession.id }) });
    expect(await blockedPreviewResponse.json()).toMatchObject({ blocked: true });
    const blockedDelete = await sessionDELETE(new Request("http://localhost", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: heldScope.version, settlement: { kind: "WITHDRAW", amount: 500, requestId: randomUUID() } }) }), { params: Promise.resolve({ sessionId: heldSession.id }) });
    expect(blockedDelete.status).toBe(409);
    expect(await prisma.replaySession.findUnique({ where: { id: heldSession.id } })).not.toBeNull();
    expect(await ownerWallet(heldUser.id)).toMatchObject({ balanceMinor: BigInt(950_000) });
  });

  it("uses previewed prop payout on deletion and permits explicit fee-forfeiting delete when ineligible", async () => {
    const user = await makeUser();
    const eligible = await createProp(user.id, 100, 0);
    await seedPayoutReadyProp(eligible.id);
    const previewResponse = await walletPreviewGET(new Request("http://localhost"), { params: Promise.resolve({ sessionId: eligible.id }) });
    const preview = await previewResponse.json();
    expect(preview).toMatchObject({ kind: "PAYOUT", amount: 100, received: 90 });
    const scope = await loadReplayScope(eligible.id);
    const deletion = await sessionDELETE(new Request("http://localhost", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: scope.version, settlement: { kind: "PAYOUT", amount: preview.amount, requestId: randomUUID() } }) }), { params: Promise.resolve({ sessionId: eligible.id }) });
    expect(deletion.status, JSON.stringify(await deletion.clone().json())).toBe(200);
    expect(await prisma.replaySession.findUnique({ where: { id: eligible.id } })).toBeNull();
    expect(await ownerWallet(user.id)).toMatchObject({ balanceMinor: BigInt(999_000) });
    expect(await prisma.userWalletEntry.count({ where: { userId: user.id, type: "PAYOUT", sessionId: eligible.id, amountMinor: BigInt(9000) } })).toBe(1);

    const forfeitedUser = await makeUser();
    const ineligible = await createProp(forfeitedUser.id, 1000, 0);
    const forfeiturePreview = await walletPreviewGET(new Request("http://localhost"), { params: Promise.resolve({ sessionId: ineligible.id }) });
    expect(await forfeiturePreview.json()).toMatchObject({ kind: "FORFEIT", amount: 0, received: 0 });
    const current = await loadReplayScope(ineligible.id);
    const forfeit = await sessionDELETE(new Request("http://localhost", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: current.version, settlement: { kind: "FORFEIT", amount: 0, requestId: randomUUID() } }) }), { params: Promise.resolve({ sessionId: ineligible.id }) });
    expect(forfeit.status).toBe(200);
    expect(await ownerWallet(forfeitedUser.id)).toMatchObject({ balanceMinor: BigInt(900_000) });
    expect(await prisma.userWalletEntry.count({ where: { userId: forfeitedUser.id, type: "PURCHASE" } })).toBe(1);
    expect(await prisma.replaySession.findUnique({ where: { id: ineligible.id } })).toBeNull();
  });

  it("prevents dataset deletion while a standard allocation is unsettled or an owned prop account exists", async () => {
    const standardDataset = `wallet-protected-standard-${randomUUID()}`;
    await prisma.marketDataset.create({ data: {
      id: standardDataset, name: standardDataset, symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60,
      barCount: times.length, startTime: new Date(times[0]), endTime: new Date(times.at(-1)!),
    } });
    await prisma.marketBar.createMany({ data: times.map((timestamp, sequence) => ({ datasetId: standardDataset, sequence, timestamp: new Date(timestamp), open: 100, high: 101, low: 99, close: 100 })) });
    const standardUser = await makeUser();
    const standard = await createStandard(standardUser.id, 100, standardDataset);
    const standardBlocked = await datasetDELETE(new Request("http://localhost", { method: "DELETE" }), datasetContext(standardDataset));
    expect(standardBlocked.status).toBe(409);
    expect(await prisma.marketDataset.findUnique({ where: { id: standardDataset } })).not.toBeNull();
    expect(await prisma.replaySession.findUnique({ where: { id: standard.id } })).not.toBeNull();

    const propDataset = `wallet-protected-prop-${randomUUID()}`;
    await prisma.marketDataset.create({ data: {
      id: propDataset, name: propDataset, symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60,
      barCount: times.length, startTime: new Date(times[0]), endTime: new Date(times.at(-1)!),
    } });
    await prisma.marketBar.createMany({ data: times.map((timestamp, sequence) => ({ datasetId: propDataset, sequence, timestamp: new Date(timestamp), open: 100, high: 101, low: 99, close: 100 })) });
    const propUser = await makeUser();
    const prop = await createProp(propUser.id, 100, 0, propDataset);
    const propBlocked = await datasetDELETE(new Request("http://localhost", { method: "DELETE" }), datasetContext(propDataset));
    expect(propBlocked.status).toBe(409);
    expect(await prisma.marketDataset.findUnique({ where: { id: propDataset } })).not.toBeNull();
    expect(await prisma.replaySession.findUnique({ where: { id: prop.id } })).not.toBeNull();
  });

  it("rounds a half-cent standard settlement once and pages user ledger history", async () => {
    const roundingUser = await makeUser();
    const rounded = await createStandard(roundingUser.id, 10.01);
    await prisma.paperTradingSession.update({ where: { projectionId: rounded.activeProjectionId }, data: { realizedPnl: 0.005 } });
    const scope = await loadReplayScope(rounded.id);
    const previewResponse = await walletPreviewGET(new Request("http://localhost"), { params: Promise.resolve({ sessionId: rounded.id }) });
    expect(await previewResponse.json()).toMatchObject({ kind: "WITHDRAW", amount: 10.02 });
    const withdrawal = await walletWithdrawPOST(new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: scope.version, requestId: randomUUID() }) }), { params: Promise.resolve({ sessionId: rounded.id }) });
    expect(withdrawal.status).toBe(200);
    expect(await ownerWallet(roundingUser.id)).toMatchObject({ balanceMinor: BigInt(1_000_001) });

    const pagedUser = await makeUser();
    for (let index = 0; index < 25; index++) await sqliteWriteTransaction(prisma, tx => writeWalletEntry(tx, {
      userId: pagedUser.id, sourceKey: `PAGE:${pagedUser.id}:${index}`, type: "PAYOUT", amountMinor: BigInt(1),
    }));
    const pageResponse = await userWalletGET(new Request("http://localhost/api/test?page=2"), { params: Promise.resolve({ userId: pagedUser.id }) });
    const page = await pageResponse.json();
    expect(page).toMatchObject({ total: 26, page: 2, pageSize: 20 });
    expect(page.entries).toHaveLength(6);
    const firstPageResponse = await userWalletGET(new Request("http://localhost/api/test?page=1"), { params: Promise.resolve({ userId: pagedUser.id }) });
    const firstPage = await firstPageResponse.json();
    expect(firstPage.entries).toHaveLength(20);
    expect(new Set([...firstPage.entries, ...page.entries].map((entry: { id: string }) => entry.id)).size).toBe(26);
  });
});
