import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { randomUUID } = await import("node:crypto");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  return {
    prisma: new PrismaClient({ datasourceUrl: `file:${join(tmpdir(), `replay-sessions-${randomUUID()}.db`)}` }),
    replayDatabaseQueryCount: () => null,
  };
});

import { prisma } from "@/lib/db";
import { createReplaySession } from "./service";
import { loadReplayScope, runWithReplayScope } from "./scope";
import { GET as progressGET } from "@/app/api/market-datasets/[id]/progress/route";
import { POST as accountPOST } from "@/app/api/market-datasets/[id]/paper-session/route";
import { POST as orderPOST } from "@/app/api/market-datasets/[id]/paper-session/orders/route";
import { DELETE as entryDELETE } from "@/app/api/market-datasets/[id]/paper-journal/entries/[entryId]/route";
import { POST as advancePOST } from "@/app/api/market-datasets/[id]/replay/advance/route";
import { POST as drawingPOST, GET as drawingsGET } from "@/app/api/market-datasets/[id]/drawings/route";
import { PATCH as sessionPATCH } from "@/app/api/replay-sessions/[sessionId]/route";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { DEFAULT_TREND_LINE_STYLE } from "@/lib/market-replay/chart-drawings";
import { createCorrection, commitCorrection, cancelCorrection, readCorrection } from "./corrections";
import { runReplayCorrection } from "./correction-runner";
import { GET as journalGET } from "@/app/api/market-datasets/[id]/paper-journal/route";
import { GET as pdfSnapshotGET } from "@/app/api/market-datasets/[id]/paper-journal/sessions/[sessionId]/export-data/route";
import { GET as locateGET } from "@/app/api/replay-sessions/[sessionId]/locate/route";
import { startReplayCorrectionWorker } from "./worker";
import { PATCH as amendOrderPATCH } from "@/app/api/market-datasets/[id]/paper-session/orders/[orderId]/route";
import { DELETE as cancelOrderDELETE } from "@/app/api/market-datasets/[id]/paper-session/orders/[orderId]/route";

