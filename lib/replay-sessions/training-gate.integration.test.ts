import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { randomUUID } = await import("node:crypto");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  return { prisma: new PrismaClient({ datasourceUrl: `file:${join(tmpdir(), `training-gate-${randomUUID()}.db`)}` }), replayDatabaseQueryCount: () => null };
});
import { prisma } from "@/lib/db";
import { createReplaySession, restartReplaySession } from "./service";
import { loadReplayScope, runWithReplayScope } from "./scope";
import { POST as accountPOST } from "@/app/api/market-datasets/[id]/paper-session/route";
import { POST as orderPOST } from "@/app/api/market-datasets/[id]/paper-session/orders/route";
import { PATCH as orderPATCH, DELETE as orderDELETE } from "@/app/api/market-datasets/[id]/paper-session/orders/[orderId]/route";
import { POST as advancePOST } from "@/app/api/market-datasets/[id]/replay/advance/route";
import { POST as syncPOST } from "@/app/api/market-datasets/[id]/replay/sync/route";
import { GET as gateGET, POST as gatePOST, PUT as gatePUT } from "@/app/api/replay-sessions/[sessionId]/training-gate/route";
import { PATCH as strategyPATCH, DELETE as strategyDELETE } from "@/app/api/trade-options/[id]/route";
import { PATCH as journalPATCH } from "@/app/api/market-datasets/[id]/paper-journal/entries/[entryId]/route";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { advancePaperTrading } from "@/lib/paper-trading/engine";
import { createDeterministicEventIdFactory } from "@/lib/paper-trading/deterministic-id";
import { applySpeculativeAdvance, paperStateFingerprint } from "@/lib/paper-trading/speculative";
import { createPaperDeltaAccumulator, recordPaperAdvance, buildPaperReplayDelta } from "@/lib/market-replay/client-sync";
import { serializeSourceBar } from "@/lib/market-replay/dataset";
import { logicalId } from "./identity";
import { replayJournalEntryApiHref } from "@/lib/paper-trading/journal-links";

