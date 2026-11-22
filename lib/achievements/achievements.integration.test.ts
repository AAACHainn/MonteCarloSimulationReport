import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as discardPreviewRoute } from "@/app/api/admin/achievements/jobs/[jobId]/discard/route";
import { prisma } from "@/lib/db";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { createReplaySession } from "@/lib/replay-sessions/service";
import { loadReplayScope, runWithReplayScope } from "@/lib/replay-sessions/scope";
import { projectionRecordId } from "@/lib/replay-sessions/identity";
import { persistDerivedBatch } from "@/lib/replay-sessions/persistence";
import { saveProfile } from "@/lib/user-growth/service";
import { settleGrowth, sourceKey } from "@/lib/user-growth/settlement";
import { persistTrades } from "@/lib/paper-trading/persist";
import type { PaperFillData, PaperFillReason } from "@/lib/paper-trading/types";
import { serializePaperSession, tradeStatsFromSession } from "@/lib/paper-trading/serialize";
import { achievementStageCount, metricKeys } from "./catalog";
import { createAchievementPreview, discardAchievementPreview, retryAchievementJob, startAchievementJob } from "./jobs";
import { readAchievementDetail, readAchievementNotifications, readAchievements, saveShowcase } from "./read";
import { achievementTick } from "./runtime";
import { ExitReason } from "./exit-evidence";

vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { createSqliteFixture } = await import("@/scripts/database/sqlite-test-fixture");
  return { prisma: createDatabaseClient({ datasourceUrl: `file:${createSqliteFixture("achievements-test")}` }) };
});

const barTime = (sequence: number) => new Date(Date.UTC(2026, 0, 1, 0, sequence));
const datasetId = "achievements-dataset";
let profileNumber = 0;
const profile = () => saveProfile({ nickname: `成就测试${++profileNumber}` });

beforeAll(async () => {
  await prisma.marketDataset.create({ data: { id: datasetId, name: "Fixtures", symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: 1, startTime: barTime(0), endTime: barTime(0) } });
  await prisma.marketBar.create({ data: { datasetId, sequence: 0, timestamp: barTime(0), open: 100, high: 110, low: 90, close: 100 } });
}, 30_000);
afterAll(async () => { await prisma.$disconnect(); });

