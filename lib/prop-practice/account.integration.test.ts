import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { randomUUID } = await import("node:crypto");
  const { join } = await import("node:path"); const { tmpdir } = await import("node:os");
  return { prisma: createDatabaseClient({ datasourceUrl: `file:${join(tmpdir(), `prop-account-${randomUUID()}.db`)}` }, { allowCreate: true }), replayDatabaseQueryCount: () => null };
});
import { prisma } from "@/lib/db";
import { createReplaySession, archiveReplaySession, deleteReplaySession, restartReplaySession } from "@/lib/replay-sessions/service";
import { loadReplayScope, runWithReplayScope } from "@/lib/replay-sessions/scope";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { defaultPropRules, payoutPreview, payoutQualification, promotionPreview, type PropRules } from "./rules";
import { confirmPropPayout, confirmPropPromotion, deletePropTemplate, loadPropAccount, savePropTemplate, listPropTemplates } from "./service";
import { POST as accountPOST } from "@/app/api/market-datasets/[id]/paper-session/route";
import { POST as orderPOST } from "@/app/api/market-datasets/[id]/paper-session/orders/route";
import { POST as advancePOST } from "@/app/api/market-datasets/[id]/replay/advance/route";
import { POST as syncPOST } from "@/app/api/market-datasets/[id]/replay/sync/route";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { tryFlatDisplayAdvance } from "@/lib/market-replay/flat-advance";
import { defaultTrainingGate } from "@/lib/paper-trading/training-gate";
import { DELETE as templateDELETE, POST as templatePOST } from "@/app/api/prop-practice-templates/route";
import { POST as promotionPOST } from "@/app/api/replay-sessions/[sessionId]/prop-practice/promote/route";
let file = "";
const times = ["2026-10-01T23:58:00Z", "2026-10-01T23:59:00Z", "2026-10-02T00:00:00Z", "2026-10-02T00:01:00Z", "2026-10-02T23:59:00Z", "2026-10-03T00:00:00Z", "2026-10-03T23:59:00Z", "2026-10-04T00:00:00Z"];
beforeAll(async () => {
  file = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${file}` }, stdio: "pipe" });
  await prisma.marketDataset.create({ data: { id: "prop", name: "Prop", symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: times.length, startTime: new Date(times[0]), endTime: new Date(times.at(-1)!) } });
  await prisma.marketBar.createMany({ data: times.map((time, sequence) => ({ datasetId: "prop", sequence, timestamp: new Date(time), open: 100 + sequence * 10, high: 115 + sequence * 10, low: 95 + sequence * 10, close: 110 + sequence * 10 })) });
}, 30000);
afterAll(async () => { await prisma.$disconnect(); if (file.includes("prop-account-")) rmSync(file, { force: true }); });
type Created = Awaited<ReturnType<typeof createReplaySession>>;
const ctx = { params: Promise.resolve({ id: "prop" }) };
const config = { initialCapital: 1000, currency: "USD", commissionBps: 1, slippageBps: 1 };
function request(s: Created, method: string, body: unknown) {
  return new Request(`http://localhost/api/test?replaySessionId=${s.id}`, { method, headers: { "Content-Type": "application/json", "X-Replay-Projection": s.activeProjectionId }, body: JSON.stringify(body) });
}
async function scoped<T>(s: Created, work: () => Promise<T>) { return runWithReplayScope(await loadReplayScope(s.id), work); }
async function snapshot(s: Created) { return scoped(s, () => getPaperSessionSnapshot("prop")); }
function rules(): PropRules { const r = structuredClone(defaultPropRules); r.name = "Practice"; r.evaluation.risk = { initialCapital: 1000, drawdown: 900, mode: "STATIC", capOffset: null }; r.funded.risk = { ...r.evaluation.risk }; r.evaluation.target = 1; r.evaluation.minTradingDays = null; r.evaluation.consistency = null; r.payout = { minimum: 1, fraction: 1, maximum: null, buffer: null, traderShare: 0.9, permanentFloorOffset: null }; return r; }
async function create(r?: PropRules) {
  const template = r ? await savePropTemplate(r) : null;
  const s = await createReplaySession("prop", { name: "Session", mode: "TRAINING", timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
  expect(await snapshot(s)).toBeNull();
  const response = await accountPOST(request(s, "POST", template ? { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id } : config), ctx);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  expect((await response.json()).snapshot.propAccount != null).toBe(!!template);
  return s;
}
async function advance(s: Created, count = 1, requestId = randomUUID()) {
  const p = await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: s.id } }); const snap = await snapshot(s);
  const body = { count, expectedVersion: snap!.session.version, expectedCurrentSequence: p.currentSequence, requestId };
  const response = await advancePOST(request(s, "POST", body), ctx); const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(200); return { body, data };
}
async function order(s: Created, side: "BUY" | "SELL", quantity = 1, more = {}) {
  const snap = await snapshot(s);
  const response = await orderPOST(request(s, "POST", { side, quantity, type: "MARKET", expectedVersion: snap!.session.version, ...("executeAtCurrentClose" in more ? { reduceOnly: true } : {}), ...more }), ctx);
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
}
function normalized(value: unknown, field?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map(item => normalized(item));
    // Protective siblings can share createdAt and use unrelated IDs to break display
    // ties. Compare the complete order contents; retain execution order for fills.
    return field === "recentOrders" ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["id", "datasetId", "orderId", "entryFillId", "lotId", "cycleKey", "activeCycleKey", "parentOrderId", "ocoGroupId", "createdAt", "updatedAt", "confirmedAt", "propAccount"].includes(key)).map(([key, item]) => [key, normalized(item, key)]));
  return value;
}
const templateRequest = (method: string, body: unknown) => new Request("http://localhost/api/prop-practice-templates", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function removeSession(s: Created) {
  const scope = await loadReplayScope(s.id);
  return runWithReplayScope(scope, () => sqliteWriteTransaction(prisma, tx => deleteReplaySession(tx, scope.version)));
}
describe("prop orchestration versus original flow", () => {
  it("rejects a previously saved invalid version on account creation without rewriting the version", async () => {
    const invalid = rules(); invalid.payout.minimum = 500.001; invalid.payout.maximum = 500.001;
    const template = await prisma.propPracticeTemplate.create({ data: { versions: { create: { version: 1, rules: JSON.stringify(invalid) } } }, include: { versions: true } });
    const s = await createReplaySession("prop", { name: "Invalid old version", mode: "TRAINING", timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    const response = await accountPOST(request(s, "POST", { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id }), ctx);
    expect(response.status).toBe(400);
    expect(await snapshot(s)).toBeNull();
    expect((await loadReplayScope(s.id)).accountCategory).toBe("STANDARD");

    expect((await prisma.propPracticeTemplateVersion.findUniqueOrThrow({ where: { id: template.versions[0].id } })).rules).toBe(JSON.stringify(invalid));
  });
  it.each(["create", "edit"])("rejects an impossible payout interval on template %s without saving any version", async action => {
    const template = action === "edit" ? await savePropTemplate(rules()) : null;
    const before = await prisma.propPracticeTemplateVersion.count();
    const invalid = rules(); invalid.payout.minimum = 500.001; invalid.payout.maximum = 500.001;
    const response = await templatePOST(new Request("http://localhost/api/prop-practice-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: invalid, active: true, ...(template ? { id: template.id, expectedVersion: template.version } : {}) }) }));
    expect(response.status).toBe(400);
    expect(await prisma.propPracticeTemplateVersion.count()).toBe(before);
    if (template) expect((await prisma.propPracticeTemplate.findUniqueOrThrow({ where: { id: template.id } })).version).toBe(template.version);
  });
  it("snapshots a custom daily source timezone, bounds and weekdays for a futures symbol", async () => {
    const id = "custom-source-calendar", timestamps = ["2026-10-01T00:00:00Z", "2026-10-01T01:59:00Z", "2026-10-02T00:00:00Z"];
    await prisma.marketDataset.create({ data: { id, name: id, symbol: "ES", timeframe: "1m", timezone: "Asia/Shanghai", sessionMode: "DAILY_SESSION", sessionOpenMinute: 480, sessionCloseMinute: 600, tradingWeekdays: "4,5", sourceIntervalSeconds: 60, barCount: 3, startTime: new Date(timestamps[0]), endTime: new Date(timestamps[2]) } });
    await prisma.marketBar.createMany({ data: timestamps.map((timestamp, sequence) => ({ datasetId: id, sequence, timestamp: new Date(timestamp), open: 100, high: 100, low: 100, close: 100 })) });
    const template = await savePropTemplate(rules());
    const s = await createReplaySession(id, { name: id, mode: "TRAINING", timestamp: timestamps[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    expect((await accountPOST(request(s, "POST", { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id }), { params: Promise.resolve({ id }) })).status).toBe(201);
    const snap = (await scoped(s, () => getPaperSessionSnapshot(id)))!;
    expect(snap.propAccount!.snapshot.calendar.session).toEqual({ mode: "DAILY_SESSION", timezone: "Asia/Shanghai", openMinute: 480, closeMinute: 600, weekdays: [4, 5] });
    const response = await advancePOST(request(s, "POST", { count: 2, expectedVersion: snap.session.version, expectedCurrentSequence: -1, requestId: randomUUID() }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.currentSequence).toBe(1);
    expect(data.snapshot.propAccount.state.stages[0].days).toMatchObject([{ day: timestamps[0].replace("Z", ".000Z"), settled: true }]);
  });
  it.each(["ES", "MES", "NQ"])("uses the UTC source calendar for %s across the Chicago display close and UTC EOD", async symbol => {
    const id = `source-calendar-${symbol}`, timestamps = ["2026-10-01T20:59:00Z", "2026-10-01T21:00:00Z", "2026-10-01T23:59:00Z", "2026-10-02T00:00:00Z", "2026-10-02T00:01:00Z"];
    await prisma.marketDataset.create({ data: { id, name: id, symbol, timeframe: "1m", timezone: "UTC", sessionMode: "TWENTY_FOUR_SEVEN", sourceIntervalSeconds: 60, barCount: timestamps.length, startTime: new Date(timestamps[0]), endTime: new Date(timestamps.at(-1)!) } });
    await prisma.marketBar.createMany({ data: timestamps.map((timestamp, sequence) => ({ datasetId: id, sequence, timestamp: new Date(timestamp), open: 100 + sequence * 10, high: 115 + sequence * 10, low: 95 + sequence * 10, close: 110 + sequence * 10 })) });
    const template = await savePropTemplate(rules());
    const s = await createReplaySession(id, { name: id, mode: "TRAINING", timestamp: timestamps[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "RTH" });
    expect((await accountPOST(request(s, "POST", { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id }), { params: Promise.resolve({ id }) })).status).toBe(201);
    const localContext = { params: Promise.resolve({ id }) };
    const read = () => scoped(s, () => getPaperSessionSnapshot(id));
    async function step(count: number) {
      const snap = (await read())!;
      const response = await advancePOST(request(s, "POST", { count, expectedVersion: snap.session.version, expectedCurrentSequence: snap.session.lastProcessedSequence, requestId: randomUUID() }), localContext);
      expect(response.status).toBe(200); return response.json();
    }
    const advanced = await step(2);
    expect(advanced.currentSequence).toBe(1);
    expect(advanced.snapshot.propAccount.state.pause).toBe("NONE");
    expect(advanced.snapshot.propAccount.state.phase).toBe("EVALUATION");
    expect(advanced.snapshot.propAccount.snapshot.calendar.session).toMatchObject({ timezone: "UTC", mode: "TWENTY_FOUR_SEVEN" });
    expect(advanced.snapshot.propAccount.state.stages[0].days[0]).toMatchObject({ day: "2026-10-01T00:00:00.000Z", settled: false });
    // Later metadata and chart-session changes cannot rewrite the saved source calendar.
    await prisma.marketDataset.update({ where: { id }, data: { timezone: "Asia/Tokyo" } });
    let snap = (await read())!;
    expect((await orderPOST(request(s, "POST", { side: "BUY", type: "MARKET", quantity: 1, expectedVersion: snap.session.version }), localContext)).status).toBe(201);
    await step(1); snap = (await read())!;
    expect(snap.propAccount!.state.phase).toBe("EVALUATION");
    expect((await orderPOST(request(s, "POST", { side: "SELL", type: "MARKET", quantity: 1, reduceOnly: true, executeAtCurrentClose: true, expectedVersion: snap.session.version }), localContext)).status).toBe(201);
    const promoted = (await read())!.propAccount!;
    expect(promoted.state.phase).toBe("FUNDED");
    expect(promoted.state.stages[0].days).toMatchObject([{ day: "2026-10-01T00:00:00.000Z", settled: true }]);
    expect(promoted.state.pausedDay).toBe("2026-10-01T00:00:00.000Z");
    const resumed = await step(1);
    expect(resumed.currentSequence).toBe(3); expect(resumed.snapshot.propAccount.state.pause).toBe("NONE");
    expect(resumed.snapshot.propAccount.state.stages[1].days[0].day).toBe("2026-10-02T00:00:00.000Z");
  });
  it("binds at the current cursor without backfilling or resetting progress, preferences and gate", async () => {
    const s = await createReplaySession("prop", { name: "Late account", mode: "TRAINING", timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    await prisma.replayProgress.update({ where: { replaySessionId: s.id }, data: { currentSequence: 3 } });
    await prisma.replayProjection.update({ where: { id: s.activeProjectionId }, data: { currentSequence: 3 } });
    const gate = JSON.stringify({ ...defaultTrainingGate(), lossThreshold: 4 });
    await prisma.replaySession.update({ where: { id: s.id }, data: { trainingGate: gate, riskPreferences: "{\"riskAmount\":20}" } });
    const template = await savePropTemplate(rules());
    const response = await accountPOST(request(s, "POST", { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id }), ctx);
    expect(response.status).toBe(201);
    const snap = (await response.json()).snapshot;
    expect(snap.session).toMatchObject({ lastProcessedSequence: 3, realizedPnl: 0, totalFees: 0 });
    expect(snap.propAccount.state.stages[0]).toMatchObject({ startSequence: 4, days: [] });
    const session = await prisma.replaySession.findUniqueOrThrow({ where: { id: s.id } });
    expect(session).toMatchObject({ accountCategory: "PROP_PRACTICE", trainingGate: gate, riskPreferences: "{\"riskAmount\":20}" });
    expect((await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: s.id } })).currentSequence).toBe(3);
    const checkpoint = await prisma.replayCheckpoint.findFirstOrThrow({ where: { projectionId: s.activeProjectionId }, orderBy: [{ sourceSequence: "desc" }, { commandOrdinal: "desc" }] });
    expect(JSON.parse(checkpoint.state).propAccount).toEqual(snap.propAccount);
  });
  it("rejects prop creation in live replay and leaves the session available for a default account", async () => {
    const s = await createReplaySession("prop", { name: "Live", mode: "LIVE_REPLAY", timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    const template = await savePropTemplate(rules());
    expect((await accountPOST(request(s, "POST", { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id }), ctx)).status).toBe(400);
    expect(await snapshot(s)).toBeNull();
    expect((await loadReplayScope(s.id))).toMatchObject({ mode: "LIVE_REPLAY", accountCategory: "STANDARD" });
    expect((await accountPOST(request(s, "POST", config), ctx)).status).toBe(201);
  });
  it("concurrent account requests bind once and cannot switch the fixed category", async () => {
    const s = await createReplaySession("prop", { name: "Concurrent", mode: "TRAINING", timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    const template = await savePropTemplate(rules());
    const payload = { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id };
    const responses = await Promise.all([accountPOST(request(s, "POST", payload), ctx), accountPOST(request(s, "POST", payload), ctx)]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.propPracticeAccount.count({ where: { replaySessionId: s.id } })).toBe(1);
    expect(await prisma.paperTradingSession.count({ where: { projectionId: s.activeProjectionId } })).toBe(1);
    expect(await prisma.replayCommand.count({ where: { replaySessionId: s.id, type: "ACCOUNT_INIT" } })).toBe(1);
    expect((await accountPOST(request(s, "POST", config), ctx)).status).toBe(409);
    const standard = await create();
    expect((await accountPOST(request(standard, "POST", payload), ctx)).status).toBe(409);
    expect((await loadReplayScope(standard.id)).accountCategory).toBe("STANDARD");
  });
  it("rolls back category, ledger, journal, account and command if account persistence fails", async () => {
    const s = await createReplaySession("prop", { name: "Rollback", mode: "TRAINING", timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    const before = await loadReplayScope(s.id);
    const template = await savePropTemplate(rules());
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_account_init BEFORE INSERT ON ReplayCommand WHEN NEW.type='ACCOUNT_INIT' BEGIN SELECT RAISE(ABORT, 'test account failure'); END`);
    try {
      expect((await accountPOST(request(s, "POST", { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id }), ctx)).status).toBe(409);
    } finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_account_init"); }
    expect(await loadReplayScope(s.id)).toEqual(before);
    expect(await snapshot(s)).toBeNull();
    expect(await prisma.propPracticeAccount.count({ where: { replaySessionId: s.id } })).toBe(0);
    expect(await prisma.replayJournalSession.count({ where: { replaySessionId: s.id } })).toBe(0);
    expect(await prisma.replayCommand.count({ where: { replaySessionId: s.id } })).toBe(0);
    expect((await accountPOST(request(s, "POST", config), ctx)).status).toBe(201);
  });
  it("keeps automatic loss gate, unchecked-order cancellation, plan and completion count identical", async () => {
    const r = rules(); r.evaluation.target = 1e8;
    const a = await create(), b = await create(r);
    for (const s of [a, b]) {
      await prisma.replaySession.update({ where: { id: s.id }, data: { trainingGate: JSON.stringify({ ...defaultTrainingGate(), lossThreshold: 1, nextMode: "PLAN", tradeCount: 1 }) } });
      await advance(s); await order(s, "SELL"); await advance(s);
      await order(s, "SELL", 1, { type: "LIMIT", price: 200 });
      await order(s, "BUY", 1, { executeAtCurrentClose: true });
      expect((await snapshot(s))!.session.trainingGate).toMatchObject({ active: true, source: "LOSS_STREAK", cancelledOrderCount: 1, completedCount: 0 });
      await order(s, "BUY", 1, { gateApproval: { mode: "PLAN", context: "WEAK_BREAKOUT", plan: "等待回调后入场", displayIntervalSeconds: 60 } });
      await advance(s);
      expect((await snapshot(s))!.session.trainingGate).toMatchObject({ active: false, completedCount: 1, targetCount: 1 });
      await order(s, "SELL", 1, { executeAtCurrentClose: true });
    }
    expect(normalized(await snapshot(b))).toEqual(normalized(await snapshot(a)));
  });
  it("preserves original orders, reversals, partial closes, fees, risk sizing, OCO and gate results", async () => {
    const r = rules(); r.evaluation.target = 1e8;
    const standard = await create(), prop = await create(r);
    for (const s of [standard, prop]) {
      await advance(s); await order(s, "BUY", 2); await advance(s);
      await order(s, "SELL", 1, { executeAtCurrentClose: true });
      await order(s, "SELL", 3); await advance(s); // reverse long 1 -> short 2
      await order(s, "BUY", 2, { executeAtCurrentClose: true });
      await order(s, "BUY", 1, { type: "LIMIT", price: 130, stopLoss: 120, takeProfit: 140, riskAmount: 10 });
      await advance(s); await advance(s);
    }
    const a = await snapshot(standard), b = await snapshot(prop);
    expect(normalized(b)).toEqual(normalized(a));
    expect(b!.session.trainingGate).toEqual(a!.session.trainingGate);
    expect(b!.recentFills.length).toBeGreaterThanOrEqual(6);
  });
  it("settles same-source current-close net and fees before promotion without resetting raw history or gate", async () => {
    const s = await create(rules()); await advance(s); await order(s, "BUY"); await advance(s);
    const held = await snapshot(s); expect(held!.propAccount!.state.phase).toBe("EVALUATION");
    expect(held!.propAccount!.state.stages[0].days[0].settled).toBe(false);
    await order(s, "SELL", 1, { executeAtCurrentClose: true });
    const passed = await snapshot(s), prop = passed!.propAccount!;
    expect(prop.state.phase).toBe("FUNDED"); expect(prop.state.stages[0].days).toHaveLength(1);
    expect(prop.state.stages[0].days[0].endRawNet).toBe(passed!.session.realizedPnl - passed!.session.totalFees);
    expect(prop.state.stages[1].initialCapital).toBe(1000); expect(prop.state.pause).toBe("STAGE_WAIT");
    expect(passed!.session.realizedPnl).toBeGreaterThan(0); expect(passed!.session.trainingGate).toEqual(held!.session.trainingGate);
    const blocked = await orderPOST(request(s, "POST", { side: "BUY", type: "MARKET", quantity: 1, expectedVersion: passed!.session.version }), ctx); expect(blocked.status).toBe(409);
    await advance(s); expect((await snapshot(s))!.session.lastProcessedSequence).toBe(2); expect((await snapshot(s))!.propAccount!.state.pause).toBe("NONE");
  });
  it("stops before the next day first candle on deferred EOD promotion and retries without skipping it", async () => {
    const s = await create(rules()); await advance(s); await order(s, "BUY"); await advance(s);
    await order(s, "SELL", 1, { executeAtCurrentClose: true });
    // Emulate a missing exact final source bar: deferred settlement must precede new-day execution.
    await scoped(s, async () => {
      const row = await prisma.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: s.id } });
      const state = JSON.parse(row.state); state.phase = "EVALUATION"; state.stages.pop(); state.pause = "NONE"; state.pausedDay = null; state.stages[0].days[0].settled = false;
      await prisma.propPracticeAccount.update({ where: { replaySessionId: s.id }, data: { state: JSON.stringify(state) } });
    });
    const stopped = await advance(s, 4); expect(stopped.data.currentSequence).toBe(1); expect(stopped.data.propStopped).toBe(true);
    const retry = await advancePOST(request(s, "POST", stopped.body), ctx); expect((await retry.json()).currentSequence).toBe(1);
    await advance(s); expect((await snapshot(s))!.session.lastProcessedSequence).toBe(2);
  });
  it("archives risk failure after the entire source result, retaining position and protection with retry receipt", async () => {
    const r = rules(); r.evaluation.risk.drawdown = 0.01;
    const standard = await create(), s = await create(r);
    for (const item of [standard, s]) { await advance(item); await order(item, "BUY", 1, { stopLoss: 50, takeProfit: 300 }); }
    await advance(standard);
    // Intrabar win here; make next complete close lose enough through original price model.
    await prisma.marketBar.update({ where: { datasetId_sequence: { datasetId: "prop", sequence: 1 } }, data: { close: 109 } });
    const failed = await advance(s, 5);
    expect(failed.data.currentSequence).toBe(1); expect((await loadReplayScope(s.id)).status).toBe("ARCHIVED");
    const snap = await snapshot(s); expect(snap!.session.netQuantity).toBe(1); expect(snap!.activeOrders).toHaveLength(2); expect(snap!.recentFills).toHaveLength(1);
    const retry = await advancePOST(request(s, "POST", failed.body), ctx); expect(retry.status).toBe(200); expect((await retry.json()).currentSequence).toBe(1);
    await prisma.marketBar.update({ where: { datasetId_sequence: { datasetId: "prop", sequence: 1 } }, data: { close: 120 } });
  });
  it("atomic payout retry and concurrent requests deduct once, keep raw results and allow next-day leftovers", async () => {
    const s = await create(rules()); await advance(s); await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true });
    await advance(s); await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true });
    const before = await snapshot(s), scope = await loadReplayScope(s.id);
    const checkpoint = await prisma.replayCheckpoint.findFirstOrThrow({ where: { projectionId: s.activeProjectionId }, orderBy: [{ sourceSequence: "desc" }, { commandOrdinal: "desc" }] });
    expect(JSON.parse(checkpoint.state).propAccount).toEqual(before!.propAccount);
    const input = { expectedVersion: scope.version, requestId: randomUUID(), amount: 5 };
    const results = await Promise.all([runWithReplayScope(scope, () => confirmPropPayout(input)), runWithReplayScope(scope, () => confirmPropPayout(input))]);
    expect(results[0].id).toBe(results[1].id); expect(results[0].received).toBe(4.5);
    const after = await snapshot(s); expect(after!.session).toEqual(before!.session); expect(after!.stats).toEqual(before!.stats);
    expect(after!.propAccount!.state.totalRequested).toBe(5); expect(after!.propAccount!.state.totalReceived).toBe(4.5);
    await expect(scoped(s, () => confirmPropPayout({ ...input, requestId: randomUUID(), expectedVersion: (scope.version + 1) }))).rejects.toThrow();
    const sameDay = await advance(s); // last candle of same payout day: no trading
    expect(sameDay.data.propStopped).toBe(false);
    const nextDay = await advance(s); // next actual day: leftovers available, no fresh profit
    expect(nextDay.data.propStopped).toBe(false);
    const next = await snapshot(s); expect(next!.propAccount!.state.pause).toBe("NONE");
    const second = await scoped(s, async () => confirmPropPayout({ expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID(), amount: 1 }));
    expect(second.received).toBe(0.9); expect((await snapshot(s))!.session).toMatchObject({ realizedPnl: before!.session.realizedPnl, totalFees: before!.session.totalFees });
  });
  it.each(["source", "display", "bulk"])("continues %s replay during payout-day trading suspension and resumes on the next source day", async mode => {
    const s = await create(rules()); await advance(s); await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true });
    await advance(s); await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true });
    await scoped(s, async () => confirmPropPayout({ expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID(), amount: 5 }));
    const paid = (await snapshot(s))!;
    async function move(targetSequence: number) {
      const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: s.id } });
      const snap = (await snapshot(s))!;
      const body = mode === "bulk" ? { batchMode: "BULK", requestId: randomUUID(), generation: progress.generation, confirmedSequence: progress.currentSequence,
        syncVersion: progress.syncVersion, dataVersion: 1, historyVersion: 1, expectedPaperVersion: snap.session.version, targetSequence,
        contextRuns: [{ fromSequence: progress.currentSequence + 1, toSequence: targetSequence, generation: progress.generation, context: null }] }
        : { count: 1, requestId: randomUUID(), expectedVersion: snap.session.version, expectedCurrentSequence: progress.currentSequence,
          ...(mode === "display" ? { displayIntervalSeconds: 300, displaySession: "ETH", abrLength: 14, displayUtcOffsetMinutes: 0 } : {}) };
      const handler = mode === "bulk" ? syncPOST : advancePOST;
      const response = await handler(request(s, "POST", body), ctx), data = await response.json();
      expect(response.status, JSON.stringify(data)).toBe(200); expect(data.currentSequence).toBe(targetSequence);
      return { handler, body, data };
    }
    const sameDay = await move(4);
    expect(sameDay.data.propStopped).toBe(false);
    if (mode === "display") expect(sameDay.data.reachedVisibleBucket).toBe(true);
    const paused = (await snapshot(s))!;
    expect(paused.propAccount!.state.pause).toBe("PAYOUT_DAY");
    expect(paused.session).toMatchObject({ realizedPnl: paid.session.realizedPnl, totalFees: paid.session.totalFees, netQuantity: 0 });
    const blocked = await orderPOST(request(s, "POST", { side: "BUY", quantity: 1, type: "MARKET", expectedVersion: paused.session.version }), ctx);
    expect(blocked.status).toBe(409); expect((await blocked.json()).code).toBe("PROP_PAUSED");
    const retry = await sameDay.handler(request(s, "POST", sameDay.body), ctx);
    expect(retry.status).toBe(200); expect((await retry.json()).propStopped).toBe(false);
    expect(await snapshot(s)).toEqual(paused);
    const resumed = await move(5);
    expect(resumed.data.propStopped).toBe(false);
    const next = (await snapshot(s))!;
    expect(next.propAccount!.state).toMatchObject({ pause: "NONE", pausedDay: null, payoutCount: 1, totalRequested: 5 });
    expect(next.propAccount!.state.last).toMatchObject({ sequence: 5, day: "2026-10-03T00:00:00.000Z" });
    expect(await prisma.propPracticeEvent.count({ where: { replaySessionId: s.id, type: "RESUMED" } })).toBe(2);
    expect(await prisma.propPracticePayout.count({ where: { replaySessionId: s.id } })).toBe(1);
    await order(s, "BUY"); // Trading is available again on the first new-day source candle.
  });
  it("enforces settled funded qualifying days server-side and resets once under concurrent payout retries", async () => {
    const r = rules(); r.funded.qualifyingDays = 1; r.funded.qualifyingProfit = 1;
    const s = await create(r);
    await advance(s); await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true });
    expect((await snapshot(s))!.propAccount!.state.phase).toBe("FUNDED");
    await advance(s); await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true });
    const pending = (await snapshot(s))!.propAccount!;
    expect(payoutPreview(r, pending.state)).toMatchObject({ eligible: false, qualification: { qualifyingDays: 0 } });
    await expect(scoped(s, async () => confirmPropPayout({ expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID(), amount: 5 }))).rejects.toThrow();
    expect(await prisma.propPracticePayout.count({ where: { replaySessionId: s.id } })).toBe(0);
    await advance(s); // final source candle settles the funded day
    const before = (await snapshot(s))!, scope = await loadReplayScope(s.id);
    expect(payoutPreview(r, before.propAccount!.state)).toMatchObject({ eligible: true, qualification: { qualifyingDays: 1 } });
    const input = { expectedVersion: scope.version, requestId: randomUUID(), amount: 5 };
    const results = await Promise.all([runWithReplayScope(scope, () => confirmPropPayout(input)), runWithReplayScope(scope, () => confirmPropPayout(input))]);
    expect(results[0].id).toBe(results[1].id);
    const after = (await snapshot(s))!;
    expect(after.session).toEqual(before.session); expect(after.stats).toEqual(before.stats);
    expect(after.propAccount!.state.stages.map(stage => stage.days)).toEqual(before.propAccount!.state.stages.map(stage => stage.days));
    expect(after.propAccount!.state).toMatchObject({ payoutCount: 1, totalRequested: 5 });
    expect(payoutQualification(r, after.propAccount!.state).qualifyingDays).toBe(0);
    await advance(s); // new day still has withdrawable profits, but no new qualifying day
    const next = (await snapshot(s))!.propAccount!;
    expect(payoutPreview(r, next.state)).toMatchObject({ eligible: false, qualification: { qualifyingDays: 0 } });
    expect(payoutPreview(r, next.state).maximum).toBeGreaterThanOrEqual(1);
    await expect(scoped(s, async () => confirmPropPayout({ expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID(), amount: 1 }))).rejects.toThrow();
    await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true });
    const qualified = (await snapshot(s))!.propAccount!;
    expect(payoutPreview(r, qualified.state)).toMatchObject({ eligible: true, qualification: { qualifyingDays: 1 } });
    await scoped(s, async () => confirmPropPayout({ expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID(), amount: 1 }));
    expect(payoutQualification(r, (await snapshot(s))!.propAccount!.state).qualifyingDays).toBe(0);
    expect(await prisma.propPracticePayout.count({ where: { replaySessionId: s.id } })).toBe(2);
  });
  it("used templates and cost snapshots stay fixed while copies can change; optional activation allows restart", async () => {
    const r = rules(); r.activationCost = undefined; r.purchaseCost = 0;
    const template = await savePropTemplate(r);
    const s = await createReplaySession("prop", { name: "Versioned", mode: "TRAINING", timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    expect((await accountPOST(request(s, "POST", { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id }), ctx)).status).toBe(201);
    await expect(savePropTemplate({ ...r, activationCost: 100, purchaseCost: 500 }, template.id, template.version, false)).rejects.toMatchObject({ code: "TEMPLATE_IN_USE" });
    const copy = await savePropTemplate({ ...r, name: "Copy", activationCost: 100, purchaseCost: 500 });
    expect(copy.id).not.toBe(template.id);
    expect(JSON.parse(copy.versions[0].rules)).toMatchObject({ activationCost: 100, purchaseCost: 500 });
    const prop = await scoped(s, () => loadPropAccount()); expect(prop!.snapshot.rules.purchaseCost).toBe(0); expect(prop!.snapshot.rules.activationCost).toBeUndefined();
    const next = await scoped(s, () => restartReplaySession()); expect(next.accountCategory).toBe("PROP_PRACTICE"); expect((await loadReplayScope(s.id)).status).toBe("ARCHIVED");
    expect((await scoped(next, () => loadPropAccount()))!.snapshot.rules.activationCost).toBeUndefined();
  });
  it("single and batch source processing agree, and prop bypasses cross-day flat fast-forward", async () => {
    const r = rules(); r.evaluation.target = 1e8;
    const a = await create(r), b = await create(r);
    await advance(a, 7); for (let i = 0; i < 7; i++) await advance(b);
    expect((await snapshot(a))!.propAccount!.state).toEqual((await snapshot(b))!.propAccount!.state);
    const outcome = await scoped(a, () => tryFlatDisplayAdvance("prop", { count: 1, expectedCurrentSequence: 6, abrLength: 14, displaySession: "ETH", displayUtcOffsetMinutes: 0 }));
    expect(outcome).toMatchObject({ response: { flatAdvanceUnavailable: true } });
    await scoped(a, () => sqliteWriteTransaction(prisma, tx => archiveReplaySession(tx)));
    expect((await scoped(a, () => loadPropAccount()))!.state.result).toBe("STOPPED");
  });
  it("rolls back every payout write when event persistence fails", async () => {
    const s = await create(rules()); await advance(s); await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true }); await advance(s);
    await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true });
    const before = await snapshot(s);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_prop_event BEFORE INSERT ON PropPracticeEvent WHEN NEW.type='PAYOUT' BEGIN SELECT RAISE(ABORT, 'test payout failure'); END`);
    try { await expect(scoped(s, async () => confirmPropPayout({ expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID(), amount: 1 }))).rejects.toThrow(); }
    finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_prop_event"); }
    expect(await snapshot(s)).toEqual(before); expect(await prisma.propPracticePayout.count({ where: { replaySessionId: s.id } })).toBe(0);
  });
});

describe("template editing and deletion guards", () => {
  it("replaces unused rules without accumulating history and rejects stale edits, deletes and account selections", async () => {
    const r = rules(), original = await savePropTemplate(r);
    const s = await createReplaySession("prop", { name: "Stale selection", mode: "TRAINING", timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    const edited = await savePropTemplate({ ...r, name: "Edited" }, original.id, original.version);
    expect(edited.id).toBe(original.id); expect(edited.versions).toHaveLength(1); expect(edited.versions[0].id).not.toBe(original.versions[0].id);
    expect(await prisma.propPracticeTemplateVersion.count({ where: { templateId: original.id } })).toBe(1);
    await expect(savePropTemplate(r, original.id, original.version)).rejects.toMatchObject({ code: "TEMPLATE_CONFLICT" });
    const staleDelete = await templateDELETE(templateRequest("DELETE", { id: original.id, expectedVersion: original.version }));
    expect(staleDelete.status).toBe(409);
    const staleCreate = await accountPOST(request(s, "POST", { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: original.versions[0].id }), ctx);
    expect(staleCreate.status).toBe(409); expect(await snapshot(s)).toBeNull();
    const second = await savePropTemplate({ ...r, name: "Twice edited" }, edited.id, edited.version, false);
    expect(await prisma.propPracticeTemplateVersion.count({ where: { templateId: original.id } })).toBe(1);
    const row = (await listPropTemplates()).find(item => item.id === original.id)!;
    expect(row).toMatchObject({ active: false, accountCount: 0 }); expect(row.versions[0].id).toBe(second.versions[0].id);
    expect((await templateDELETE(templateRequest("DELETE", { id: second.id, expectedVersion: second.version }))).status).toBe(200);
    expect(await prisma.propPracticeTemplate.findUnique({ where: { id: original.id } })).toBeNull();
    expect(await prisma.propPracticeTemplateVersion.count({ where: { templateId: original.id } })).toBe(0);
    expect((await templateDELETE(templateRequest("DELETE", { id: second.id, expectedVersion: second.version }))).status).toBe(404);
  });
  it("counts older-version and archived accounts, unlocking only after all referencing sessions are deleted", async () => {
    const r = rules(), template = await savePropTemplate(r);
    const sessions: Created[] = [];
    for (let index = 0; index < 2; index++) {
      const s = await createReplaySession("prop", { name: "Existing reference", mode: "TRAINING", timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
      expect((await accountPOST(request(s, "POST", { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id }), ctx)).status).toBe(201);
      sessions.push(s);
    }
    // Reproduce legacy history: the newest rules are unused, but the older rules are referenced.
    const latest = await prisma.propPracticeTemplate.update({ where: { id: template.id }, data: { version: 2, versions: { create: { version: 2, rules: JSON.stringify({ ...r, name: "Legacy latest" }) } } } });
    await scoped(sessions[0], () => sqliteWriteTransaction(prisma, tx => archiveReplaySession(tx)));
    expect((await listPropTemplates()).find(row => row.id === template.id)?.accountCount).toBe(2);
    const update = { id: template.id, expectedVersion: latest.version, active: true, rules: r };
    const identity = { id: template.id, expectedVersion: latest.version };
    expect((await templatePOST(templateRequest("POST", update))).status).toBe(409);
    expect((await templateDELETE(templateRequest("DELETE", identity))).status).toBe(409);
    expect(await prisma.propPracticeTemplateVersion.count({ where: { templateId: template.id } })).toBe(2);
    const before = await snapshot(sessions[0]);
    const copied = await savePropTemplate({ ...r, name: "Independent" });
    await savePropTemplate({ ...r, name: "Independent changed" }, copied.id, copied.version);
    expect(await snapshot(sessions[0])).toEqual(before);
    await removeSession(sessions[1]);
    expect((await listPropTemplates()).find(row => row.id === template.id)?.accountCount).toBe(1);
    expect((await templateDELETE(templateRequest("DELETE", identity))).status).toBe(409);
    await removeSession(sessions[0]);
    expect((await listPropTemplates()).find(row => row.id === template.id)?.accountCount).toBe(0);
    const edited = await savePropTemplate({ ...r, name: "Unlocked" }, template.id, latest.version);
    expect(await prisma.propPracticeTemplateVersion.count({ where: { templateId: template.id } })).toBe(1);
    expect((await templateDELETE(templateRequest("DELETE", { id: template.id, expectedVersion: edited.version }))).status).toBe(200);
    expect(await prisma.propPracticeTemplate.findUnique({ where: { id: copied.id } })).not.toBeNull();
  });
  it.each(["POST", "DELETE"])("requires a matching revision and identity for template %s", async method => {
    const template = await savePropTemplate(rules());
    for (const identity of [{ id: template.id }, { expectedVersion: template.version }, { id: template.id, expectedVersion: 0 }]) {
      const handler = method === "POST" ? templatePOST : templateDELETE;
      expect((await handler(templateRequest(method, { ...identity, ...(method === "POST" ? { active: true, rules: rules() } : {}) }))).status).toBe(400);
    }
    expect(await prisma.propPracticeTemplateVersion.count({ where: { templateId: template.id } })).toBe(1);
  });
  it.each(["edit", "delete"])("keeps concurrent account creation and template %s mutually safe", async action => {
    const r = rules(), template = await savePropTemplate(r);
    const s = await createReplaySession("prop", { name: "Concurrent template use", mode: "TRAINING", timestamp: times[0], playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
    const [accountResponse, mutationResponse] = await Promise.all([
      accountPOST(request(s, "POST", { ...config, accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id }), ctx),
      action === "edit" ? templatePOST(templateRequest("POST", { id: template.id, expectedVersion: template.version, active: true, rules: { ...r, name: "Changed" } }))
        : templateDELETE(templateRequest("DELETE", { id: template.id, expectedVersion: template.version })),
    ]);
    if (accountResponse.status === 201) {
      expect(mutationResponse.status).toBe(409);
      expect((await snapshot(s))!.propAccount!.snapshot.rules.name).toBe(r.name);
      expect(await prisma.propPracticeTemplateVersion.findUnique({ where: { id: template.versions[0].id } })).not.toBeNull();
    } else {
      expect(accountResponse.status).toBe(409); expect(mutationResponse.status).toBe(action === "edit" ? 201 : 200);
      expect(await snapshot(s)).toBeNull(); expect((await loadReplayScope(s.id)).accountCategory).toBe("STANDARD");
    }
  });
  it.each(["edit", "delete"])("rolls back rules deletion if template %s fails midway", async action => {
    const template = await savePropTemplate(rules()), before = await prisma.propPracticeTemplate.findUnique({ where: { id: template.id }, include: { versions: true } });
    const operation = action === "edit" ? "UPDATE" : "DELETE";
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_template_mutation BEFORE ${operation} ON PropPracticeTemplate WHEN OLD.id='${template.id}' BEGIN SELECT RAISE(ABORT, 'test template failure'); END`);
    try {
      if (action === "edit") await expect(savePropTemplate({ ...rules(), name: "Rejected" }, template.id, template.version)).rejects.toThrow();
      else await expect(deletePropTemplate(template.id, template.version)).rejects.toThrow();
    } finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_template_mutation"); }
    expect(await prisma.propPracticeTemplate.findUnique({ where: { id: template.id }, include: { versions: true } })).toEqual(before);
  });
});

describe("manual intraday promotion", () => {
  async function qualifyingSession() {
    const r = rules(); r.funded.qualifyingDays = 1; r.funded.qualifyingProfit = 1;
    const s = await create(r);
    await advance(s, 3); await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true });
    expect((await snapshot(s))!.propAccount!.state.phase).toBe("EVALUATION");
    return { r, s };
  }
  it("switches once under concurrent retries, preserves raw results and records funded profits the same day", async () => {
    const { r, s } = await qualifyingSession();
    const before = (await snapshot(s))!, scope = await loadReplayScope(s.id);
    const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: s.id } });
    expect(promotionPreview(r, before.propAccount!.state).eligible).toBe(true);
    const input = { expectedVersion: scope.version, requestId: randomUUID() };
    const responses = await Promise.all([promotionPOST(request(s, "POST", input), { params: Promise.resolve({ sessionId: s.id }) }), promotionPOST(request(s, "POST", input), { params: Promise.resolve({ sessionId: s.id }) })]);
    for (const response of responses) expect(response.status).toBe(200);
    const receipts = await Promise.all(responses.map(response => response.json()));
    expect(receipts[0].promotion.id).toBe(receipts[1].promotion.id);
    const after = (await snapshot(s))!;
    expect(normalized(after)).toEqual(normalized(before));
    expect(after.propAccount!.state).toMatchObject({ phase: "FUNDED", pause: "NONE", stages: [{}, { anchor: before.session.realizedPnl - before.session.totalFees, initialCapital: r.funded.risk.initialCapital }] });
    expect(await prisma.replayProgress.findUnique({ where: { replaySessionId: s.id } })).toEqual(progress);
    expect(await prisma.propPracticeEvent.count({ where: { replaySessionId: s.id, type: "PROMOTED" } })).toBe(1);
    const checkpoint = await prisma.replayCheckpoint.findFirstOrThrow({ where: { projectionId: s.activeProjectionId }, orderBy: [{ sourceSequence: "desc" }, { commandOrdinal: "desc" }] });
    expect(JSON.parse(checkpoint.state).propAccount).toEqual(after.propAccount);
    await expect(scoped(s, async () => confirmPropPromotion({ expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID() }))).rejects.toMatchObject({ code: "PROP_PROMOTION_INVALID" });
    await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true });
    const traded = (await snapshot(s))!;
    expect(traded.propAccount!.state.stages[0]).toEqual(after.propAccount!.state.stages[0]);
    expect(traded.propAccount!.state.stages[1].days[0].day).toBe(after.propAccount!.state.stages[0].days.at(-1)!.day);
    expect(payoutQualification(r, traded.propAccount!.state).qualifyingDays).toBe(1);
    expect(traded.propAccount!.state.stages[1].days[0].endRawNet - traded.propAccount!.state.stages[1].days[0].startRawNet).toBeCloseTo(traded.session.realizedPnl - traded.session.totalFees - (before.session.realizedPnl - before.session.totalFees));
    expect((await scoped(s, () => confirmPropPromotion(input))).id).toBe(receipts[0].promotion.id);
    expect((await snapshot(s))!.propAccount).toEqual(traded.propAccount);
  });
  it("rejects unmet, stale, pending-order and archived requests without changing account state", async () => {
    const s = await create(rules()); await advance(s);
    const empty = (await snapshot(s))!, scope = await loadReplayScope(s.id);
    const rejected = await promotionPOST(request(s, "POST", { expectedVersion: scope.version, requestId: randomUUID() }), { params: Promise.resolve({ sessionId: s.id }) });
    expect(rejected.status).toBe(409); expect(await snapshot(s)).toEqual(empty);
    const { s: ready } = await qualifyingSession();
    const before = await snapshot(ready), readyScope = await loadReplayScope(ready.id);
    await expect(scoped(ready, () => confirmPropPromotion({ expectedVersion: readyScope.version - 1, requestId: randomUUID() }))).rejects.toMatchObject({ code: "SESSION_CONFLICT" });
    expect(await snapshot(ready)).toEqual(before);
    await order(ready, "BUY");
    const pending = await snapshot(ready);
    await expect(scoped(ready, async () => confirmPropPromotion({ expectedVersion: (await loadReplayScope(ready.id)).version, requestId: randomUUID() }))).rejects.toMatchObject({ code: "PROP_PROMOTION_INVALID" });
    expect(await snapshot(ready)).toEqual(pending);
    await scoped(ready, () => sqliteWriteTransaction(prisma, tx => archiveReplaySession(tx)));
    const archived = await snapshot(ready);
    await expect(scoped(ready, async () => confirmPropPromotion({ expectedVersion: (await loadReplayScope(ready.id)).version, requestId: randomUUID() }))).rejects.toMatchObject({ code: "SESSION_ARCHIVED" });
    expect(await snapshot(ready)).toEqual(archived);
  });
  it("rolls back the promotion, event, version and checkpoints if persistence fails", async () => {
    const { s } = await qualifyingSession();
    const before = await snapshot(s), scope = await loadReplayScope(s.id);
    const commands = await prisma.replayCommand.count({ where: { replaySessionId: s.id } });
    const checkpoints = await prisma.replayCheckpoint.count({ where: { projectionId: s.activeProjectionId } });
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_promotion BEFORE INSERT ON PropPracticeEvent WHEN NEW.type='PROMOTED' BEGIN SELECT RAISE(ABORT, 'test promotion failure'); END`);
    try { await expect(scoped(s, () => confirmPropPromotion({ expectedVersion: scope.version, requestId: randomUUID() }))).rejects.toThrow(); }
    finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_promotion"); }
    expect(await snapshot(s)).toEqual(before); expect((await loadReplayScope(s.id)).version).toBe(scope.version);
    expect(await prisma.replayCommand.count({ where: { replaySessionId: s.id } })).toBe(commands);
    expect(await prisma.replayCheckpoint.count({ where: { projectionId: s.activeProjectionId } })).toBe(checkpoints);
  });
  it("keeps single and batch advancement equivalent after a same-day manual switch", async () => {
    const { s: a } = await qualifyingSession(), { s: b } = await qualifyingSession();
    for (const s of [a, b]) await scoped(s, async () => confirmPropPromotion({ expectedVersion: (await loadReplayScope(s.id)).version, requestId: randomUUID() }));
    for (const s of [a, b]) { await order(s, "BUY"); await advance(s); await order(s, "SELL", 1, { executeAtCurrentClose: true }); }
    await advance(a, 3); for (let index = 0; index < 3; index++) await advance(b);
    expect((await snapshot(a))!.propAccount!.state).toEqual((await snapshot(b))!.propAccount!.state);
  });
});