let databaseFile = "";
let serial = 0;
beforeAll(async () => {
  databaseFile = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${databaseFile}` }, stdio: "pipe" });
  // Initialization is idempotent, and all new columns survive a second run.
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${databaseFile}` }, stdio: "pipe" });
}, 30000);
afterAll(async () => { await prisma.$disconnect(); if (databaseFile.includes("training-gate-")) rmSync(databaseFile, { force: true }); });
const base = Date.UTC(2026, 9, 14);
async function setup(mode: "TRAINING" | "LIVE_REPLAY" = "TRAINING", prices = [100, 100, 99, 105], commissionBps = 0) {
  const id = `gate-market-${++serial}`;
  await prisma.marketDataset.create({ data: { id, name: id, symbol: "QA", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: 50, startTime: new Date(base), endTime: new Date(base + 49 * 60000) } });
  await prisma.marketBar.createMany({ data: Array.from({ length: 50 }, (_, sequence) => ({ datasetId: id, sequence, timestamp: new Date(base + sequence * 60000), open: prices[sequence] ?? 100, high: prices[sequence] ?? 100, low: prices[sequence] ?? 100, close: prices[sequence] ?? 100 })) });
  const session = await createReplaySession(id, { name: id, mode, timestamp: new Date(base).toISOString(), playbackRate: 100, displayIntervalSeconds: 60, displaySession: "ETH" });
  const account = await accountPOST(await req(session.id, "POST", { initialCapital: 10000, currency: "USD", commissionBps, slippageBps: 0 }), ctx(id));
  expect(account.status).toBe(201);
  await advance(session.id);
  return session;
}
const ctx = (id: string, extra: { orderId?: string; entryId?: string } = {}) => ({ params: Promise.resolve({ id, orderId: extra.orderId ?? "", entryId: extra.entryId ?? "" }) });
async function req(sessionId: string, method: string, body?: unknown) {
  const scope = await loadReplayScope(sessionId);
  return new Request(`http://localhost/api/test?replaySessionId=${sessionId}`, { method, headers: { "Content-Type": "application/json", "X-Replay-Projection": scope.projectionId }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function snapshot(sessionId: string) { const scope = await loadReplayScope(sessionId); return (await runWithReplayScope(scope, () => getPaperSessionSnapshot(scope.datasetId)))!; }
async function advance(sessionId: string) {
  const scope = await loadReplayScope(sessionId);
  const account = await snapshot(sessionId);
  const response = await advancePOST(await req(sessionId, "POST", { expectedCurrentSequence: account.session.lastProcessedSequence, expectedVersion: account.session.version, count: 1 }), ctx(scope.datasetId));
  expect(response.status).toBe(200);
  return (await response.json()).snapshot as Awaited<ReturnType<typeof snapshot>>;
}
async function start(sessionId: string, tradeCount = 10, handler = gatePOST) {
  const scope = await loadReplayScope(sessionId);
  return handler(await req(sessionId, handler === gatePOST ? "POST" : "PUT", { tradeCount, expectedVersion: scope.version }), { params: Promise.resolve({ sessionId }) });
}
async function strategy() {
  return prisma.tradeOption.create({ data: { type: "STRATEGY", name: `趋势-${++serial}`, checklist: JSON.stringify([{ id: "trend", text: "顺势" }, { id: "risk", text: "风险可接受" }]) } });
}
async function place(sessionId: string, input: Record<string, unknown> = {}) {
  const scope = await loadReplayScope(sessionId);
  const account = await snapshot(sessionId);
  return orderPOST(await req(sessionId, "POST", { side: "BUY", type: "MARKET", quantity: 1, price: null, expectedVersion: account.session.version, ...input }), ctx(scope.datasetId));
}
const approval = (s: { id: string; checklistVersion: number }, checkedItemIds = ["trend", "risk"]) => ({ strategyId: s.id, checklistVersion: s.checklistVersion, checkedItemIds });

describe("training gate APIs and persistence", () => {
  it.each([
    ["TRAINING", false], ["TRAINING", true], ["LIVE_REPLAY", false], ["LIVE_REPLAY", true],
  ] as const)("saves annotations through encoded journal URLs in %s (archived=%s) without changing trading state", async (mode, archived) => {
    const session = await setup(mode), s = await strategy();
    await place(session.id); await advance(session.id);
    await place(session.id, { side: "SELL", reduceOnly: true }); await advance(session.id);
    const scope = await loadReplayScope(session.id);
    const entry = await prisma.replayJournalEntry.findFirstOrThrow({ where: { projectionId: scope.projectionId } });
    expect(entry.id).toContain("%3A");
    if (archived) await prisma.replaySession.update({ where: { id: session.id }, data: { status: "ARCHIVED" } });
    const before = await snapshot(session.id);
    const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } });
    const reason = await prisma.tradeReason.create({ data: { name: `URL-${session.id}`, normalizedName: `url-${session.id}` } });
    const apply = async (url: URL, body: unknown) => journalPATCH(new Request(url, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), ctx(session.datasetId, { entryId: decodeURIComponent(url.pathname.split("/").at(-1)!) }));
    const broken = new URL(`/api/market-datasets/${session.datasetId}/paper-journal/entries/${entry.id}?replaySessionId=${session.id}`, "http://localhost");
    expect((await apply(broken, { setupOptionId: s.id })).status).toBe(404);
    const url = new URL(replayJournalEntryApiHref(session.datasetId, entry.id), "http://localhost");
    url.searchParams.set("replaySessionId", session.id);
    for (const body of [{ setupOptionId: s.id }, { tradeReasonIds: [reason.id] }, { review: "保存 Setup 后补充复盘" }, { setupOptionId: null }]) {
      const response = await apply(url, body);
      expect(response.status).toBe(200);
      expect((await response.json()).id).toBe(entry.id);
    }
    const updated = await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { tradeReasons: true } });
    expect(updated).toEqual({ ...entry, review: "保存 Setup 后补充复盘", setupOptionId: null, tradeReasons: [reason] });
    expect(await snapshot(session.id)).toEqual(before);
    expect(await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).toEqual(progress);
    const other = await setup(mode);
    url.searchParams.set("replaySessionId", other.id);
    expect((await apply(url, { setupOptionId: s.id })).status).toBe(404);
    expect((await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entry.id } })).setupOptionId).toBeNull();
  });

  it("enforces strategy, checklist completeness/version and locked configuration", async () => {
    const session = await setup(), s = await strategy();
    expect((await start(session.id, 3)).status).toBe(200);
    expect((await start(session.id, 1, gatePUT)).status).toBe(409);
    expect((await start(session.id)).status).toBe(409);
    expect((await place(session.id)).status).toBe(400);
    expect((await place(session.id, { gateApproval: approval(s, ["trend"]) })).status).toBe(400);
    expect((await place(session.id, { gateApproval: approval(s, ["trend", "risk", "risk"]) })).status).toBe(400);
    expect((await place(session.id, { gateApproval: { ...approval(s), checklistVersion: 999 } })).status).toBe(409);
    const empty = await prisma.tradeOption.create({ data: { type: "STRATEGY", name: `empty-${++serial}` } });
    expect((await place(session.id, { gateApproval: approval(empty) })).status).toBe(400);
    expect((await place(session.id, { gateApproval: approval(s) })).status).toBe(201);
    const completed = await advance(session.id);
    expect(completed.session.trainingGate).toMatchObject({ active: true, completedCount: 1, targetCount: 3 });
    expect(completed.openLots![0].discipline?.strategyName).toBe(s.name);
  });
  it("cancels unchecked entry orders, retains pure exit orders and never gates live replay", async () => {
    const training = await setup();
    await place(training.id); await advance(training.id);
    await place(training.id, { type: "LIMIT", price: 90 });
    await place(training.id, { side: "SELL", type: "LIMIT", price: 110, quantity: 0.5 });
    expect((await start(training.id, 2)).status).toBe(200);
    const account = await snapshot(training.id);
    expect(account.activeOrders).toHaveLength(1);
    expect(account.activeOrders[0]).toMatchObject({ side: "SELL", reduceOnly: true });
    expect(account.session.trainingGate?.cancelledOrderCount).toBe(1);
    const live = await setup("LIVE_REPLAY");
    expect((await start(live.id)).status).toBe(403);
    expect((await place(live.id)).status).toBe(201);
  });
  it("automatically triggers from two separately completed FIFO entries", async () => {
    const session = await setup();
    await start(session.id, 4, gatePUT);
    await place(session.id); await place(session.id); await advance(session.id);
    await place(session.id, { side: "SELL", quantity: 2 });
    await place(session.id, { type: "LIMIT", price: 90 });
    const closed = await advance(session.id);
    expect(closed.session.trainingGate).toMatchObject({ active: true, targetCount: 4, source: "LOSS_STREAK", completedCount: 0, cancelledOrderCount: 1 });
    expect(closed.activeOrders).toEqual([]);
    expect((await place(session.id)).status).toBe(400);
  });
  it.each(["MARKET", "LIMIT", "STOP"] as const)("infers a %s reduction, retains it through amendments and does not consume gate entries", async (type) => {
    const session = await setup();
    await place(session.id, { quantity: 2 }); await advance(session.id); await start(session.id, 3);
    expect((await place(session.id, { side: "SELL", type, price: type === "MARKET" ? null : 99, quantity: 1 })).status).toBe(201);
    let account = await snapshot(session.id);
    const exit = account.activeOrders.find((order) => order.side === "SELL")!;
    expect(exit.reduceOnly).toBe(true);
    const amended = await orderPATCH(await req(session.id, "PATCH", { quantity: 99, expectedVersion: account.session.version }), ctx(session.datasetId, { orderId: exit.id }));
    expect(amended.status).toBe(200);
    account = await advance(session.id);
    expect(account.session.netQuantity).toBe(0);
    expect(account.session.trainingGate?.completedCount).toBe(0);
  });
  it("amends an approved entry freely and preserves its original snapshot after strategy changes", async () => {
    const session = await setup(), s = await strategy(); await start(session.id, 2);
    expect((await place(session.id, { type: "LIMIT", price: 90, stopLoss: 80, takeProfit: 120, gateApproval: approval(s) })).status).toBe(201);
    const changed = await strategyPATCH(new Request("http://localhost/api/strategy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "改名", checklist: [{ id: "new", text: "新的要求" }], checklistVersion: s.checklistVersion }) }), { params: Promise.resolve({ id: s.id }) });
    expect(changed.status).toBe(200);
    let account = await snapshot(session.id);
    const original = account.activeOrders[0];
    const amended = await orderPATCH(await req(session.id, "PATCH", { price: 100, quantity: 2, stopLoss: 80, takeProfit: 120, expectedVersion: account.session.version }), ctx(session.datasetId, { orderId: original.id }));
    expect(amended.status).toBe(200);
    account = await advance(session.id);
    expect(account.openLots![0].discipline).toEqual(original.discipline);
    expect(account.session.trainingGate?.completedCount).toBe(1);
    const deletion = await strategyDELETE(new Request("http://localhost/api/strategy", { method: "DELETE" }), { params: Promise.resolve({ id: s.id }) });
    expect((await deletion.json()).deactivated).toBe(true);
  });
  it("automatically records each entry strategy on partial-close logs and retains immutable checks after annotation edits", async () => {
    const session = await setup(), a = await strategy(), b = await strategy(); await start(session.id, 3);
    await place(session.id, { quantity: 2, gateApproval: approval(a) });
    await place(session.id, { gateApproval: approval(b) }); await advance(session.id);
    await place(session.id, { side: "SELL", quantity: 1 }); await advance(session.id);
    await place(session.id, { side: "SELL", quantity: 2 }); await advance(session.id);
    const scope = await loadReplayScope(session.id);
    const entries = await prisma.replayJournalEntry.findMany({ where: { projectionId: scope.projectionId }, orderBy: { no: "asc" } });
    expect(entries.map((entry) => entry.setupOptionId)).toEqual([a.id, a.id, b.id]);
    const original = entries[0].discipline;
    const edited = await journalPATCH(await req(session.id, "PATCH", { setupOptionId: b.id }), ctx(session.datasetId, { entryId: entries[0].id }));
    expect(edited.status).toBe(200);
    expect((await prisma.replayJournalEntry.findUniqueOrThrow({ where: { id: entries[0].id } })).discipline).toBe(original);
  });
  it("retains gate state after reload, isolates sessions and restarts an active gate from zero", async () => {
    const session = await setup(), other = await setup(), s = await strategy(); await start(session.id, 3);
    await place(session.id, { gateApproval: approval(s) }); await advance(session.id);
    expect((await loadReplayScope(session.id)).trainingGate).toMatchObject({ active: true, completedCount: 1 });
    expect((await loadReplayScope(other.id)).trainingGate?.active).toBe(false);
    const read = await gateGET(await req(session.id, "GET"), { params: Promise.resolve({ sessionId: session.id }) });
    expect((await read.json()).gate.completedCount).toBe(1);
    const next = await runWithReplayScope(await loadReplayScope(session.id), () => restartReplaySession());
    expect((await loadReplayScope(next.id)).trainingGate).toMatchObject({ active: true, tradeCount: 3, targetCount: 3, completedCount: 0 });
    expect((await loadReplayScope(session.id)).status).toBe("ARCHIVED");
  });
  it("rejects forged client counters and approval snapshots; accepts and deduplicates an authentic sync", async () => {
    const session = await setup(), s = await strategy(); await start(session.id, 3);
    await place(session.id, { gateApproval: approval(s) });
    const current = await snapshot(session.id);
    const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } });
    const record = await prisma.marketBar.findUniqueOrThrow({ where: { datasetId_sequence: { datasetId: session.datasetId, sequence: 1 } } });
    const result = advancePaperTrading({ state: current.session, orders: current.activeOrders, lots: current.openLots, bar: serializeSourceBar(record), makeId: createDeterministicEventIdFactory(current.session.id, progress.generation, 1), journalContext: null });
    const accumulator = createPaperDeltaAccumulator(0);
    recordPaperAdvance(accumulator, current, result, true, null, progress.generation);
    const delta = buildPaperReplayDelta(accumulator, applySpeculativeAdvance(current, result));
    const body = { generation: progress.generation, requestId: "authentic", confirmedSequence: 0, syncVersion: progress.syncVersion, dataVersion: 1, expectedPaperVersion: current.session.version, targetSequence: 1, paperDelta: delta };
    const forged = structuredClone(delta);
    forged.state.trainingGate!.completedCount = 3;
    forged.fingerprint = paperStateFingerprint(forged.state, forged.activeOrders, forged.openLots);
    expect((await syncPOST(await req(session.id, "POST", { ...body, paperDelta: forged }), ctx(session.datasetId))).status).toBe(400);
    const forgedChecks = structuredClone(delta);
    forgedChecks.orderChanges[0].discipline!.strategyName = "伪造";
    expect((await syncPOST(await req(session.id, "POST", { ...body, paperDelta: forgedChecks }), ctx(session.datasetId))).status).toBe(400);
    const accepted = await syncPOST(await req(session.id, "POST", body), ctx(session.datasetId));
    expect(accepted.status).toBe(200);
    const receipt = await accepted.json();
    expect(await (await syncPOST(await req(session.id, "POST", body), ctx(session.datasetId))).json()).toEqual(receipt);
    expect((await snapshot(session.id)).session.trainingGate?.completedCount).toBe(1);
    expect(await prisma.paperFill.count({ where: { sessionId: { endsWith: `::${current.session.id}` } } })).toBe(1);
    expect(logicalId(result.orders[0].id)).toBe(current.activeOrders[0].id);
  });
  it("does not count cancelled approved orders", async () => {
    const session = await setup(), s = await strategy(); await start(session.id, 2);
    await place(session.id, { type: "LIMIT", price: 90, gateApproval: approval(s) });
    const account = await snapshot(session.id);
    const cancelled = await orderDELETE(await req(session.id, "DELETE", { expectedVersion: account.session.version }), ctx(session.datasetId, { orderId: account.activeOrders[0].id }));
    expect(cancelled.status).toBe(200);
    expect((await advance(session.id)).session.trainingGate?.completedCount).toBe(0);
  });
  it("reconstructs the net result of an existing partially closed entry without retroactive triggers", async () => {
    const session = await setup("TRAINING", [100, 100, 90, 105], 10);
    await place(session.id, { quantity: 2 }); await advance(session.id);
    await place(session.id, { side: "SELL", quantity: 1 }); await advance(session.id);
    const scope = await loadReplayScope(session.id);
    const account = await prisma.paperTradingSession.findUniqueOrThrow({ where: { projectionId: scope.projectionId } });
    const lot = await prisma.paperPositionLot.findFirstOrThrow({ where: { sessionId: account.id } });
    await prisma.paperPositionLot.update({ where: { id: lot.id }, data: { entryNetPnl: null } });
    const reloaded = await snapshot(session.id);
    expect(reloaded.openLots![0].entryNetPnl).toBeCloseTo(-10.29);
    expect(reloaded.session.trainingGate?.lossStreak).toBe(0);
    await place(session.id, { side: "SELL", quantity: 1 });
    expect((await advance(session.id)).session.trainingGate).toMatchObject({ active: false, lossStreak: 1 });
  });

});