async function session(userId: string, mode: "TRAINING" | "LIVE_REPLAY" = "TRAINING") {
  return createReplaySession(datasetId, { userId, mode, name: mode, timestamp: barTime(0).toISOString(), playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
}

async function appendFact(id: string, type: "CYCLE" | "PAYOUT", sourceId: string, roundNumber = 0, mask?: number) {
  return sqliteWriteTransaction(prisma, tx => settleGrowth(tx, { type, sourceId, roundNumber, occurredAt: barTime(90), sessionId: id, exitReasonMask: mask }));
}

async function until(id: string, expected: string) {
  for (let iteration = 0; iteration < 150; iteration++) {
    const job = await prisma.achievementJob.findUniqueOrThrow({ where: { id } });
    if (job.status === expected) return job;
    if (job.status === "FAILED") throw new Error(JSON.stringify(job));
    await achievementTick();
  }
  throw new Error(`Achievement job ${id} never reached ${expected}`);
}

const findSeries = (data: Awaited<ReturnType<typeof readAchievements>>, key: string) => data.items.find(row => row.key === key)!;

describe("achievement evidence and projection", () => {
  it("persists cross-transaction mixed exits, true order within a bar, and separate scopes", async () => {
    const user = await profile();
    const s = await session(user.id), other = await session(user.id);
    const scope = await loadReplayScope(s.id);
    const account = await prisma.paperTradingSession.create({ data: { datasetId, projectionId: scope.projectionId, initialCapital: 1000, peakEquity: 1000, lastProcessedSequence: 0, currency: "USDT" } });
    let fillNumber = 0;
    const fill = (reason: PaperFillReason, netQuantityAfter: number, closedQuantity: number): PaperFillData => ({
      id: `fill-${++fillNumber}`, orderId: "fixture", sequence: 42, timestamp: barTime(42).toISOString(),
      side: reason === "ENTRY" ? "BUY" : "SELL", price: 110, quantity: reason === "ENTRY" ? 2 : closedQuantity,
      fee: 0, slippageCost: 0, realizedPnl: 7, closedQuantity, openedQuantity: reason === "ENTRY" ? 2 : 0,
      netQuantityAfter, averagePriceAfter: netQuantityAfter ? 100 : null, reason,
    });
    const persist = (fills: PaperFillData[]) => runWithReplayScope(scope,
      () => sqliteWriteTransaction(prisma, tx => persistTrades(tx, account.id, [], fills, tradeStatsFromSession(account))));
    for (let i = 0; i < 4; i++) await persist([fill("ENTRY", 2, 0), fill("STOP_LOSS", 0, 2)]);
    await persist([fill("ENTRY", 2, 0), fill("TAKE_PROFIT", 1, 1)]);
    await persist([fill("STOP_LOSS", 0, 1)]);
    await appendFact(other.id, "CYCLE", "other", 0, ExitReason.STOP_LOSS);
    await achievementTick();
    const before = await readAchievements(user.id);
    expect(findSeries(before, "stop-loss-streak")).toMatchObject({ highest: 0, best: 4, current: 1 });
    for (let i = 0; i < 5; i++) await persist([fill("ENTRY", 2, 0), fill("STOP_LOSS", 0, 2)]);
    await Promise.all([achievementTick(), achievementTick()]);
    const after = await readAchievements(user.id, s.id);
    expect(findSeries(after, "stop-loss-streak")).toMatchObject({ highest: 1, best: 5, current: 5 });
    expect(findSeries(after, "take-profit-streak").best).toBe(0);
    expect(after.totalStages).toBe(achievementStageCount);
    expect((await readAchievementDetail(user.id, "stop-loss-streak"))[0].source?.replayAt).toBe(barTime(42).toISOString());
    expect((await readAchievementNotifications(user.id, before.latest!.seq)).count).toBe(1);
    await saveShowcase(user.id, ["stop-loss-streak"]);
    expect((await readAchievements(user.id)).showcase).toEqual([{ key: "stop-loss-streak", tier: 1 }]);
    await expect(saveShowcase(user.id, ["take-profit-streak"])).rejects.toMatchObject({ code: "SHOWCASE_LOCKED" });
  });

  it("previews immutable historical facts, resumes and catches up with live payouts exactly once", async () => {
    const user = await profile(), s = await session(user.id);
    // One old profile has enough evidence for 100 cycles, plus 4 payouts from
    // a removed source round. Dates are settlement dates, distinct from chart time.
    const oldCycles = Array.from({ length: 102 }, (_, i) => ({
      userId: user.id, type: "CYCLE", sessionId: "removed-session", roundNumber: 0,
      sourceKey: sourceKey("CYCLE", "removed-session", 0, `legacy-${i}`), sourceSummary: '{"sessionName":"旧会话"}',
      occurredAt: barTime(i), settledAt: new Date(1_770_000_000_000 + i * 1_000), cyclesDelta: 1, ruleVersion: "legacy",
    }));
    await prisma.userGrowthFact.createMany({ data: oldCycles });
    const oldPayouts = Array.from({ length: 4 }, (_, i) => ({
      userId: user.id, type: "PAYOUT", sessionId: s.id, roundNumber: 2, sourceKey: sourceKey("PAYOUT", s.id, 2, `old-payout-${i}`),
      sourceSummary: "{}", occurredAt: barTime(i), settledAt: barTime(i), payoutsDelta: 1, ruleVersion: "legacy",
    }));
    await prisma.userGrowthFact.createMany({ data: oldPayouts });
    expect((await readAchievements(user.id)).unlockedStages).toBe(0);
    const plan = await createAchievementPreview({ userId: user.id, metrics: metricKeys, mode: "BACKFILL" });
    expect((await createAchievementPreview({ userId: user.id, metrics: metricKeys, mode: "BACKFILL" })).id).toBe(plan.id);
    await expect(startAchievementJob(plan.id)).rejects.toMatchObject({ code: "PLAN_NOT_READY" });
    await achievementTick({ allowHistory: false });
    expect((await prisma.achievementJob.findUniqueOrThrow({ where: { id: plan.id } })).phase).toBe("DISCOVER");
    const preview = await until(plan.id, "READY");
    expect(preview.expectedAwards).toBe(4);
    expect(preview.coverageGaps).toBeGreaterThan(0);
    expect((await readAchievements(user.id)).unlockedStages).toBe(0);
    await appendFact(s.id, "PAYOUT", "live-payout", 2);
    await appendFact(s.id, "PAYOUT", "live-payout", 2);
    expect((await startAchievementJob(plan.id)).id).toBe(plan.id);
    expect((await startAchievementJob(plan.id)).id).toBe(plan.id);
    await achievementTick();
    const live = await readAchievements(user.id);
    expect(findSeries(live, "successful-payouts").best).toBe(1);
    const awardIdentity = { userId: user.id, achievementKey: "successful-payouts", tierKey: "tier-1" };
    const liveAward = await prisma.userAchievement.findUniqueOrThrow({ where: { userId_achievementKey_tierKey: awardIdentity } });
    await until(plan.id, "SUCCEEDED");
    const complete = await readAchievements(user.id);
    expect(findSeries(complete, "completed-cycles").best).toBe(102);
    expect(findSeries(complete, "successful-payouts").best).toBe(5);
    expect(findSeries(complete, "payouts-in-round").highest).toBe(2);
    expect(findSeries(complete, "stop-loss-streak").gap).toBe(true);
    expect(complete.unlockedStages).toBe(6);
    const [award] = await readAchievementDetail(user.id, "completed-cycles");
    expect(award.attainedAt).toBe(oldCycles[99].settledAt.toISOString());
    expect(award.source).toMatchObject({ name: "旧会话", href: null });
    const legacyPayout = await prisma.userGrowthFact.findUniqueOrThrow({ where: { sourceKey: oldPayouts[0].sourceKey } });
    expect(await prisma.userAchievement.findUniqueOrThrow({ where: { userId_achievementKey_tierKey: awardIdentity } })).toEqual({
      ...liveAward, attainedAt: legacyPayout.settledAt, growthFactId: legacyPayout.id,
    });
    expect(await readAchievementNotifications(user.id, liveAward.seq)).toMatchObject({ count: 5, historical: 5 });
    const recheck = await createAchievementPreview({ userId: user.id, metrics: ["completed-cycles"], mode: "RECHECK" });
    expect((await until(recheck.id, "READY")).expectedAwards).toBe(0);
    await startAchievementJob(recheck.id);
    expect((await until(recheck.id, "SUCCEEDED")).published).toBe(0);
    expect((await readAchievements(user.id)).unlockedStages).toBe(6);
  });

  it("releases abandoned and expired previews while preserving published progress", async () => {
    const user = await profile(), s = await session(user.id);
    const input = { userId: user.id, metrics: ["completed-cycles"] as ["completed-cycles"], mode: "BACKFILL" as const };
    await appendFact(s.id, "CYCLE", "live-before-preview", 0, ExitReason.STOP_LOSS);
    const whole = await createAchievementPreview({ ...input, userId: null });
    await until(whole.id, "READY");
    await expect(createAchievementPreview(input)).rejects.toMatchObject({ code: "JOB_CONFLICT" });
    expect(await prisma.userAchievementProgress.count({ where: { generation: whole.id } })).toBeGreaterThan(0);
    const response = await discardPreviewRoute(new Request(`http://localhost/api/admin/achievements/jobs/${whole.id}/discard`, {
      method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: "{}",
    }), { params: Promise.resolve({ jobId: whole.id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: whole.id, status: "DISCARDING" });
    expect((await discardAchievementPreview(whole.id)).status).toBe("DISCARDING");
    await expect(startAchievementJob(whole.id)).rejects.toMatchObject({ code: "PLAN_NOT_READY" });
    const obsolete = await createAchievementPreview(input);
    await until(whole.id, "DISCARDED");
    expect(await prisma.userAchievementProgress.count({ where: { generation: whole.id } })).toBe(0);
    await until(obsolete.id, "READY");
    await prisma.achievementJob.update({ where: { id: obsolete.id }, data: { fingerprint: "old" } });
    await expect(startAchievementJob(obsolete.id)).rejects.toMatchObject({ code: "PLAN_EXPIRED" });
    const replacement = await createAchievementPreview(input);
    expect(replacement.id).not.toBe(obsolete.id);
    await until(obsolete.id, "DISCARDED");
    expect(await prisma.userAchievementProgress.count({ where: { generation: obsolete.id } })).toBe(0);
    await until(replacement.id, "READY");
    await startAchievementJob(replacement.id);
    await expect(discardAchievementPreview(replacement.id)).rejects.toMatchObject({ code: "PLAN_NOT_DISCARDABLE" });
    await until(replacement.id, "SUCCEEDED");
    expect(findSeries(await readAchievements(user.id), "first-cycle").highest).toBe(1);
    const publishedScope = { userId: user.id, generation: replacement.id };
    await prisma.achievementJob.update({ where: { id: replacement.id }, data: {
      status: "FAILED", phase: "CATCH_UP", fingerprint: "old", error: "COMMIT_UNVERIFIED",
    } });
    await expect(createAchievementPreview(input)).rejects.toMatchObject({ code: "JOB_CONFLICT" });
    await expect(discardAchievementPreview(replacement.id)).rejects.toMatchObject({ code: "PLAN_NOT_DISCARDABLE" });
    await prisma.achievementJob.update({ where: { id: replacement.id }, data: { error: "PLAN_EXPIRED" } });
    const recovery = await createAchievementPreview(input);
    await until(replacement.id, "DISCARDED");
    expect(await prisma.userAchievementState.findFirst({ where: publishedScope })).toBeTruthy();
    expect(await prisma.userAchievementProgress.count({ where: publishedScope })).toBeGreaterThan(0);
    await discardAchievementPreview(recovery.id);
    await until(recovery.id, "DISCARDED");
  });

  it("verifies old open positions and repairs previously unknown indexed exits during recheck", async () => {
    const user = await profile(), s = await session(user.id);
    const scope = await loadReplayScope(s.id);
    let account = await prisma.paperTradingSession.create({ data: {
      datasetId, projectionId: scope.projectionId, initialCapital: 1000, peakEquity: 1000, lastProcessedSequence: 0, currency: "USDT",
    } });
    async function persist(sequence: number, reason: PaperFillReason, netQuantityAfter: number, quantity: number) {
      const opens = reason === "ENTRY";
      const orderId = `legacy-order-${sequence}`;
      await prisma.paperOrder.create({ data: {
        id: projectionRecordId(scope.projectionId, orderId), sessionId: account.id, side: opens ? "BUY" : "SELL",
        type: "MARKET", quantity, createdSequence: sequence, activeFromSequence: sequence,
      } });
      const fill: PaperFillData = {
        id: `legacy-fill-${sequence}`, orderId, sequence, timestamp: barTime(sequence).toISOString(),
        side: opens ? "BUY" : "SELL", reason, price: 100, quantity, fee: 0, slippageCost: 0, realizedPnl: 0,
        closedQuantity: opens ? 0 : quantity, openedQuantity: opens ? quantity : 0, netQuantityAfter,
        averagePriceAfter: netQuantityAfter ? 100 : null,
      };
      const state = { ...serializePaperSession(account), netQuantity: netQuantityAfter, averageEntryPrice: fill.averagePriceAfter, lastProcessedSequence: sequence };
      account = await runWithReplayScope(scope, () => sqliteWriteTransaction(prisma, tx => persistDerivedBatch(tx, account, 1, {
        state, orders: [], fills: [fill], lots: [], equityPoints: [], entries: [],
      })));
    }
    async function simulateUpgrade() {
      await prisma.paperTrade.updateMany({ where: { sessionId: account.id, status: "OPEN" }, data: { exitReasonMask: null } });
    }
    await persist(1, "ENTRY", 1, 1);
    await simulateUpgrade();
    await persist(2, "STOP_LOSS", 0, 1);
    await persist(3, "ENTRY", 2, 2);
    await persist(4, "TAKE_PROFIT", 1, 1);
    await simulateUpgrade();
    await persist(5, "STOP_LOSS", 0, 1);
    await persist(6, "ENTRY", 1, 1);
    await simulateUpgrade();
    await prisma.paperFill.delete({ where: { id: projectionRecordId(scope.projectionId, "legacy-fill-6") } });
    await persist(7, "STOP_LOSS", 0, 1);
    const facts = await prisma.achievementFact.findMany({ where: { userId: user.id }, orderBy: { seq: "asc" } });
    expect(facts.map(row => row.exitReasonMask)).toEqual([
      ExitReason.STOP_LOSS, ExitReason.TAKE_PROFIT | ExitReason.STOP_LOSS, ExitReason.UNKNOWN | ExitReason.STOP_LOSS,
    ]);
    await prisma.achievementFact.update({ where: { seq: facts[0].seq }, data: { exitReasonMask: ExitReason.UNKNOWN | ExitReason.STOP_LOSS } });
    await achievementTick();
    expect(findSeries(await readAchievements(user.id), "stop-loss-streak")).toMatchObject({ best: 0, gap: true });
    const plan = await createAchievementPreview({ userId: user.id, metrics: ["stop-loss-streak"], mode: "RECHECK" });
    expect((await until(plan.id, "READY")).coverageGaps).toBe(1);
    await startAchievementJob(plan.id);
    await until(plan.id, "SUCCEEDED");
    expect(findSeries(await readAchievements(user.id), "stop-loss-streak")).toMatchObject({ best: 1, current: 0, gap: true });
  });

  it("does not index replay or rollback and preserves a failed plan's staged checkpoint", async () => {
    const user = await profile();
    const replay = await session(user.id, "LIVE_REPLAY");
    expect(await appendFact(replay.id, "CYCLE", "ignored")).toBeNull();
    const training = await session(user.id);
    await expect(sqliteWriteTransaction(prisma, async tx => {
      await settleGrowth(tx, { type: "CYCLE", sourceId: "rollback", sessionId: training.id, occurredAt: barTime(0) });
      throw new Error("ROLLBACK_TEST");
    })).rejects.toThrow("ROLLBACK_TEST");
    expect(await prisma.achievementFact.count({ where: { userId: user.id } })).toBe(0);
    const job = await createAchievementPreview({ userId: user.id, metrics: ["completed-cycles"], mode: "BACKFILL" });
    await achievementTick();
    await prisma.achievementJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "BATCH_FAILED" } });
    expect((await retryAchievementJob(job.id)).status).toBe("PREVIEW");
    expect((await until(job.id, "READY")).users).toBe(1);
    await startAchievementJob(job.id);
    await until(job.id, "SUCCEEDED");
    const before = await prisma.achievementSyncState.findUniqueOrThrow({ where: { id: 1 } });
    await achievementTick();
    expect((await prisma.achievementSyncState.findUniqueOrThrow({ where: { id: 1 } })).batchToken).toBe(before.batchToken);
  });

  it("connects only verified legacy exits to new cycles and preserves an award after coverage shrinks", async () => {
    const user = await profile(), s = await session(user.id);
    const { projectionId } = await loadReplayScope(s.id);
    const account = await prisma.paperTradingSession.create({ data: {
      datasetId, projectionId, initialCapital: 1000, peakEquity: 1000, lastProcessedSequence: 0, currency: "USDT",
    } });
    const legacy = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      const openedSequence = cycle * 3 + 1, closedSequence = openedSequence + 1;
      const entryId = `old-entry-${cycle}`, logicalTrade = `speculative_${entryId}`;
      const order = await prisma.paperOrder.create({ data: { sessionId: account.id, side: "BUY", type: "MARKET", quantity: 1, createdSequence: openedSequence, activeFromSequence: openedSequence } });
      const common = { sessionId: account.id, orderId: order.id, quantity: 1, price: 100, fee: 0, slippageCost: 0, realizedPnl: 0 };
      await prisma.paperFill.createMany({ data: [
        { ...common, id: projectionRecordId(projectionId, entryId), sequence: openedSequence, timestamp: barTime(openedSequence), side: "BUY", closedQuantity: 0, openedQuantity: 1, netQuantityAfter: 1, reason: "ENTRY" },
        { ...common, sequence: closedSequence, timestamp: barTime(closedSequence), side: "SELL", closedQuantity: 1, openedQuantity: 0, netQuantityAfter: 0, reason: "STOP_LOSS" },
      ] });
      await prisma.paperTrade.create({ data: {
        id: projectionRecordId(projectionId, logicalTrade), sessionId: account.id, side: "LONG", status: "CLOSED", openedSequence,
        closedSequence, openedAt: barTime(openedSequence), closedAt: barTime(closedSequence),
      } });
      legacy.push(await prisma.userGrowthFact.create({ data: {
        userId: user.id, type: "CYCLE", sourceKey: sourceKey("CYCLE", s.id, 0, logicalTrade), sessionId: s.id, roundNumber: 0,
        occurredAt: barTime(closedSequence), sourceSummary: "{}", cyclesDelta: 1, ruleVersion: "legacy",
      } }));
    }
    const plan = await createAchievementPreview({ userId: user.id, metrics: ["stop-loss-streak"], mode: "BACKFILL" });
    expect((await until(plan.id, "READY")).coverageGaps).toBe(0);
    await appendFact(s.id, "CYCLE", "new", 0, ExitReason.STOP_LOSS);
    await startAchievementJob(plan.id);
    await until(plan.id, "SUCCEEDED");
    expect(findSeries(await readAchievements(user.id), "stop-loss-streak")).toMatchObject({ highest: 1, best: 5, current: 5, gap: false });
    const deleted = await prisma.paperTrade.deleteMany({ where: { sessionId: account.id, closedAt: legacy[2].occurredAt } });
    expect(deleted.count).toBe(1);
    const recheck = await createAchievementPreview({ userId: user.id, metrics: ["stop-loss-streak"], mode: "RECHECK" });
    expect((await until(recheck.id, "READY")).coverageGaps).toBe(1);
    await startAchievementJob(recheck.id);
    await until(recheck.id, "SUCCEEDED");
    expect(findSeries(await readAchievements(user.id), "stop-loss-streak")).toMatchObject({ highest: 1, best: 2, current: 2, gap: true });
  });
});