let file = "";
const base = new Date("2026-10-01T00:00:00Z");
beforeAll(async () => {
  file = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${file}` }, stdio: "pipe" });
  await prisma.marketDataset.create({ data: {
    id: "shared", name: "Shared", symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60,
    barCount: 8, startTime: base, endTime: new Date(base.getTime() + 420_000),
  } });
  await prisma.marketBar.createMany({ data: Array.from({ length: 8 }, (_, sequence) => ({
    datasetId: "shared", sequence, timestamp: new Date(base.getTime() + sequence * 60_000),
    open: 100 + sequence, high: 102 + sequence, low: 99 + sequence, close: 101 + sequence,
  })) });
}, 30_000);
afterAll(async () => {
  await prisma.$disconnect();
  if (file.includes("replay-sessions-")) rmSync(file, { force: true });
});

async function create(mode: "TRAINING" | "LIVE_REPLAY") {
  return createReplaySession("shared", { name: mode, mode, timestamp: base.toISOString(), playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });
}
const context = { params: Promise.resolve({ id: "shared" }) };
function request(session: { id: string; activeProjectionId: string | null }, method: string, body?: unknown, query = "") {
  return new Request(`http://localhost/api/test?replaySessionId=${encodeURIComponent(session.id)}${query}`, {
    method, headers: { "Content-Type": "application/json", "X-Replay-Projection": session.activeProjectionId! },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("multiple replay sessions on shared market data", () => {
  it("requires explicit identity and isolates progress, accounts, commands and drawings", async () => {
    const a = await create("TRAINING");
    const b = await create("LIVE_REPLAY");
    expect((await progressGET(new Request("http://localhost/api/test"), context)).status).toBe(409);
    for (const session of [a, b]) {
      expect((await accountPOST(request(session, "POST", { initialCapital: session === a ? 10_000 : 20_000, currency: "USD", commissionBps: 0, slippageBps: 0 }), context)).status).toBe(201);
    }
    const first = await advancePOST(request(a, "POST", { count: 1, expectedCurrentSequence: -1, expectedVersion: 1 }), context);
    expect(first.status).toBe(200);
    const state = await first.json();
    expect(state.currentSequence).toBe(0);
    expect((await (await progressGET(request(b, "GET"), context)).json()).progress.currentSequence).toBe(-1);
    expect(state.snapshot.session.initialCapital).toBe(10_000);

    const placed = await orderPOST(request(a, "POST", { side: "BUY", type: "MARKET", quantity: 1, price: null, expectedVersion: state.snapshot.session.version }), context);
    expect(placed.status).toBe(201);
    const placedState = await placed.json();
    expect((await advancePOST(request(a, "POST", { count: 1, expectedCurrentSequence: 0, expectedVersion: placedState.snapshot.session.version }), context)).status).toBe(200);
    expect(await prisma.paperFill.count({ where: { session: { projectionId: a.activeProjectionId } } })).toBe(1);
    expect(await prisma.paperFill.count({ where: { session: { projectionId: b.activeProjectionId } } })).toBe(0);
    expect(await prisma.replayCommand.count({ where: { replaySessionId: a.id, type: "ORDER_CREATE" } })).toBe(1);
    const bScope = await loadReplayScope(b.id);
    const bSnapshot = await runWithReplayScope(bScope, () => getPaperSessionSnapshot("shared"));
    expect(bSnapshot?.session.netQuantity).toBe(0);
    expect(bSnapshot?.session.initialCapital).toBe(20_000);

    const drawing = { type: "TREND_LINE", geometry: { start: { timestamp: base.toISOString(), sourceSequence: 0, price: 100 }, end: { timestamp: new Date(base.getTime() + 60_000).toISOString(), sourceSequence: 1, price: 101 } }, style: DEFAULT_TREND_LINE_STYLE };
    const drawResponse = await drawingPOST(request(a, "POST", drawing), context);
    // The real drawing schema is deliberately used; assertions below verify ownership.
    if (drawResponse.status !== 201) throw new Error(JSON.stringify(await drawResponse.json()));
    expect((await (await drawingsGET(request(a, "GET"), context)).json()).drawings).toHaveLength(1);
    expect((await (await drawingsGET(request(b, "GET"), context)).json()).drawings).toHaveLength(0);
    expect(await prisma.marketBar.count({ where: { datasetId: "shared" } })).toBe(8);
  });

  it("retains archived state, prohibits training deletion and rejects old projections", async () => {
    const session = await create("TRAINING");
    const scope = await loadReplayScope(session.id);
    const archived = await sessionPATCH(new Request("http://localhost/api/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: scope.version, status: "ARCHIVED" }) }), { params: Promise.resolve({ sessionId: session.id }) });
    expect(archived.status).toBe(200);
    expect(await prisma.replayProgress.findUnique({ where: { replaySessionId: session.id } })).not.toBeNull();
    const blocked = await entryDELETE(request(session, "DELETE"), { params: Promise.resolve({ id: "shared", entryId: "any-entry" }) });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).code).toBe("MODE_NOT_ALLOWED");
    const other = await create("LIVE_REPLAY");
    const stale = await accountPOST(request({ ...other, activeProjectionId: "old-projection" }, "POST", { initialCapital: 1000, currency: "USD" }), context);
    expect(stale.status).toBe(409);
    expect(await prisma.paperTradingSession.count({ where: { projectionId: other.activeProjectionId } })).toBe(0);
  });
  it("keeps mode immutable and rejects a session belonging to another dataset", async () => {
    const session = await create("TRAINING");
    const changed = await sessionPATCH(new Request("http://localhost/api/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: session.version, mode: "LIVE_REPLAY" }) }), { params: Promise.resolve({ sessionId: session.id }) });
    expect(changed.status).toBe(400);
    expect((await loadReplayScope(session.id)).mode).toBe("TRAINING");
    const wrongDataset = await progressGET(request(session, "GET"), { params: Promise.resolve({ id: "other-dataset" }) });
    expect(wrongDataset.status).toBe(404);
    await expect(createCorrection(session.id, { requestId: "training-rewind", type: "REWIND", targetSequence: -1, expectedVersion: session.version })).rejects.toMatchObject({ code: "MODE_NOT_ALLOWED" });
  });
});

describe("complete replay corrections", () => {
  async function account(session: Awaited<ReturnType<typeof create>>) {
    const response = await accountPOST(request(session, "POST", { initialCapital: 10_000, currency: "USD", commissionBps: 10, slippageBps: 20 }), context);
    expect(response.status).toBe(201);
  }
  async function snapshot(sessionId: string) {
    return runWithReplayScope(await loadReplayScope(sessionId), () => getPaperSessionSnapshot("shared"));
  }
  async function advance(session: Awaited<ReturnType<typeof create>>, count = 1) {
    const state = await snapshot(session.id);
    const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } });
    const response = await advancePOST(request(session, "POST", { count, expectedCurrentSequence: progress.currentSequence, expectedVersion: state!.session.version }), context);
    if (response.status !== 200) throw new Error(JSON.stringify(await response.json()));
    return snapshot(session.id);
  }
  async function order(session: Awaited<ReturnType<typeof create>>, side: "BUY" | "SELL", quantity: number, reduceOnly = false) {
    const state = await snapshot(session.id);
    const response = await orderPOST(request(session, "POST", { side, type: "MARKET", price: null, quantity, reduceOnly, expectedVersion: state!.session.version }), context);
    expect(response.status).toBe(201);
  }
  it("restores the target close before user actions and retains the old version", async () => {
    const session = await create("LIVE_REPLAY");
    await account(session); await advance(session); await order(session, "BUY", 2);
    const expected = await advance(session, 2);
    await order(session, "SELL", 1, true); await advance(session);
    const before = await snapshot(session.id);
    expect(before!.session.netQuantity).toBe(1);
    const job = await createCorrection(session.id, { requestId: "rewind-target", type: "REWIND", targetSequence: 2, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id);
    const ready = await prisma.replayCorrectionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(ready.error).toBeNull(); expect(ready.status).toBe("READY");
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(1);
    await commitCorrection(session.id, job.id);
    const restored = await snapshot(session.id);
    expect(restored!.session).toEqual(expected!.session);
    expect(restored!.activeOrders).toEqual(expected!.activeOrders);
    expect(restored!.openLots).toEqual(expected!.openLots);
    expect(await prisma.replayProjection.findUnique({ where: { id: session.activeProjectionId } })).toMatchObject({ status: "HISTORICAL" });
    expect(await prisma.paperFill.count({ where: { session: { projectionId: session.activeProjectionId } } })).toBe(2);
    expect(await prisma.paperFill.count({ where: { session: { projectionId: ready.targetProjectionId } } })).toBe(1);
    const historical = await progressGET(request(session, "GET", undefined, `&viewProjectionId=${encodeURIComponent(session.activeProjectionId!)}`), context);
    expect(historical.status).toBe(200);
    const historicState = await historical.json();
    expect(historicState.progress.currentSequence).toBe(3);
    expect(historicState.snapshot.session.netQuantity).toBe(1);
    expect((await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).currentSequence).toBe(2);
    const rejected = await orderPOST(request(session, "POST", { side: "SELL", type: "MARKET", price: null, quantity: 1, expectedVersion: restored!.session.version }), context);
    expect(rejected.status).toBe(409);
  });
  it("deletes a closed cycle and replays later trades with stable annotations and numbering", async () => {
    const session = await create("LIVE_REPLAY");
    await account(session); await advance(session);
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    const originals = await prisma.replayJournalEntry.findMany({ where: { projectionId: session.activeProjectionId }, orderBy: { closedSequence: "asc" } });
    expect(originals).toHaveLength(2);
    await prisma.replayJournalEntry.update({ where: { id: originals[1].id }, data: { review: "后续交易复盘保留" } });
    const job = await createCorrection(session.id, { requestId: "delete-cycle", type: "DELETE_CYCLE", cycleKey: originals[0].cycleKey!, expectedVersion: (await loadReplayScope(session.id)).version });
    expect((await createCorrection(session.id, { requestId: "delete-cycle", type: "DELETE_CYCLE", cycleKey: originals[0].cycleKey!, expectedVersion: job.expectedVersion })).id).toBe(job.id);
    await runReplayCorrection(job.id);
    const ready = await prisma.replayCorrectionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(ready.error).toBeNull(); expect(ready.status).toBe("READY");
    // Annotation changes during the preview are refreshed at commit.
    await prisma.replayJournalEntry.update({ where: { id: originals[1].id }, data: { review: "确认前的新复盘" } });
    await commitCorrection(session.id, job.id);
    const corrected = await snapshot(session.id);
    expect(corrected!.stats.tradeCount).toBe(1);
    expect(corrected!.session.netQuantity).toBe(0);
    const entries = await prisma.replayJournalEntry.findMany({ where: { projectionId: ready.targetProjectionId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ logicalKey: originals[1].logicalKey, accountNo: originals[1].accountNo, no: originals[1].no,
      entryPrice: originals[1].entryPrice, exitPrice: originals[1].exitPrice, quantity: originals[1].quantity, review: "确认前的新复盘" });
    expect(await prisma.replayJournalEntry.count({ where: { projectionId: session.activeProjectionId } })).toBe(2);
    expect((await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).currentSequence).toBe(4);
    const oldJournal = await journalGET(request(session, "GET", undefined, `&scope=history&viewProjectionId=${encodeURIComponent(session.activeProjectionId!)}`), context);
    expect((await oldJournal.json()).pagination.totalItems).toBe(2);
    const journal = await prisma.replayJournalSession.findUniqueOrThrow({ where: { replaySessionId: session.id } });
    const oldExport = await pdfSnapshotGET(request(session, "GET", undefined, `&viewProjectionId=${encodeURIComponent(session.activeProjectionId!)}`), { params: Promise.resolve({ id: "shared", sessionId: journal.id }) });
    const exported = await oldExport.json();
    expect(exported.entries).toHaveLength(2); expect(exported.session.name).toContain("实盘重演"); expect(exported.session.name).toContain("回放撮合");
    expect(exported.endSequence).toBe(4);
  });
  it("leaves the visible state unchanged on cancellation or history conflicts", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session, 2);
    const original = await snapshot(session.id);
    const job = await createCorrection(session.id, { requestId: "cancel", type: "REWIND", targetSequence: 0, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id); await cancelCorrection(session.id, job.id);
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
    expect(await snapshot(session.id)).toEqual(original);
    const next = await createCorrection(session.id, { requestId: "history-conflict", type: "REWIND", targetSequence: 0, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(next.id);
    await prisma.marketDataset.update({ where: { id: "shared" }, data: { historyVersion: { increment: 1 } } });
    await expect(commitCorrection(session.id, next.id)).rejects.toMatchObject({ code: "HISTORY_CHANGED" });
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
    await cancelCorrection(session.id, next.id);
    await prisma.marketDataset.update({ where: { id: "shared" }, data: { historyVersion: { decrement: 1 } } });
  });
  it("freezes writes during preview and retains the visible account after a reconstruction failure", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session, 4);
    const original = await snapshot(session.id);
    const input = { requestId: "missing-context", type: "REWIND" as const, targetSequence: 2, expectedVersion: (await loadReplayScope(session.id)).version };
    const job = await createCorrection(session.id, input);
    expect((await createCorrection(session.id, input)).id).toBe(job.id);
    const blocked = await orderPOST(request(session, "POST", { side: "BUY", type: "MARKET", quantity: 1, expectedVersion: original!.session.version }), context);
    expect(blocked.status).toBe(409);
    expect(await prisma.paperOrder.count({ where: { session: { projectionId: session.activeProjectionId } } })).toBe(0);
    await prisma.replayContextRun.deleteMany({ where: { projectionId: session.activeProjectionId! } });
    await runReplayCorrection(job.id);
    expect((await readCorrection(session.id, job.id)).status).toBe("FAILED");
    expect((await prisma.replaySession.findUniqueOrThrow({ where: { id: session.id } })).pendingCorrectionId).toBeNull();
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
    expect(await snapshot(session.id)).toEqual(original);
    await expect(commitCorrection(session.id, job.id)).rejects.toMatchObject({ code: "CORRECTION_NOT_READY" });
  });
  it("allows past-only location for training and future location for live replay without moving either cursor", async () => {
    const training = await create("TRAINING");
    const live = await create("LIVE_REPLAY");
    await account(training); await account(live); await advance(training, 2); await advance(live, 2);
    const ctx = (sessionId: string) => ({ params: Promise.resolve({ sessionId }) });
    const time = new Date(base.getTime() + 180_000).toISOString();
    const rejected = await locateGET(new Request(`http://localhost/api/locate?timestamp=${encodeURIComponent(time)}&direction=FORWARD`), ctx(training.id));
    expect(rejected.status).toBe(403);
    const past = await locateGET(new Request(`http://localhost/api/locate?timestamp=${encodeURIComponent(base.toISOString())}`), ctx(training.id));
    expect((await past.json()).sequence).toBe(0);
    const future = await locateGET(new Request(`http://localhost/api/locate?timestamp=${encodeURIComponent(time)}&direction=FORWARD`), ctx(live.id));
    expect((await future.json()).sequence).toBe(3);
    for (const session of [training, live]) expect((await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).currentSequence).toBe(1);
  });
  it("runs reconstruction in a separate Node process using the same database", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session, 3);
    const job = await createCorrection(session.id, { requestId: "separate-process", type: "REWIND", targetSequence: 1, expectedVersion: (await loadReplayScope(session.id)).version });
    const pid = await startReplayCorrectionWorker(job.id);
    expect(pid).not.toBe(process.pid);
    let state = await readCorrection(session.id, job.id);
    const deadline = Date.now() + 12_000;
    while (["QUEUED", "RUNNING"].includes(state.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = await readCorrection(session.id, job.id);
    }
    expect(state.error).toBeNull(); expect(state.status).toBe("READY");
    expect(state.workerPid).toBe(pid);
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
    await commitCorrection(session.id, job.id);
    expect((await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } })).currentSequence).toBe(1);
  }, 20_000);
  it("unfreezes the session when a queued worker process is missing", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    const job = await createCorrection(session.id, { requestId: "interrupted", type: "REWIND", targetSequence: 0, expectedVersion: (await loadReplayScope(session.id)).version });
    await prisma.replayCorrectionJob.update({ where: { id: job.id }, data: { heartbeatAt: new Date(Date.now() - 60_000), workerPid: null } });
    const state = await readCorrection(session.id, job.id);
    expect(state.status).toBe("INTERRUPTED");
    expect((await prisma.replaySession.findUniqueOrThrow({ where: { id: session.id } })).pendingCorrectionId).toBeNull();
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
  });
  it("treats additions, partial closes and direct reversals as one complete cycle", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    await order(session, "BUY", 2); await advance(session);
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    await order(session, "SELL", 4); await advance(session);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(-2);
    await order(session, "BUY", 2, true); await advance(session);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(0);
    const firstCycle = await prisma.paperFill.findFirstOrThrow({ where: { session: { projectionId: session.activeProjectionId } }, orderBy: { sequence: "asc" } });
    const firstFills = await prisma.paperFill.findMany({ where: { session: { projectionId: session.activeProjectionId } } });
    expect(firstFills).toHaveLength(5);
    expect(new Set(firstFills.map((fill) => fill.cycleKey))).toEqual(new Set([firstCycle.cycleKey]));
    await order(session, "BUY", 1); await advance(session);
    await order(session, "SELL", 1, true); await advance(session);
    const survivor = await prisma.replayJournalEntry.findFirstOrThrow({ where: { projectionId: session.activeProjectionId, closedSequence: 7 } });
    const job = await createCorrection(session.id, { requestId: "complex-cycle", type: "DELETE_CYCLE", cycleKey: firstCycle.cycleKey!, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id);
    const ready = await readCorrection(session.id, job.id); expect(ready.error).toBeNull(); expect(ready.status).toBe("READY");
    await commitCorrection(session.id, job.id);
    const head = await loadReplayScope(session.id);
    const entries = await prisma.replayJournalEntry.findMany({ where: { projectionId: head.projectionId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ logicalKey: survivor.logicalKey, entryPrice: survivor.entryPrice, exitPrice: survivor.exitPrice, accountNo: survivor.accountNo, no: survivor.no });
    expect((await snapshot(session.id))!.stats.tradeCount).toBe(1);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(0);
  });
  it("restores protective amendments and FIFO risk values across a rewind", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    const initial = await snapshot(session.id);
    const entry = await orderPOST(request(session, "POST", { side: "BUY", type: "LIMIT", price: 101, quantity: 2, stopLoss: 99, takeProfit: 109, expectedVersion: initial!.session.version }), context);
    expect(entry.status).toBe(201); await advance(session);
    let current = await snapshot(session.id);
    const stop = current!.activeOrders.find((order) => order.isProtective && order.type === "STOP")!;
    const amendStop = await amendOrderPATCH(request(session, "PATCH", { price: 100.5, expectedVersion: current!.session.version }), { params: Promise.resolve({ id: "shared", orderId: stop.id }) });
    expect(amendStop.status).toBe(200);
    const expected = await advance(session);
    current = await snapshot(session.id);
    const target = current!.activeOrders.find((order) => order.isProtective && order.type === "LIMIT")!;
    const amendTarget = await amendOrderPATCH(request(session, "PATCH", { price: 104.5, expectedVersion: current!.session.version }), { params: Promise.resolve({ id: "shared", orderId: target.id }) });
    expect(amendTarget.status).toBe(200); await advance(session);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(0);
    const job = await createCorrection(session.id, { requestId: "protective-rewind", type: "REWIND", targetSequence: 2, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id); expect((await readCorrection(session.id, job.id)).status).toBe("READY");
    await commitCorrection(session.id, job.id);
    const restored = await snapshot(session.id);
    expect(restored!.session).toEqual(expected!.session);
    expect(restored!.activeOrders).toEqual(expected!.activeOrders);
    expect(restored!.openLots).toEqual(expected!.openLots);
    // A second correction can still reach before the previous reconstruction start.
    const next = await createCorrection(session.id, { requestId: "second-rewind", type: "REWIND", targetSequence: 0, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(next.id); expect((await readCorrection(session.id, next.id)).status).toBe("READY");
    await commitCorrection(session.id, next.id);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(0);
    expect((await snapshot(session.id))!.activeOrders).toHaveLength(0);
  });
  it("preserves orders created and cancelled on the checkpoint bar", async () => {
    const session = await create("LIVE_REPLAY"); await account(session); await advance(session);
    await order(session, "BUY", 1);
    const current = await snapshot(session.id);
    const pending = current!.activeOrders[0];
    const canceled = await cancelOrderDELETE(request(session, "DELETE", { expectedVersion: current!.session.version }), { params: Promise.resolve({ id: "shared", orderId: pending.id }) });
    expect(canceled.status).toBe(200);
    await advance(session, 3);
    const before = await prisma.paperOrder.findFirstOrThrow({ where: { session: { projectionId: session.activeProjectionId }, status: "CANCELLED" } });
    const job = await createCorrection(session.id, { requestId: "same-bar-cancel", type: "REWIND", targetSequence: 1, expectedVersion: (await loadReplayScope(session.id)).version });
    await runReplayCorrection(job.id); expect((await readCorrection(session.id, job.id)).status).toBe("READY");
    await commitCorrection(session.id, job.id);
    const after = await prisma.paperOrder.findFirstOrThrow({ where: { session: { projectionId: (await loadReplayScope(session.id)).projectionId }, status: "CANCELLED" } });
    expect(after).toMatchObject({ createdSequence: before.createdSequence, cancelReason: before.cancelReason, quantity: before.quantity, side: before.side });
    expect((await snapshot(session.id))!.activeOrders).toHaveLength(0);
    expect((await snapshot(session.id))!.session.netQuantity).toBe(0);
  });
});
