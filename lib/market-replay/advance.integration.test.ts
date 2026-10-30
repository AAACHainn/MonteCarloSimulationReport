import type { Prisma } from "@prisma/client";
import { loadReplayScope, runWithReplayScope } from "@/lib/replay-sessions/scope";
import { logicalId, projectionRecordId } from "@/lib/replay-sessions/identity";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const queryAudit = vi.hoisted(() => ({ statements: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const client = createDatabaseClient({ datasourceUrl: `file:${join(tmpdir(), "replay-integration-" + randomUUID() + ".db")}`,
    log: [{ emit: "event", level: "query" }] }, { allowCreate: true });
  (client as unknown as { $on(event: "query", callback: (event: { query: string }) => void): void })
    .$on("query", event => queryAudit.statements.push(event.query));
  return {
    prisma: client,
    replayDatabaseQueryCount: () => null,
  };
});

import { prisma } from "@/lib/db";
import * as snapshotModule from "@/lib/paper-trading/serialize";
import { persistContextRuns } from "@/lib/replay-sessions/context-storage";
import { POST as advanceRoutePOST } from "@/app/api/market-datasets/[id]/replay/advance/route";
import { POST as syncPOSTRoute } from "@/app/api/market-datasets/[id]/replay/sync/route";
import { POST as resetPOSTRoute } from "@/app/api/market-datasets/[id]/replay/reset/route";
import { PATCH as orderPATCHRoute, DELETE as orderDELETERoute } from "@/app/api/market-datasets/[id]/paper-session/orders/[orderId]/route";
import { GET as progressGETRoute, PUT as progressPUTRoute } from "@/app/api/market-datasets/[id]/progress/route";
import { advancePaperTrading } from "@/lib/paper-trading/engine";
import { getPaperSessionSnapshot as rawGetPaperSessionSnapshot, serializePaperSession, serializePaperOrder } from "@/lib/paper-trading/serialize";
import { serializeSourceBar } from "./dataset";
import { createDeterministicEventIdFactory } from "@/lib/paper-trading/deterministic-id";
import { paperOrderUrl } from "@/lib/paper-trading/order-url";
import type { PaperFillData, PaperEquityPointData } from "@/lib/paper-trading/types";
import { GET as windowGET } from "@/app/api/market-datasets/[id]/bars/window/route";
import { GET as chunksGET } from "@/app/api/market-datasets/[id]/bars/chunks/route";
import { resolveDisplaySession } from "./chart-sessions";
import { aggregateMarketBars, getAggregationBucket, mergeSourceBarInto } from "./aggregation";
import { calculateLatestAbr } from "./abr";
import { appendContextRun, type ReplayContextRun } from "@/lib/replay-sessions/context-runs";
import { materializeFlatContexts } from "@/lib/replay-sessions/flat-context";
import { createCorrection, commitCorrection, readCorrection } from "@/lib/replay-sessions/corrections";
import { runReplayCorrection } from "@/lib/replay-sessions/correction-runner";
import { queueAggregation, processAggregationJob } from "./aggregation-jobs";
async function buildAggregations(id: string) { const job = await queueAggregation(id); await processAggregationJob(job.id); }
import { readLaterHistoryWindow, mergeHistoricalBars } from "./historical-window";
import type { AggregatedMarketBarData } from "./types";
import type { ReplayServerResult } from "./server-sync-types";
import { resolveReplayServerResponse } from "./server-response";


const fixtureSessions = new Map<string, string>();
function fixtureRoute<P extends { id: string }>(handler: (request: Request, context: { params: Promise<P> }) => Promise<Response>) {
  return async (incoming: Request, routeContext: { params: Promise<P> }) => {
    const { id } = await routeContext.params;
    const scope = await loadReplayScope(fixtureSessions.get(id)!);
    const url = new URL(incoming.url); url.searchParams.set("replaySessionId", scope.id);
    const headers = new Headers(incoming.headers);
    if (!headers.has("X-Replay-Projection")) headers.set("X-Replay-Projection", scope.projectionId);
    const input = new Request(url, { method: incoming.method, headers,
      ...(!["GET", "HEAD"].includes(incoming.method) ? { body: await incoming.clone().text() } : {}) });
    const response = await handler(input, routeContext);
    if (handler === resetPOSTRoute && response.ok) {
      const body = await response.clone().json();
      if (body.replaySessionId) fixtureSessions.set(id, body.replaySessionId);
    }
    return response;
  };
}
const POST = fixtureRoute(advanceRoutePOST);
const syncPOST = fixtureRoute(syncPOSTRoute);
const resetPOST = fixtureRoute(resetPOSTRoute);
const orderPATCH = fixtureRoute(orderPATCHRoute);
const orderDELETE = fixtureRoute(orderDELETERoute);
const progressGET = fixtureRoute(progressGETRoute);
const progressPUT = fixtureRoute(progressPUTRoute);
async function getPaperSessionSnapshot(id: string) {
  return runWithReplayScope(await loadReplayScope(fixtureSessions.get(id)!), () => rawGetPaperSessionSnapshot(id));
}
async function seedOrder(data: Prisma.PaperOrderUncheckedCreateInput) {
  const account = await prisma.paperTradingSession.findFirstOrThrow({ where: { OR: [{ id: data.sessionId }, { id: { endsWith: "::" + data.sessionId } }], projection: { activeFor: { status: "ACTIVE" } } } });
  return prisma.paperOrder.create({ data: { ...data, sessionId: account.id, id: projectionRecordId(account.projectionId, data.id!) } });
}

let databaseFile = "";
const baseTime = Date.UTC(2026, 8, 1);
const request = (body: unknown) => new Request("http://localhost/api/advance", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const syncRequest = (body: Record<string, unknown> & { expectedProjectionId?: string }) => new Request("http://localhost/api/sync", {
  method: "POST", headers: { "Content-Type": "application/json", ...(body.expectedProjectionId ? { "X-Replay-Projection": body.expectedProjectionId } : {}) }, body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "expectedProjectionId"))),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  const files = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list");
  databaseFile = files[0].file;
  execFileSync(process.execPath, ["scripts/database/init-sqlite.mjs"], {
    env: { ...process.env, DATABASE_URL: `file:${databaseFile}` }, stdio: "pipe",
  });
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  if (databaseFile.includes("replay-integration-")) {
    rmSync(databaseFile, { force: true });
  }
});

async function seed(
  id: string,
  seconds: number,
  count: number,
  start = -1,
  paper = true,
  options: { symbol?: string; startTimeMs?: number } = {},
) {
  const startTimeMs = options.startTimeMs ?? baseTime;
  await prisma.marketDataset.create({ data: {
    id, name: id, symbol: options.symbol ?? "TEST", timeframe: `${seconds}s`, timezone: "UTC",
    sourceIntervalSeconds: seconds, barCount: count, startTime: new Date(startTimeMs),
    endTime: new Date(startTimeMs + (count - 1) * seconds * 1000),
  } });
  for (let from = 0; from < count; from += 1000) {
    await prisma.marketBar.createMany({ data: Array.from({ length: Math.min(1000, count - from) }, (_, offset) => {
      const sequence = from + offset;
      const close = 100 + Math.sin(sequence * seconds / 300);
      return { datasetId: id, sequence, timestamp: new Date(startTimeMs + sequence * seconds * 1000),
        open: close, high: close + 1, low: close - 1, close, volume: 10 };
    }) });
  }
  await buildAggregations(id);
  const replay = await prisma.replaySession.create({ data: { datasetId: id, name: id, mode: "TRAINING", legacy: true } });
  const projection = await prisma.replayProjection.create({ data: { replaySessionId: replay.id, status: "CURRENT", historyVersion: 1, currentSequence: start } });
  await prisma.replaySession.update({ where: { id: replay.id }, data: { activeProjectionId: projection.id } });
  fixtureSessions.set(id, replay.id);
  await prisma.replayProgress.create({ data: {
    datasetId: id, replaySessionId: replay.id, startSequence: start + 1, currentSequence: start,
    playbackRate: 20, displayIntervalSeconds: 300,
  } });
  if (paper) await prisma.paperTradingSession.create({ data: {
    id: projectionRecordId(projection.id, "account-" + id), projectionId: projection.id,
    datasetId: id, initialCapital: 100000, currency: "USD", peakEquity: 100000,
    lastProcessedSequence: start, equitySampleStride: Math.max(1, Math.ceil(count / 20000)),
  } });
}

async function serverSyncBody(id: string, targetSequence: number, requestId: string) {
  const [dataset, progress, snapshot] = await Promise.all([
    prisma.marketDataset.findUniqueOrThrow({ where: { id } }),
    prisma.replayProgress.findFirstOrThrow({ where: { datasetId: id } }),
    getPaperSessionSnapshot(id),
  ]);
  return {
    expectedProjectionId: (await loadReplayScope(fixtureSessions.get(id)!)).projectionId,
    generation: progress.generation, requestId, confirmedSequence: progress.currentSequence,
    syncVersion: progress.syncVersion, dataVersion: dataset.dataVersion, historyVersion: dataset.historyVersion,
    expectedPaperVersion: snapshot?.session.version ?? null, targetSequence,
    contextRuns: [{ fromSequence: progress.currentSequence + 1, toSequence: targetSequence, generation: progress.generation, context: null }],
  };
}

describe("replay advance with real SQLite", () => {

  async function flatBody(id: string, displayIntervalSeconds = 3600, requestId = `flat-${id}`) {
    const progress = await prisma.replayProgress.findFirstOrThrow({ where: { datasetId: id } });
    return { flatOnly: true, requestId, historyVersion: 1, expectedCurrentSequence: progress.currentSequence,
      expectedVersion: (await getPaperSessionSnapshot(id))?.session.version ?? null, displayIntervalSeconds,
      displaySession: "ETH", count: 1, abrLength: 2, displayUtcOffsetMinutes: 0 };
  }

  it.each(["flat", "sync", "display"] as const)("omits unchanged history from %s responses and receipts without losing client history", async path => {
    const id = "compact-payload-" + path;
    await seed(id, 1, 300, 199);
    const account = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
    const discipline = JSON.stringify({ strategyId: "strategy", strategyName: "历史策略", checklistVersion: 1,
      checklist: Array.from({ length: 20 }, (_, n) => ({ id: String(n), text: "核对市场结构与入场条件，保留原始检查记录。".repeat(2) })),
      confirmedAt: new Date(baseTime).toISOString() });
    const orderIds = Array.from({ length: 30 }, (_, n) => projectionRecordId(account.projectionId, "history-" + n));
    await prisma.paperOrder.createMany({ data: orderIds.map((orderId, n) => ({ id: orderId, sessionId: account.id,
      side: "BUY", type: "MARKET", status: "FILLED", quantity: 1, createdSequence: n, activeFromSequence: n,
      filledSequence: n, filledPrice: 100, filledAt: new Date(baseTime + n * 1000), discipline })) });
    await prisma.paperFill.createMany({ data: Array.from({ length: 50 }, (_, n) => ({ id: id + "-fill-" + n,
      sessionId: account.id, orderId: orderIds[n % 30], sequence: n, timestamp: new Date(baseTime + n * 1000),
      side: "BUY", price: 100, quantity: 1, fee: 0, slippageCost: 0, realizedPnl: 0,
      closedQuantity: 0, openedQuantity: 1, netQuantityAfter: 0, reason: "ENTRY" })) });
    await prisma.paperTrade.createMany({ data: Array.from({ length: 30 }, (_, n) => ({ id: id + "-trade-" + n,
      sessionId: account.id, side: "LONG", status: "CLOSED", openedSequence: n * 2,
      openedAt: new Date(baseTime + n * 2000), closedSequence: n * 2 + 1, closedAt: new Date(baseTime + n * 2000 + 1000) })) });
    const makeBody = async (live: boolean) => path === "sync"
      ? { ...await serverSyncBody(id, (await prisma.replayProgress.findFirstOrThrow({ where: { datasetId: id } })).currentSequence + 1,
        live ? "compact" : "full"), ...(live ? { snapshotMode: "LIVE" } : {}) }
      : { ...await flatBody(id, 5, live ? "compact" : "full"), flatOnly: path === "flat", ...(live ? { snapshotMode: "LIVE" } : {}) };
    const send = async (body: Awaited<ReturnType<typeof makeBody>>) => path === "sync"
      ? syncPOST(syncRequest(body), context(id)) : POST(request(body), context(id));
    const fullResponse = await send(await makeBody(false));
    expect(fullResponse.status).toBe(200);
    const fullText = await fullResponse.text();
    const full = JSON.parse(fullText);
    const body = await makeBody(true);
    const firstQuery = queryAudit.statements.length;
    const leanResponse = await send(body);
    const statements = queryAudit.statements.slice(firstQuery);
    expect(leanResponse.status).toBe(200);
    const leanText = await leanResponse.text();
    const lean = JSON.parse(leanText);
    for (const key of ["recentOrders", "recentFills", "recentTrades"]) expect(lean.snapshot).not.toHaveProperty(key);
    expect(statements.some(sql => sql.startsWith("SELECT ") && sql.includes('"PaperFill"'))).toBe(false);
    const fullBytes = Buffer.byteLength(fullText), leanBytes = Buffer.byteLength(leanText);
    expect(fullBytes).toBeGreaterThan(50_000);
    expect(leanBytes).toBeLessThan(6_000);
    expect(leanBytes / fullBytes).toBeLessThan(0.1);
    expect(resolveReplayServerResponse(lean, full.snapshot, full.snapshot.session.version).snapshot)
      .toEqual(JSON.parse(JSON.stringify(await getPaperSessionSnapshot(id))));
    const progress = await prisma.replayProgress.findFirstOrThrow({ where: { datasetId: id } });
    expect(Buffer.byteLength(progress.lastSyncResponse!)).toBeLessThan(6_000);
    expect(await (await send(body)).json()).toEqual(lean);
    const timings = leanResponse.headers.get("Server-Timing")!;
    for (const phase of ["wait", "snapshot", "receipt", "commit", "scope", "guard", "request"]) expect(timings).toContain(phase + ";dur=");
  }, 20_000);

  it("refreshes LIVE history on fills and OCO cancellation, but reuses it while a position is held", async () => {
    const id = "compact-trade-changes";
    await seed(id, 1, 10);
    const account = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
    await seedOrder({ id: "entry", sessionId: account.id, side: "BUY", type: "MARKET", quantity: 2,
      stopLoss: 95, takeProfit: 110, createdSequence: -1, activeFromSequence: 0 });
    const send = async (target: number) => syncPOST(syncRequest({ ...await serverSyncBody(id, target, "live-" + target), snapshotMode: "LIVE" }), context(id));
    const entryResponse = await send(0);
    expect(entryResponse.status).toBe(200);
    const entry = await entryResponse.json();
    expect(entry.fills).toHaveLength(1);
    expect(entry.snapshot.recentOrders).toHaveLength(1);
    expect(entry.snapshot.activeOrders).toHaveLength(2);
    const heldResponse = await send(1);
    expect(heldResponse.status).toBe(200);
    const held = await heldResponse.json();
    expect(held.snapshot).not.toHaveProperty("recentFills");
    expect(resolveReplayServerResponse(held, entry.snapshot, entry.snapshot.session.version).snapshot)
      .toEqual(JSON.parse(JSON.stringify(await getPaperSessionSnapshot(id))));
    await prisma.marketBar.update({ where: { datasetId_sequence: { datasetId: id, sequence: 2 } }, data: { high: 111, close: 110 } });
    const exitResponse = await send(2);
    expect(exitResponse.status).toBe(200);
    const exit = await exitResponse.json();
    expect(exit.fills).toHaveLength(1);
    expect(exit.snapshot.recentOrders.some((order: { status: string }) => order.status === "CANCELLED")).toBe(true);
    expect(exit.snapshot.activeOrders).toEqual([]);
    expect(exit.snapshot).toEqual(JSON.parse(JSON.stringify(await getPaperSessionSnapshot(id))));
  });

  it("refreshes LIVE history when an order is cancelled without producing any fill", async () => {
    const id = "compact-cancellation";
    await seed(id, 1, 4);
    const account = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
    await seedOrder({ id: "empty-close", sessionId: account.id, side: "SELL", type: "MARKET", quantity: 1,
      reduceOnly: true, createdSequence: -1, activeFromSequence: 0 });
    const body = { ...await serverSyncBody(id, 0, "cancel-without-fill"), snapshotMode: "LIVE" };
    const response = await syncPOST(syncRequest(body), context(id));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.fills).toEqual([]);
    expect(result.snapshot.activeOrders).toEqual([]);
    expect(result.snapshot.recentOrders).toEqual([expect.objectContaining({ id: "empty-close", status: "CANCELLED" })]);
    expect(result.snapshot.recentFills).toEqual([]);
    expect(result.snapshot.recentTrades).toEqual([]);
    expect(await (await syncPOST(syncRequest(body), context(id))).json()).toEqual(result);
  });

  it.each([
    { name: "short-sparse", seconds: [0, 2], phase: "FORMING", quality: "NORMAL" },
    { name: "closed-sparse", seconds: [0, 4], phase: "CLOSED", quality: "GAP" },
    { name: "closed-dense", seconds: [0, 1, 2, 3, 4], phase: "CLOSED", quality: "NORMAL" },
  ] as const)("keeps EOF $name identical across ordinary, flat, refreshed and incremental candles (AR-02)", async scenario => {
    const results: AggregatedMarketBarData[][] = [];
    for (const flatOnly of [false, true]) {
      const id = `eof-${scenario.name}-${flatOnly}`;
      await seed(id, 1, scenario.seconds.length, -1, true, { startTimeMs: 0 });
      // Update backwards so sparse fixture timestamps never collide with an existing later row.
      for (let i = scenario.seconds.length - 1; i >= 0; i--) await prisma.marketBar.update({ where: { datasetId_sequence: { datasetId: id, sequence: i } }, data: { timestamp: new Date(scenario.seconds[i] * 1000) } });
      await prisma.marketDataset.update({ where: { id }, data: { barEmissionMode: "DENSE", endTime: new Date(scenario.seconds.at(-1)! * 1000) } });
      await buildAggregations(id);
      const response = await POST(request({ ...await flatBody(id, 5), flatOnly }), context(id));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.currentSequence).toBe(scenario.seconds.length - 1);
      expect(data.reachedVisibleBucket).toBe(true); // EOF stops the step, even when its bucket is still forming.
      expect(data.completedDisplayBucketStart).toBe(scenario.phase === "CLOSED" ? new Date(0).toISOString() : null);
      expect(data.aggregatedBars[0]).toMatchObject({ phase: scenario.phase, quality: scenario.quality });
      const refreshed = await windowGET(new Request(`http://localhost/api/window?endSequence=${data.currentSequence}&displayIntervalSeconds=5&displaySession=ETH&visibleCount=5&warmupCount=0`), context(id));
      expect(refreshed.status).toBe(200);
      expect((await refreshed.json()).visibleBars).toEqual(data.aggregatedBars);
      const raw = await prisma.marketBar.findMany({ where: { datasetId: id }, orderBy: { sequence: "asc" } });
      const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id } });
      const incremental: AggregatedMarketBarData[] = [];
      for (const bar of raw) mergeSourceBarInto(incremental, serializeSourceBar(bar), { sourceSeconds: 1, displaySeconds: 5,
        session: resolveDisplaySession(dataset, "ETH")!, emissionMode: "DENSE", finalSequence: raw.length - 1 });
      expect(incremental).toEqual(data.aggregatedBars);
      results.push(data.aggregatedBars);
    }
    expect(results[0]).toEqual(results[1]);
  }, 15_000);

  it("advances an empty 1s account through 1H using summaries and preserves all manual equity samples", async () => {
    for (const id of ["flat-reference", "flat-summary"]) {
      await seed(id, 1, 5000);
      await prisma.paperTradingSession.updateMany({ where: { datasetId: id }, data: { equitySampleStride: 113,
        realizedPnl: -100, totalFees: 25, peakEquity: 100500, maxDrawdown: 0.001, cashAdjustment: 250 } });
    }
    for (const target of [999, 1999, 2999, 3599]) {
      const body = await serverSyncBody("flat-reference", target, `reference-${target}`);
      expect((await syncPOST(syncRequest({ ...body, batchMode: "BULK" }), context("flat-reference"))).status).toBe(200);
    }
    const body = await flatBody("flat-summary");
    const response = await POST(request(body), context("flat-summary"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ currentSequence: 3599, reachedVisibleBucket: true, fills: [] });
    expect(result.aggregatedBars).toHaveLength(1);
    expect(result.aggregatedBars[0]).toMatchObject({ sourceCount: 3600, lastSequence: 3599, phase: "CLOSED" });
    expect(Number(response.headers.get("X-Replay-Source-Rows"))).toBeLessThan(150);
    expect(Number(response.headers.get("X-Replay-Summary-Rows"))).toBeGreaterThan(0);
    const fast = (await getPaperSessionSnapshot("flat-summary"))!;
    const reference = (await getPaperSessionSnapshot("flat-reference"))!;
    expect({ ...fast.session, id: "same", datasetId: "same" }).toEqual({ ...reference.session, id: "same", datasetId: "same" });
    expect(fast.stats).toEqual(reference.stats);
    expect(fast.session.cashAdjustment).toBe(250);
    expect(fast.session.maxDrawdown).toBeCloseTo(625 / 100500);
    expect((await prisma.paperEquityPoint.findFirstOrThrow({ where: { session: { datasetId: "flat-summary" } }, orderBy: { sequence: "asc" } })).balance).toBe(100125);
    const equity = async (id: string) => prisma.paperEquityPoint.findMany({ where: { session: { datasetId: id } },
      orderBy: { sequence: "asc" }, select: { sequence: true, timestamp: true, balance: true, equity: true, drawdown: true } });
    expect(await equity("flat-summary")).toEqual(await equity("flat-reference"));
    const points = await equity("flat-summary");
    const replay = await POST(request(body), context("flat-summary"));
    expect(await replay.json()).toEqual(result);
    expect(await equity("flat-summary")).toEqual(points);
    const changed = await POST(request({ ...body, displayIntervalSeconds: 300 }), context("flat-summary"));
    expect(changed.status).toBe(409);
  }, 20_000);

  it.each([7, 61, 420, 3900])("keeps a custom %is interval and bounded sampling without future prices", async seconds => {
    const id = `flat-custom-${seconds}`;
    await seed(id, 1, seconds + 2, -1, true, { startTimeMs: 0 });
    const response = await POST(request(await flatBody(id, seconds)), context(id));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.currentSequence).toBe(seconds - 1);
    expect(data.lastSourceBar.sequence).toBe(seconds - 1);
    expect(data.aggregatedBars.every((bar: AggregatedMarketBarData) => bar.lastSequence <= data.currentSequence)).toBe(true);
    const raw = await prisma.marketBar.findMany({ where: { datasetId: id, sequence: { lte: data.currentSequence } }, orderBy: { sequence: "asc" } });
    const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id } });
    expect(data.aggregatedBars).toEqual(aggregateMarketBars({ bars: raw.map(serializeSourceBar), sourceSeconds: 1,
      displaySeconds: seconds, session: resolveDisplaySession(dataset, "ETH")!, currentSequence: data.currentSequence, finalSequence: seconds + 1 }));
  }, 15_000);

  it.each([
    { type: "MARKET", isProtective: false, activeFromSequence: 0 },
    { type: "LIMIT", isProtective: false, activeFromSequence: 0 },
    { type: "STOP", isProtective: true, activeFromSequence: 500 },
  ] as const)("does not bypass pending $type orders, including future protective orders", async order => {
    const id = `flat-pending-${order.type}`;
    await seed(id, 1, 400);
    const account = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
    await seedOrder({ id: `pending-${id}`, sessionId: account.id, side: "BUY", quantity: 1,
      type: order.type, isProtective: order.isProtective, activeFromSequence: order.activeFromSequence,
      price: order.type === "MARKET" ? null : 100, createdSequence: -1 });
    expect(await (await POST(request(await flatBody(id, 300)), context(id))).json()).toEqual({ flatAdvanceUnavailable: true });
    expect((await prisma.replayProgress.findFirstOrThrow({ where: { datasetId: id } })).currentSequence).toBe(-1);
  });

  it("does not bypass a position without protective orders, or leak writes on failure", async () => {
    await seed("flat-position", 1, 400);
    await prisma.paperTradingSession.updateMany({ where: { datasetId: "flat-position" }, data: { netQuantity: 1, averageEntryPrice: 100 } });
    expect(await (await POST(request(await flatBody("flat-position", 300)), context("flat-position"))).json()).toEqual({ flatAdvanceUnavailable: true });
    await seed("flat-failure", 1, 400);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER flat_failure BEFORE UPDATE ON ReplayProgress WHEN OLD.datasetId='flat-failure' BEGIN SELECT RAISE(ABORT,'injected flat failure'); END`);
    try {
      expect((await POST(request(await flatBody("flat-failure", 300)), context("flat-failure"))).status).toBe(500);
      expect((await getPaperSessionSnapshot("flat-failure"))!.session.lastProcessedSequence).toBe(-1);
      expect(await prisma.paperEquityPoint.count({ where: { session: { datasetId: "flat-failure" } } })).toBe(0);
      expect(await prisma.replayContextRun.count({ where: { projection: { replaySession: { datasetId: "flat-failure" } } } })).toBe(0);
    } finally { await prisma.$executeRawUnsafe("DROP TRIGGER flat_failure"); }
  });

  it("materializes exact pre-source ABR after a fast advance and can rewind inside it", async () => {
    const id = "flat-context";
    await seed(id, 1, 1500, 119, true, { startTimeMs: 0 });
    const replay = await prisma.replaySession.findUniqueOrThrow({ where: { id: fixtureSessions.get(id)! } });
    await prisma.replaySession.update({ where: { id: replay.id }, data: { mode: "LIVE_REPLAY", legacy: false } });
    const response = await POST(request(await flatBody(id, 61)), context(id));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.currentSequence).toBe(121);
    const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id } });
    const raw = await prisma.marketBar.findMany({ where: { datasetId: id, sequence: { lte: 121 } }, orderBy: { sequence: "asc" } });
    const runs = await prisma.replayContextRun.findMany({ where: { projectionId: replay.activeProjectionId! } });
    const expanded = await materializeFlatContexts(dataset, raw.filter(bar => bar.sequence > 119), runs);
    const aggregates: AggregatedMarketBarData[] = [];
    for (const bar of raw) {
      if (bar.sequence >= 120) {
        const run = expanded.find(run => run.fromSequence <= bar.sequence && run.toSequence >= bar.sequence)!;
        expect(JSON.parse(run.context).context.abrValue).toBe(calculateLatestAbr([], aggregates, 2));
      }
      mergeSourceBarInto(aggregates, serializeSourceBar(bar), { sourceSeconds: 1, displaySeconds: 61,
        session: resolveDisplaySession(dataset, "ETH")!, finalSequence: 1499 });
    }
    const job = await createCorrection(replay.id, { requestId: "flat-rewind", type: "REWIND", targetSequence: 120,
      expectedVersion: (await loadReplayScope(replay.id)).version });
    await runReplayCorrection(job.id);
    expect((await readCorrection(replay.id, job.id)).status).toBe("READY");
    await commitCorrection(replay.id, job.id);
    expect((await getPaperSessionSnapshot(id))!.session).toMatchObject({ lastProcessedSequence: 120, netQuantity: 0 });
  }, 15_000);

  it.each([["ETH", 44], ["RTH", 1094]] as const)("seeks %s session boundaries for 1min sources without walking the hidden interval", async (displaySession, target) => {
    const id = `flat-session-${displaySession}`;
    await seed(id, 60, 1500, -1, true, { symbol: "ES1!", startTimeMs: Date.parse("2026-09-14T20:15:00Z") });
    await prisma.paperTradingSession.updateMany({ where: { datasetId: id }, data: { equitySampleStride: 113 } });
    const response = await POST(request({ ...await flatBody(id), displaySession }), context(id));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.currentSequence).toBe(target);
    expect(Number(response.headers.get("X-Replay-Source-Rows"))).toBeLessThan(100);
    expect(data.aggregatedBars.at(-1).timestamp).toBe(displaySession === "ETH" ? "2026-09-14T20:00:00.000Z" : "2026-09-15T13:30:00.000Z");
    expect(data.lastSourceBar.sequence).toBe(target);
    const samples = await prisma.paperEquityPoint.findMany({ where: { session: { datasetId: id } }, orderBy: { sequence: "asc" }, select: { sequence: true } });
    if (displaySession === "RTH") expect(samples.map(row => row.sequence)).toEqual([...Array.from({ length: Math.floor(target / 113) + 1 }, (_, i) => i * 113), target]);
  }, 15_000);

  it("resumes bounded dense sampling and leaves a short EOF candle forming", async () => {
    const id = "flat-bounded";
    await seed(id, 1, 5001, -1, true, { startTimeMs: 0 });
    const first = await POST(request(await flatBody(id, 7200, "flat-bounded-first")), context(id));
    const partial = await first.json();
    expect(partial).toMatchObject({ currentSequence: 3999, reachedVisibleBucket: false });
    expect(partial.aggregatedBars.at(-1).phase).toBe("FORMING");
    const next = await POST(request(await flatBody(id, 7200, "flat-bounded-next")), context(id));
    const finished = await next.json();
    expect(finished).toMatchObject({ currentSequence: 5000, reachedVisibleBucket: true, completedDisplayBucketStart: null });
    expect(finished.aggregatedBars.at(-1)).toMatchObject({ phase: "FORMING", sourceCount: 5001 });
    expect(await prisma.paperEquityPoint.count({ where: { session: { datasetId: id } } })).toBe(5001);
    const checkpoint = await prisma.replayCheckpoint.findFirstOrThrow({ where: { projectionId: (await loadReplayScope(fixtureSessions.get(id)!)).projectionId, sourceSequence: 4095 } });
    expect(JSON.parse(checkpoint.state).account).toMatchObject({ lastProcessedSequence: 4095, version: 4097 });
  }, 15_000);

  it("preserves an initially short client ABR history across coalesced flat advances", async () => {
    const id = "flat-short-history";
    await seed(id, 1, 400, 119, true, { startTimeMs: 0 });
    for (let i = 0; i < 2; i++) expect((await POST(request({ ...await flatBody(id, 61, `short-history-${i}`), abrHistoryStartSequence: 61 }), context(id))).status).toBe(200);
    const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id } });
    const raw = await prisma.marketBar.findMany({ where: { datasetId: id, sequence: { gte: 61, lte: 182 } }, orderBy: { sequence: "asc" } });
    const runs = await prisma.replayContextRun.findMany({ where: { projectionId: (await loadReplayScope(fixtureSessions.get(id)!)).projectionId } });
    const contexts = await materializeFlatContexts(dataset, raw.filter(row => row.sequence >= 120), runs);
    const bars: AggregatedMarketBarData[] = [];
    for (const row of raw) {
      if (row.sequence >= 120) {
        const context = JSON.parse(contexts.find(run => run.fromSequence <= row.sequence && run.toSequence >= row.sequence)!.context).context;
        expect(context.abrValue).toBe(calculateLatestAbr([], bars, 2));
      }
      mergeSourceBarInto(bars, serializeSourceBar(row), { sourceSeconds: 1, displaySeconds: 61,
        session: resolveDisplaySession(dataset, "ETH")!, finalSequence: 399 });
    }
  });

  it("restores long custom-period ABR through multiple source-budgeted history pages", async () => {
    const id = "flat-long-history";
    await seed(id, 1, 61500, 60999, true, { startTimeMs: 0 });
    const response = await POST(request({ ...await flatBody(id, 61), abrLength: 1000, abrHistoryStartSequence: 0 }), context(id));
    expect(response.status).toBe(200);
    const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id } });
    const raw = await prisma.marketBar.findMany({ where: { datasetId: id, sequence: { lte: 61000 } }, orderBy: { sequence: "asc" } });
    const runs = await prisma.replayContextRun.findMany({ where: { projectionId: (await loadReplayScope(fixtureSessions.get(id)!)).projectionId } });
    const contexts = await materializeFlatContexts(dataset, raw.slice(-1), runs);
    const bars = aggregateMarketBars({ bars: raw.slice(0, -1).map(serializeSourceBar), sourceSeconds: 1, displaySeconds: 61,
      session: resolveDisplaySession(dataset, "ETH")!, currentSequence: 60999, finalSequence: 61499 });
    const expected = calculateLatestAbr([], bars, 1000);
    expect(expected).not.toBeNull();
    expect(JSON.parse(contexts[0].context).context.abrValue).toBeCloseTo(expected!, 12);
  }, 30_000);

  it("matches per-source ABR, FIFO, fees, OCO and every equity sample when coalescing a thousand source bars", async () => {
    // Different commit boundaries round-trip SQLite Float values a different number of times.
    const equivalent = (actual: unknown, expected: unknown): void => {
      if (typeof expected === "number") { expect(actual).toBeCloseTo(expected, 10); return; }
      if (expected instanceof Date) { expect(actual).toEqual(expected); return; }
      if (Array.isArray(expected)) {
        expect(Array.isArray(actual)).toBe(true); expect(actual).toHaveLength(expected.length);
        expected.forEach((value, index) => equivalent((actual as unknown[])[index], value)); return;
      }
      if (expected !== null && typeof expected === "object") {
        expect(actual).not.toBeNull(); expect(typeof actual).toBe("object");
        expect(Object.keys(actual as object)).toEqual(Object.keys(expected));
        for (const [key,value] of Object.entries(expected)) equivalent((actual as Record<string,unknown>)[key], value);
        return;
      }
      expect(actual).toEqual(expected);
    };
    const ids = ["bulk-reference", "bulk-coalesced"];
    for (const id of ids) {
      await seed(id, 1, 4000, 2399);
      const account = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
      await prisma.paperTradingSession.update({ where: { id: account.id }, data: { commissionBps: 5, slippageBps: 2, equitySampleStride: 7 } });
      for (const order of [
        { id: "entry", side: "BUY" as const, quantity: 2, activeFromSequence: 2400, stopLoss: 90, takeProfit: 120 },
        { id: "reduce", side: "SELL" as const, quantity: 1, activeFromSequence: 2450, reduceOnly: true },
        { id: "reverse", side: "SELL" as const, quantity: 2, activeFromSequence: 2500, stopLoss: 110, takeProfit: 90 },
        { id: "close", side: "BUY" as const, quantity: 1, activeFromSequence: 2700, reduceOnly: true },
      ]) await seedOrder({ sessionId: account.id, type: "MARKET", createdSequence: 2399, ...order });
    }
    const records = await prisma.marketBar.findMany({ where: { datasetId: ids[0], sequence: { lte: 3399 } }, orderBy: { sequence: "asc" } });
    const sourceBars = records.map(serializeSourceBar);
    const displaySession = { mode: "TWENTY_FOUR_SEVEN" as const, timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] };
    const bars = aggregateMarketBars({ bars: sourceBars.slice(0,2400), sourceSeconds: 1, displaySeconds: 300, session: displaySession, currentSequence: 2399, finalSequence: 3999 });
    const runs: ReplayContextRun[] = [];
    for (const source of sourceBars.slice(2400)) {
      const abrValue = calculateLatestAbr([], bars, 8);
      mergeSourceBarInto(bars, source, { sourceSeconds: 1, displaySeconds: 300, session: displaySession, finalSequence: 3999 });
      appendContextRun(runs, source.sequence, { abrValue, abrLength: 8, displayIntervalSeconds: 300, displaySession: "ETH", displayUtcOffsetMinutes: 0, priceTickSize: 0.01 }, 1);
    }
    type BulkResult = ReplayServerResult & { snapshot: NonNullable<ReplayServerResult["snapshot"]> };
    const responses: BulkResult[] = [];
    for (const id of ids) {
      const size = id === ids[0] ? 100 : 1000;
      let final: BulkResult | undefined;
      for (let from = 2400; from <= 3399; from += size) {
        const to = Math.min(3399, from + size - 1);
        const body = { ...await serverSyncBody(id, to, "bulk-" + from),
          contextRuns: runs.filter(run => run.toSequence >= from && run.fromSequence <= to).map(run => ({ ...run, fromSequence: Math.max(from,run.fromSequence), toSequence: Math.min(to,run.toSequence) })),
          ...(size > 100 ? { batchMode: "BULK" } : {}) };
        const response = await syncPOST(syncRequest(body), context(id));
        expect(response.status, await response.clone().text()).toBe(200); final = await response.json();
        expect(final).not.toHaveProperty("processedBars");
        if (size > 100) expect(await (await syncPOST(syncRequest(body), context(id))).json()).toEqual(final);
      }
      if (!final) throw new Error("Expected a completed bulk comparison");
      responses.push(final);
    }
    const state = (value: typeof responses[number]) => { const { id: _id, datasetId: _dataset, activeCycleKey: _cycle, ...rest } = value.snapshot.session; void _id; void _dataset; void _cycle; return rest; };
    equivalent(state(responses[1]), state(responses[0]));
    equivalent(responses[1].snapshot.stats, responses[0].snapshot.stats);
    const fills = (value: typeof responses[number]) => value.snapshot.recentFills.map(({ id: _id, cycleKey: _cycle, ...rest }: PaperFillData) => { void _id; void _cycle; return rest; });
    equivalent(fills(responses[1]), fills(responses[0]));
    expect(responses[1].snapshot.session.netQuantity).toBe(0);
    const stored = [];
    for (const id of ids) {
      const account = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
      const scope = await loadReplayScope(fixtureSessions.get(id)!);
      stored.push({
        equity: await prisma.paperEquityPoint.findMany({ where: { sessionId: account.id }, orderBy: { sequence: "asc" }, select: { sequence: true, timestamp: true, balance: true, equity: true, drawdown: true } }),
        contexts: await prisma.replayContextRun.findMany({ where: { projectionId: scope.projectionId }, orderBy: { fromSequence: "asc" }, select: { fromSequence: true, toSequence: true, context: true } }),
        journals: await prisma.replayJournalEntry.findMany({ where: { projectionId: scope.projectionId }, orderBy: [{ closedSequence: "asc" },{ openedSequence: "asc" }], select: { openedSequence: true, closedSequence: true, quantity: true, entryPrice: true, exitPrice: true, abrValue: true, actualRisk: true, gainLoss: true } }),
      });
    }
    equivalent(stored[1], stored[0]);
    expect(stored[1].journals.length).toBeGreaterThan(0);
    expect(stored[1].journals.every(entry => entry.abrValue !== null)).toBe(true);
  });

  it("requires explicit bounded bulk mode and rejects oversized source/context payloads before mutation", async () => {
    const id = "bulk-limit"; await seed(id, 1, 1200);
    const baseline = await prisma.replayProgress.findFirstOrThrow({ where: { datasetId: id } });
    const body = await serverSyncBody(id, 1000, "over-limit");
    for (const invalid of [body, { ...body, batchMode: "BULK" }, { ...body, batchMode: "UNKNOWN", targetSequence: 0 }]) {
      expect((await syncPOST(syncRequest(invalid), context(id))).status).toBe(400);
    }
    const tooManyContexts = { ...body, targetSequence: 999, batchMode: "BULK", contextRuns: Array.from({ length: 1001 }, (_, sequence) => ({ fromSequence: sequence, toSequence: sequence, generation: 1, context: null })) };
    expect((await syncPOST(syncRequest(tooManyContexts), context(id))).status).toBe(400);
    expect(await prisma.replayProgress.findFirstOrThrow({ where: { datasetId: id } })).toEqual(baseline);
    expect(await prisma.paperFill.count({ where: { session: { datasetId: id } } })).toBe(0);
  });

  it("rolls back a large batch and its sampled equity, context and fills when snapshot preparation fails", async () => {
    const id = "bulk-rollback"; await seed(id, 1, 1200);
    const account = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
    await seedOrder({ id: "entry", sessionId: account.id, type: "MARKET", side: "BUY", quantity: 1, createdSequence: -1, activeFromSequence: 0, stopLoss: 90, takeProfit: 120 });
    const body = { ...await serverSyncBody(id, 999, "bulk-rollback"), batchMode: "BULK" };
    const before = await prisma.replayProgress.findFirstOrThrow({ where: { datasetId: id } });
    const beforeAccount = await prisma.paperTradingSession.findUniqueOrThrow({ where: { id: account.id } });
    const fault = vi.spyOn(snapshotModule, "getPaperSessionSnapshot").mockRejectedValueOnce(new Error("bulk snapshot failure"));
    const log = vi.spyOn(console,"error").mockImplementation(() => undefined);
    try { expect((await syncPOST(syncRequest(body), context(id))).status).toBe(500); }
    finally { fault.mockRestore(); log.mockRestore(); }
    expect(await prisma.replayProgress.findFirstOrThrow({ where: { datasetId: id } })).toEqual(before);
    expect(await prisma.paperTradingSession.findUniqueOrThrow({ where: { id: account.id } })).toEqual(beforeAccount);
    expect(await prisma.paperFill.count({ where: { sessionId: account.id } })).toBe(0);
    expect(await prisma.paperEquityPoint.count({ where: { sessionId: account.id } })).toBe(0);
    expect(await prisma.replayContextRun.count({ where: { projectionId: account.projectionId! } })).toBe(0);
    expect((await syncPOST(syncRequest(body), context(id))).status).toBe(200);
    expect(await prisma.paperFill.count({ where: { sessionId: account.id } })).toBe(1);
  });

  it("coalesces context boundaries and inserts changing source contexts in a bounded batch", async () => {
    const id = "lean-contexts";
    await seed(id, 1, 200);
    const scope = await loadReplayScope(fixtureSessions.get(id)!);
    const contextA = { abrValue: 2, abrLength: 14, displayIntervalSeconds: 60, displaySession: "ETH" as const, displayUtcOffsetMinutes: 0, priceTickSize: 0.25 };
    await runWithReplayScope(scope, () => prisma.$transaction(tx => persistContextRuns(tx, [
      { fromSequence: 0, toSequence: 0, generation: 1, context: contextA },
    ])));
    const first = queryAudit.statements.length;
    await runWithReplayScope(scope, () => prisma.$transaction(tx => persistContextRuns(tx, [
      { fromSequence: 1, toSequence: 1, generation: 1, context: contextA },
      { fromSequence: 2, toSequence: 2, generation: 1, context: contextA },
      { fromSequence: 3, toSequence: 3, generation: 1, context: null },
      { fromSequence: 4, toSequence: 4, generation: 1, context: null },
      ...Array.from({ length: 100 }, (_, i) => ({ fromSequence: 5 + i, toSequence: 5 + i, generation: 1, context: { ...contextA, abrValue: i + 3 } })),
    ])));
    const statements = queryAudit.statements.slice(first);
    expect(statements.filter(sql => sql.startsWith("INSERT ") && sql.includes("ReplayContextRun"))).toHaveLength(1);
    expect(statements.filter(sql => sql.startsWith("UPDATE ") && sql.includes("ReplayContextRun"))).toHaveLength(1);
    const stored = await prisma.replayContextRun.findMany({ where: { projectionId: scope.projectionId }, orderBy: { fromSequence: "asc" } });
    expect(stored).toHaveLength(102);
    expect(stored[0]).toMatchObject({ fromSequence: 0, toSequence: 2 });
    expect(stored[1]).toMatchObject({ fromSequence: 3, toSequence: 4 });
    for (let i = 2; i < stored.length; i++) {
      expect(stored[i].fromSequence).toBe(i + 3);
      expect(JSON.parse(stored[i].context).context.abrValue).toBe(i + 1);
    }
  });

  it.each([false, true])("avoids redundant writes with held position = %s and returns the committed snapshot", async (held) => {
    const id = "lean-sync-" + held;
    await seed(id, 1, 10);
    const account = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
    if (held) await seedOrder({ id: "entry", sessionId: account.id, side: "BUY", type: "MARKET", quantity: 2,
      stopLoss: 95, takeProfit: 110, createdSequence: -1, activeFromSequence: 0 });
    expect((await syncPOST(syncRequest(await serverSyncBody(id, 0, "prime")), context(id))).status).toBe(200);
    const beforeLots = await prisma.paperPositionLot.findMany({ where: { sessionId: account.id } });
    const beforeOrders = await prisma.paperOrder.findMany({ where: { sessionId: account.id } });
    const body = await serverSyncBody(id, 1, "lean");
    const first = queryAudit.statements.length;
    const response = await syncPOST(syncRequest(body), context(id));
    const statements = queryAudit.statements.slice(first);
    expect(response.status).toBe(200);
    const result = await response.json();
    for (const table of ["PaperTradingSession", "ReplayProgress", "ReplayProjection"]) {
      expect(statements.filter(sql => sql.startsWith('UPDATE ') && sql.includes(table))).toHaveLength(1);
    }
    expect(statements.some(sql => /^(DELETE|INSERT|UPDATE) /.test(sql) && sql.includes('PaperPositionLot'))).toBe(false);
    expect(await prisma.paperPositionLot.findMany({ where: { sessionId: account.id } })).toEqual(beforeLots);
    expect(await prisma.paperOrder.findMany({ where: { sessionId: account.id } })).toEqual(beforeOrders);
    expect(result.snapshot).toEqual(JSON.parse(JSON.stringify(await getPaperSessionSnapshot(id))));
    expect(result.fills).toEqual([]);
    expect(result.snapshot.session.lastProcessedSequence).toBe(1);
  });

  it("rolls back matching and all saved state when snapshot preparation fails, then safely retries", async () => {
    const id = "lean-sync-rollback";
    await seed(id, 1, 10);
    expect((await syncPOST(syncRequest(await serverSyncBody(id, 0, "prime")), context(id))).status).toBe(200);
    const account = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
    await seedOrder({ id: "entry", sessionId: account.id, side: "BUY", type: "MARKET", quantity: 2,
      stopLoss: 95, takeProfit: 110, createdSequence: 0, activeFromSequence: 1 });
    const body = await serverSyncBody(id, 1, "rollback-and-retry");
    const read = () => Promise.all([
      prisma.paperTradingSession.findUnique({ where: { id: account.id } }),
      prisma.replayProgress.findFirst({ where: { datasetId: id } }),
      prisma.paperOrder.findMany({ where: { sessionId: account.id } }),
      prisma.paperFill.findMany({ where: { sessionId: account.id } }),
      prisma.paperPositionLot.findMany({ where: { sessionId: account.id } }),
      prisma.paperEquityPoint.findMany({ where: { sessionId: account.id } }),
      prisma.replayProjection.findUnique({ where: { id: account.projectionId! } }),
      prisma.replaySession.findUnique({ where: { id: fixtureSessions.get(id)! } }),
      prisma.replayCheckpoint.findMany({ where: { projectionId: account.projectionId! } }),
    ]);
    const before = await read();
    const fault = vi.spyOn(snapshotModule, "getPaperSessionSnapshot").mockRejectedValueOnce(new Error("snapshot failure"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try { expect((await syncPOST(syncRequest(body), context(id))).status).toBe(500); }
    finally { fault.mockRestore(); consoleError.mockRestore(); }
    expect(await read()).toEqual(before);
    const committed = await syncPOST(syncRequest(body), context(id));
    expect(committed.status).toBe(200);
    const receipt = await committed.json();
    expect(receipt.fills).toHaveLength(1);
    expect(receipt.snapshot).toEqual(JSON.parse(JSON.stringify(await getPaperSessionSnapshot(id))));
    const replayed = await syncPOST(syncRequest(body), context(id));
    expect(await replayed.json()).toEqual(receipt);
    expect(await prisma.paperFill.count({ where: { sessionId: account.id } })).toBe(1);
  });

  it("atomically replaces a time aggregation generation without duplicating active summaries", async () => {
    const id = "block-resume";
    await seed(id, 1, 5_000, -1, false);
    await buildAggregations(id);
    expect(await prisma.marketAggregatedBar.count({ where: { generation: { datasetId: id, status: "READY" } } })).toBeGreaterThan(0);
    expect(await prisma.marketDataset.findUniqueOrThrow({ where: { id } })).toMatchObject({
      activeAggregationId: expect.any(String),
    });

    await buildAggregations(id);
    expect(await prisma.marketAggregatedBar.count({ where: { generation: { datasetId: id, status: "READY" } } })).toBeGreaterThan(0);
  });

  it("returns source bars as daily cache chunks and records empty weekly dates", async () => {
    await seed("chunk-second", 1, 120, -1, false);
    const daily = await chunksGET(new Request(
      "http://localhost/api/chunks?version=1&startDate=2026-09-01",
    ), context("chunk-second"));
    expect(daily.status).toBe(200);
    const dailyBody = await daily.json();
    expect(dailyBody.coveredDates).toEqual(["2026-09-01"]);
    expect(dailyBody.chunks[0].bars).toHaveLength(120);
    expect(dailyBody.chunks[0].bars[0].sequence).toBe(0);

    await seed("chunk-week", 300, 10, -1, false);
    const weekly = await chunksGET(new Request(
      "http://localhost/api/chunks?version=1&startDate=2026-09-01",
    ), context("chunk-week"));
    expect(weekly.status).toBe(200);
    const weeklyBody = await weekly.json();
    expect(weeklyBody.coveredDates).toHaveLength(7);
    expect(weeklyBody.chunks).toHaveLength(7);
    expect(weeklyBody.chunks[0].bars).toHaveLength(10);
    expect(weeklyBody.chunks.slice(1).every((chunk: { bars: unknown[] }) => chunk.bars.length === 0)).toBe(true);

    const stale = await chunksGET(new Request(
      "http://localhost/api/chunks?version=2&startDate=2026-09-01",
    ), context("chunk-week"));
    expect(stale.status).toBe(409);
  });

  it("replays a lost sync response idempotently without duplicating source processing", async () => {
    await seed("sync-idempotent", 1, 300);
    const body = await serverSyncBody("sync-idempotent", 99, "same-request");
    const first = await syncPOST(syncRequest(body), context("sync-idempotent"));
    const retried = await syncPOST(syncRequest(body), context("sync-idempotent"));
    expect(first.status).toBe(200);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(await first.json());
    expect(await prisma.paperEquityPoint.count({
      where: { session: { datasetId: "sync-idempotent" } },
    })).toBe(100);
    const progress = await prisma.replayProgress.findFirstOrThrow({ where: { datasetId: "sync-idempotent" } });
    expect(progress).toMatchObject({ currentSequence: 99, syncVersion: 1, lastSyncRequestId: "same-request" });
  });

  it("rejects a tampered client accounting delta without moving the saved cursor", async () => {
    await seed("sync-tampered", 1, 30);
    const body = await serverSyncBody("sync-tampered", 9, "tampered");
    const response = await syncPOST(syncRequest({ ...body, paperDelta: { state: { totalFees: 10 } } }), context("sync-tampered"));
    expect(response.status).toBe(400);
    const [progress, session] = await Promise.all([
      prisma.replayProgress.findFirstOrThrow({ where: { datasetId: "sync-tampered" } }),
      prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: "sync-tampered" } }),
    ]);
    expect(progress).toMatchObject({ currentSequence: -1, syncVersion: 0 });
    expect(session).toMatchObject({ lastProcessedSequence: -1, version: 1, totalFees: 0 });
  });

  it("rejects stale sync versions and requests from a reset generation", async () => {
    await seed("sync-generation", 1, 300, -1, false);
    const originalProjection = (await loadReplayScope(fixtureSessions.get("sync-generation")!)).projectionId;
    const staleVersion = await syncPOST(syncRequest({
      generation: 1, requestId: "version", confirmedSequence: -1, syncVersion: 1,
      dataVersion: 1, historyVersion: 1, expectedPaperVersion: null, targetSequence: 1, contextRuns: [{ fromSequence: 0, toSequence: 1, generation: 1, context: null }],
    }), context("sync-generation"));
    expect(staleVersion.status).toBe(409);

    const reset = await resetPOST(request({ action: "RESET" }), context("sync-generation"));
    expect(reset.status).toBe(200);
    const resetBody = await reset.json();
    expect(resetBody.generation).toBe(1);
    expect(resetBody.replaySessionId).toBe(fixtureSessions.get("sync-generation"));
    const staleGeneration = await syncPOST(syncRequest({
      expectedProjectionId: originalProjection, generation: 1, requestId: "old-generation", confirmedSequence: -1, syncVersion: 0,
      dataVersion: 1, historyVersion: 1, expectedPaperVersion: null, targetSequence: 1, contextRuns: [{ fromSequence: 0, toSequence: 1, generation: 1, context: null }],
    }), context("sync-generation"));
    expect(staleGeneration.status).toBe(409);
  });

  it("limits browser sync batches to one hundred source bars", async () => {
    await seed("sync-limit", 1, 300, -1, false);
    const response = await syncPOST(syncRequest({
      generation: 1, requestId: "too-many", confirmedSequence: -1, syncVersion: 0,
      dataVersion: 1, historyVersion: 1, expectedPaperVersion: null, targetSequence: 100, contextRuns: [],
    }), context("sync-limit"));
    expect(response.status).toBe(400);
  });

  it("rejects missing/invalid chart context without changing saved progress", async () => {
    await seed("server-context", 60, 10);
    const body = await serverSyncBody("server-context", 1, "context");
    const invalidContext = { abrValue: null, abrLength: 8, displayIntervalSeconds: 1, displaySession: "ETH", displayUtcOffsetMinutes: 0, priceTickSize: 0.01 };
    for (const contextRuns of [[], [{ fromSequence: 1, toSequence: 1, generation: 1, context: null }],
      [{ fromSequence: 0, toSequence: 1, generation: 2, context: null }],
      [{ fromSequence: 0, toSequence: 1, generation: 1, context: invalidContext }]]) {
      expect((await syncPOST(syncRequest({ ...body, contextRuns }), context("server-context"))).status).toBe(400);
    }
    expect(await prisma.replayProgress.findFirstOrThrow({ where: { datasetId: "server-context" } })).toMatchObject({ currentSequence: -1, syncVersion: 0 });
    expect((await getPaperSessionSnapshot("server-context"))!.session).toMatchObject({ lastProcessedSequence: -1, version: 1 });
    const accepted = await syncPOST(syncRequest(body), context("server-context"));
    expect(accepted.status).toBe(200);
    expect((await syncPOST(syncRequest({ ...body, targetSequence: 2 }), context("server-context"))).status).toBe(409);
  });

  it("preserves deterministic fill and protective-order ids on server execution", async () => {
    await seed("sync-deterministic", 1, 30);
    const session = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: "sync-deterministic" } });
    await seedOrder({
      id: "entry-sync", sessionId: session.id, side: "BUY", type: "MARKET", quantity: 2,
      stopLoss: 95, takeProfit: 105, createdSequence: -1, activeFromSequence: 0,
    });
    let state = serializePaperSession(session);
    let orders = (await prisma.paperOrder.findMany({ where: { sessionId: session.id } })).map(serializePaperOrder);
    const bars = await prisma.marketBar.findMany({
      where: { datasetId: "sync-deterministic", sequence: { lte: 9 } },
      orderBy: { sequence: "asc" },
    });
    const expectedFillIds: string[] = [];
    for (const record of bars) {
      const result = advancePaperTrading({
        state,
        orders,
        bar: serializeSourceBar(record),
        makeId: createDeterministicEventIdFactory(logicalId(session.id), 1, record.sequence),
      });
      state = result.state;
      orders = result.orders;
      expectedFillIds.push(...result.fills.map((fill) => fill.id));
    }
    const response = await syncPOST(syncRequest(
      await serverSyncBody("sync-deterministic", 9, "deterministic"),
    ), context("sync-deterministic"));
    expect(response.status).toBe(200);
    const persistedFills = await prisma.paperFill.findMany({ where: { sessionId: session.id }, orderBy: { sequence: "asc" } });
    const persistedProtective = await prisma.paperOrder.findMany({
      where: { sessionId: session.id, isProtective: true },
      orderBy: { id: "asc" },
    });
    expect(persistedFills.map((fill) => logicalId(fill.id))).toEqual(expectedFillIds);
    expect(persistedProtective.map((order) => logicalId(order.id))).toEqual(
      orders.filter((order) => order.isProtective).map((order) => order.id).sort(),
    );
  });

  it.each(["BUY", "SELL"] as const)("persists %s protective line moves and cancellation through URL-decoded routes", async (side) => {
    const id = `protective-line-${side}`;
    await seed(id, 1, 5);
    const account = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
    await seedOrder({
      id: "entry", sessionId: account.id, side, type: "MARKET", quantity: 2,
      stopLoss: side === "BUY" ? 95 : 105, takeProfit: side === "BUY" ? 110 : 90,
      createdSequence: -1, activeFromSequence: 0,
    });
    const entrySync = await syncPOST(syncRequest(await serverSyncBody(id, 0, "entry")), context(id));
    expect(entrySync.status).toBe(200);
    let snapshot = (await getPaperSessionSnapshot(id))!;
    const stop = snapshot.activeOrders.find((order) => order.type === "STOP")!;
    const target = snapshot.activeOrders.find((order) => order.type === "LIMIT")!;
    expect(stop.id).toContain("%3A");
    expect(target.id).toContain("%3A");

    const sendOrderRequest = async (orderId: string, price?: number) => {
      const url = new URL(paperOrderUrl(id, orderId), "http://localhost");
      const orderContext = { params: Promise.resolve({ id, orderId: decodeURIComponent(url.pathname.split("/").at(-1)!) }) };
      const input = new Request(url, {
        method: price === undefined ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(price === undefined ? {} : { price }), expectedVersion: snapshot.session.version }),
      });
      const response = await (price === undefined ? orderDELETE : orderPATCH)(input, orderContext);
      expect(response.status).toBe(200);
      snapshot = (await response.json()).snapshot;
    };
    const stopPrice = side === "BUY" ? 97 : 103;
    const targetPrice = side === "BUY" ? 107 : 93;
    await sendOrderRequest(stop.id, stopPrice);
    await sendOrderRequest(target.id, targetPrice);
    expect(snapshot.activeOrders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: stop.id, price: stopPrice, quantity: 2, ocoGroupId: stop.ocoGroupId, activeFromSequence: 1 }),
      expect.objectContaining({ id: target.id, price: targetPrice, quantity: 2, ocoGroupId: target.ocoGroupId, activeFromSequence: 1 }),
    ]));

    const nextSync = await syncPOST(syncRequest(await serverSyncBody(id, 1, "after-move")), context(id));
    expect(nextSync.status).toBe(200);
    snapshot = (await getPaperSessionSnapshot(id))!;
    expect(snapshot.activeOrders.find((order) => order.id === stop.id)?.price).toBe(stopPrice);
    expect(snapshot.activeOrders.find((order) => order.id === target.id)?.price).toBe(targetPrice);
    await sendOrderRequest(target.id);
    expect(snapshot.activeOrders.map((order) => order.id)).toEqual([stop.id]);
    expect(snapshot.recentOrders.find((order) => order.id === target.id)).toMatchObject({ status: "CANCELLED", cancelReason: "USER_CANCELLED" });
  });

  it.each(["TRAINING", "LIVE_REPLAY"] as const)("settles protective orders across saved batches without client results in %s", async mode => {
    for (const reason of ["STOP_LOSS", "TAKE_PROFIT"] as const) {
      const id = `server-protective-${mode}-${reason}`;
      await seed(id, 60, 30);
      await prisma.replaySession.update({ where: { id: fixtureSessions.get(id)! }, data: { mode } });
      const initial = (await getPaperSessionSnapshot(id))!;
      await seedOrder({ id: "entry", sessionId: initial.session.id, side: "BUY", type: "MARKET", quantity: 2,
        stopLoss: 95, takeProfit: 105, createdSequence: -1, activeFromSequence: 0 });
      const first = await syncPOST(syncRequest(await serverSyncBody(id, 0, "entry")), context(id));
      expect(first.status).toBe(200);
      expect((await first.json()).snapshot.activeOrders).toHaveLength(2);
      await prisma.marketBar.update({ where: { datasetId_sequence: { datasetId: id, sequence: 1 } },
        data: reason === "STOP_LOSS" ? { open: 100, high: 101, low: 94, close: 96 } : { open: 100, high: 106, low: 99, close: 104 } });
      const body = await serverSyncBody(id, 1, "exit");
      const response = await syncPOST(syncRequest(body), context(id));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toMatchObject({ fromSequence: 0, currentSequence: 1, fills: [{ reason }], snapshot: { session: { netQuantity: 0 } } });
      expect(result.snapshot.activeOrders).toEqual([]);
      expect(await (await syncPOST(syncRequest(body), context(id))).json()).toEqual(result);
      const next = await syncPOST(syncRequest(await serverSyncBody(id, 2, "next")), context(id));
      expect(next.status).toBe(200);
      expect((await next.json()).currentSequence).toBe(2);
      expect(await prisma.paperFill.count({ where: { session: { datasetId: id } } })).toBe(2);
      expect(await prisma.replayJournalEntry.count({ where: { journalSession: { datasetId: id } } })).toBe(1);
    }
  });

  it("retries a displayed advance with the original receipt after a lost response", async () => {
    await seed("display-idempotent", 1, 600);
    const body = { requestId: "display-once", expectedCurrentSequence: -1, expectedVersion: 1, count: 1, displayIntervalSeconds: 300 };
    const first = await POST(request(body), context("display-idempotent"));
    expect(first.status).toBe(200);
    const result = await first.json();
    const retry = await POST(request(body), context("display-idempotent"));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(result);
    expect(result.currentSequence).toBe(299);
    expect(await prisma.paperEquityPoint.count({ where: { session: { datasetId: "display-idempotent" } } })).toBe(300);
  });

  it("advances a full displayed bar atomically", async () => {
    await seed("basic", 1, 600);
    const response = await POST(request({ expectedCurrentSequence: -1, expectedVersion: 1, count: 1, displayIntervalSeconds: 300 }), context("basic"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.currentSequence).toBe(299);
    expect(result.snapshot.session.lastProcessedSequence).toBe(299);
    expect(await prisma.paperEquityPoint.count({ where: { session: { datasetId: "basic" } } })).toBe(300);
  });


  it("recovers after a lost response or stale version without replaying fills", async () => {
    await seed("recover", 1, 900);
    const body = { expectedCurrentSequence: -1, expectedVersion: 1, count: 1, displayIntervalSeconds: 300 };
    expect((await POST(request(body), context("recover"))).status).toBe(200); // response is lost
    expect((await POST(request(body), context("recover"))).status).toBe(409);
    const synced = await (await progressGET(new Request("http://localhost/api/progress"), context("recover"))).json();
    expect(synced.progress.currentSequence).toBe(299);
    expect(synced.snapshot.session.lastProcessedSequence).toBe(299);
    const next = await POST(request({ ...body, expectedCurrentSequence: synced.progress.currentSequence,
      expectedVersion: synced.snapshot.session.version }), context("recover"));
    expect(next.status).toBe(200);
    expect((await next.json()).currentSequence).toBe(599);
    expect(await prisma.paperEquityPoint.count({ where: { session: { datasetId: "recover" } } })).toBe(600);
  });

  it.each([true, false])("ignores stale cursor saves with paper account = %s", async (paper) => {
    const id = "stale-save-" + paper;
    await seed(id, 1, 600, -1, paper);
    const result = await POST(request({ expectedCurrentSequence: -1, expectedVersion: paper ? 1 : null, count: 1, displayIntervalSeconds: 300 }), context(id));
    expect(result.status).toBe(200);
    const saved = await progressPUT(new Request("http://localhost/api/progress", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startSequence: 0, currentSequence: -1, playbackRate: 30, displayIntervalSeconds: 300 }),
    }), context(id));
    expect(saved.status).toBe(200);
    expect((await saved.json()).currentSequence).toBe(299);
  });

  it("rejects concurrent duplicate advance requests without leaving the cursor stuck", async () => {
    await seed("duplicate", 1, 900);
    const body = { expectedCurrentSequence: -1, expectedVersion: 1, count: 1, displayIntervalSeconds: 300 };
    const responses = await Promise.all([POST(request(body), context("duplicate")), POST(request(body), context("duplicate"))]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const synced = await (await progressGET(new Request("http://localhost/api/progress"), context("duplicate"))).json();
    expect(synced.progress.currentSequence).toBe(299);
    const next = await POST(request({ ...body, expectedCurrentSequence: 299, expectedVersion: synced.snapshot.session.version }), context("duplicate"));
    expect(next.status).toBe(200);
  });

  it("returns a complete revision of a partial candle with gaps and no future data", async () => {
    await seed("gaps", 1, 4, 0, false);
    await prisma.marketBar.update({ where: { datasetId_sequence: { datasetId: "gaps", sequence: 2 } }, data: { timestamp: new Date(baseTime + 4000) } });
    await prisma.marketBar.update({ where: { datasetId_sequence: { datasetId: "gaps", sequence: 3 } }, data: { timestamp: new Date(baseTime + 8000) } });
    const response = await POST(request({ expectedCurrentSequence: 0, expectedVersion: null, count: 1, displayIntervalSeconds: 5 }), context("gaps"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.currentSequence).toBe(2);
    expect(body.aggregatedBars).toHaveLength(1);
    expect(body.aggregatedBars[0]).toMatchObject({ firstSequence: 0, lastSequence: 2, sourceCount: 3, expectedCount: 5, volume: 30, status: "COMPLETE", phase: "CLOSED", quality: "UNKNOWN" });
    expect(body.lastSourceBar.sequence).toBe(2);
    expect(body.advancedBars).toEqual([]);
  });

  it("matches sequential source-bar fills, OCO, equity and drawdown during a displayed step", async () => {
    await seed("trades", 1, 600);
    const session = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: "trades" } });
    await seedOrder({
      id: "entry", sessionId: session.id, side: "BUY", type: "MARKET", quantity: 2,
      stopLoss: 95, takeProfit: 105, createdSequence: -1, activeFromSequence: 0,
    });
    await prisma.marketBar.update({ where: { datasetId_sequence: { datasetId: "trades", sequence: 10 } },
      data: { open: 100, high: 110, low: 90, close: 102 } });
    const source = await prisma.marketBar.findMany({ where: { datasetId: "trades", sequence: { lte: 299 } }, orderBy: { sequence: "asc" } });
    let state = serializePaperSession(session);
    let orders = (await prisma.paperOrder.findMany({ where: { sessionId: session.id } })).map(serializePaperOrder);
    const expectedFills: PaperFillData[] = [];
    const expectedEquity: PaperEquityPointData[] = [];
    let counter = 0;
    for (const bar of source) {
      const result = advancePaperTrading({ state, orders, bar: serializeSourceBar(bar), makeId: () => "expected-" + counter++ });
      state = result.state; orders = result.orders; expectedFills.push(...result.fills); expectedEquity.push(result.equityPoint);
    }
    const response = await POST(request({ expectedCurrentSequence: -1, expectedVersion: 1, count: 1, displayIntervalSeconds: 300 }), context("trades"));
    expect(response.status).toBe(200);
    const result = await response.json();
    for (const [key, value] of Object.entries(state)) {
      if (typeof value === "number") expect(result.snapshot.session[key]).toBeCloseTo(value, 9);
      else expect(result.snapshot.session[key]).toEqual(value);
    }
    const fillFields = (fill: PaperFillData) => ({ sequence: fill.sequence, side: fill.side, price: fill.price, quantity: fill.quantity,
      reason: fill.reason, realizedPnl: fill.realizedPnl, fee: fill.fee, netQuantityAfter: fill.netQuantityAfter });
    expect(result.snapshot.recentFills.map(fillFields).reverse()).toEqual(expectedFills.map(fillFields));
    expect(expectedFills.map((fill) => fill.sequence)).toEqual([0, 10]);
    expect(result.snapshot.activeOrders).toHaveLength(0);
    const actualEquity = await prisma.paperEquityPoint.findMany({ where: { sessionId: session.id }, orderBy: { sequence: "asc" } });
    expect(actualEquity).toHaveLength(expectedEquity.length);
    actualEquity.forEach((point, index) => {
      const expected = expectedEquity[index];
      expect(point.sequence).toBe(expected.sequence);
      expect(point.timestamp.toISOString()).toBe(expected.timestamp);
      for (const field of ["balance", "equity", "drawdown"] as const) expect(point[field]).toBeCloseTo(expected[field], 9);
    });
  });

  it("persists closed-trade statistics incrementally", async () => {
    const id = "incremental-trade-stats";
    await seed(id, 1, 3);
    const session = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
    await seedOrder({
      id: "stats-entry", sessionId: session.id, side: "BUY", type: "MARKET", quantity: 2,
      stopLoss: 90, takeProfit: 105, createdSequence: -1, activeFromSequence: 0,
    });
    await prisma.marketBar.update({
      where: { datasetId_sequence: { datasetId: id, sequence: 1 } },
      data: { high: 110 },
    });

    const response = await POST(request({
      expectedCurrentSequence: -1, expectedVersion: 1, count: 2,
    }), context(id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.snapshot.stats).toMatchObject({
      tradeCount: 1, winRate: 1, profitFactor: null,
      averageWin: 10, averageLoss: 0, maxConsecutiveWins: 1, maxConsecutiveLosses: 0,
    });
    expect(await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } })).toMatchObject({
      tradeStatsVersion: 1, closedTradeCount: 1, winningTradeCount: 1, losingTradeCount: 0,
      grossWinningPnl: 10, grossLosingPnl: 0, maxConsecutiveWins: 1,
    });
    const journalEntry = await prisma.replayJournalEntry.findFirstOrThrow({
      where: { journalSession: { datasetId: id } },
      include: { journalSession: true },
    });
    expect(journalEntry).toMatchObject({
      no: 1, accountNo: 1, direction: "LONG", quantity: 2,
      entryPrice: 100, entryOrderType: "MARKET", exitPrice: 105, initialStopPrice: 90, initialRisk: 10, actualRisk: 1, gainLoss: 5,
    });
    expect(journalEntry.journalSession.archivedAt).toBeNull();

    const reset = await resetPOST(request({ action: "RESET" }), context(id));
    expect(reset.status).toBe(200);
    expect(await prisma.paperTradingSession.findUnique({ where: { id: session.id } })).not.toBeNull();
    expect(await prisma.replaySession.findFirst({ where: { datasetId: id, status: "ARCHIVED" } })).not.toBeNull();
    expect(await prisma.replayJournalEntry.count({ where: { journalSession: { datasetId: id } } })).toBe(1);
    expect((await prisma.replayJournalSession.findUniqueOrThrow({ where: { id: journalEntry.journalSessionId } })).archivedAt).not.toBeNull();

    const newScope = await loadReplayScope(fixtureSessions.get(id)!);
    const newSession = await prisma.paperTradingSession.findUniqueOrThrow({ where: { projectionId: newScope.projectionId } });
    expect(newSession).toMatchObject({ initialCapital: 100000, netQuantity: 0, closedTradeCount: 0 });
    await seedOrder({
      id: "stats-entry-new-account", sessionId: newSession.id, side: "BUY", type: "MARKET", quantity: 1,
      stopLoss: 90, takeProfit: 105, createdSequence: -1, activeFromSequence: 0,
    });
    const secondAdvance = await POST(request({
      expectedCurrentSequence: -1, expectedVersion: 1, count: 2,
    }), context(id));
    expect(secondAdvance.status).toBe(200);
    expect(await prisma.replayJournalEntry.findFirstOrThrow({
      where: { journalSessionId: newSession.journalSessionId! },
    })).toMatchObject({ no: 2, accountNo: 1 });
    expect(await prisma.replayJournalSession.findUniqueOrThrow({
      where: { id: newSession.journalSessionId! },
    })).toMatchObject({ nextEntryNo: 1 });
  });

  it("backfills incremental statistics once for a legacy paper session", async () => {
    const id = "legacy-trade-stats";
    await seed(id, 1, 2);
    const session = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
    await prisma.paperTrade.createMany({ data: [
      { sessionId: session.id, side: "LONG", status: "CLOSED", openedSequence: 0,
        openedAt: new Date(baseTime), closedSequence: 0, closedAt: new Date(baseTime), grossPnl: 12, fees: 2 },
      { sessionId: session.id, side: "SHORT", status: "CLOSED", openedSequence: 1,
        openedAt: new Date(baseTime + 1_000), closedSequence: 1, closedAt: new Date(baseTime + 1_000), grossPnl: -4, fees: 1 },
    ] });
    await prisma.paperTradingSession.update({
      where: { id: session.id },
      data: { tradeStatsVersion: 0 },
    });

    const snapshot = await getPaperSessionSnapshot(id);
    expect(snapshot?.stats).toMatchObject({
      tradeCount: 2, winRate: 0.5, profitFactor: 2,
      averageWin: 10, averageLoss: -5, maxConsecutiveWins: 1, maxConsecutiveLosses: 1,
    });
    expect(await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } })).toMatchObject({
      tradeStatsVersion: 1, closedTradeCount: 2, winningTradeCount: 1, losingTradeCount: 1,
      grossWinningPnl: 10, grossLosingPnl: 5,
    });
  });


  it("repairs a cursor left behind by an older client using the processed account cursor", async () => {
    await seed("old-client", 1, 600);
    await POST(request({ expectedCurrentSequence: -1, expectedVersion: 1, count: 1, displayIntervalSeconds: 300 }), context("old-client"));
    await prisma.replayProgress.updateMany({ where: { datasetId: "old-client" }, data: { currentSequence: 0 } });
    const response = await progressGET(new Request("http://localhost/api/progress"), context("old-client"));
    const recovered = await response.json();
    expect(recovered.progress.currentSequence).toBe(299);
    expect(recovered.snapshot.session.lastProcessedSequence).toBe(299);
    expect(await prisma.paperEquityPoint.count({ where: { session: { datasetId: "old-client" } } })).toBe(300);
  });

  it("does not resurrect a cleared replay from a delayed save", async () => {
    await seed("cleared", 1, 10, -1, false);
    await prisma.replayProgress.deleteMany({ where: { datasetId: "cleared" } });
    const response = await progressPUT(new Request("http://localhost/api/progress", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startSequence: 0, currentSequence: -1, playbackRate: 1, displayIntervalSeconds: 300 }),
    }), context("cleared"));
    expect(response.status).toBe(409);
    expect(await prisma.replayProgress.findFirst({ where: { datasetId: "cleared" } })).toBeNull();
  });


  it("batches displayed candles for fast playback while processing all source bars", async () => {
    await seed("display-batch", 1, 1200);
    const response = await POST(request({ expectedCurrentSequence: -1, expectedVersion: 1, count: 3, displayIntervalSeconds: 300 }), context("display-batch"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.currentSequence).toBe(899);
    expect(body.aggregatedBars).toHaveLength(3);
    expect(body.aggregatedBars.map((bar: { sourceCount: number }) => bar.sourceCount)).toEqual([300, 300, 300]);
    expect(body.snapshot.session.version).toBe(901);
    expect(body.lastSourceBar.sequence).toBe(899);
    expect(body.advancedBars).toEqual([]);
    expect(await prisma.paperEquityPoint.count({ where: { session: { datasetId: "display-batch" } } })).toBe(900);
  });

  it("batches daily-session candles and finishes at the real end of the data", async () => {
    await seed("daily-batch", 1, 600);
    await prisma.marketDataset.update({ where: { id: "daily-batch" }, data: {
      sessionMode: "DAILY_SESSION", sessionOpenMinute: 0, sessionCloseMinute: 10, tradingWeekdays: "2",
    } });
    const response = await POST(request({ expectedCurrentSequence: -1, expectedVersion: 1, count: 3, displayIntervalSeconds: 300 }), context("daily-batch"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.currentSequence).toBe(599);
    expect(body.aggregatedBars).toHaveLength(2);
    expect(body.aggregatedBars.map((bar: { status: string }) => bar.status)).toEqual(["COMPLETE", "COMPLETE"]);
  });

  it("counts real display buckets across gaps without consuming the next bucket", async () => {
    await seed("batch-gap", 1, 5, -1, false);
    // Move from the end to preserve the timestamp uniqueness constraint.
    for (const [sequence, second] of [[4, 20], [3, 10], [2, 6], [1, 1]]) {
      await prisma.marketBar.update({ where: { datasetId_sequence: { datasetId: "batch-gap", sequence } },
        data: { timestamp: new Date(baseTime + second * 1000) } });
    }
    const response = await POST(request({ expectedCurrentSequence: -1, expectedVersion: null, count: 2, displayIntervalSeconds: 5 }), context("batch-gap"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.currentSequence).toBe(2);
    expect(body.aggregatedBars).toHaveLength(2);
    expect(body.aggregatedBars.map((bar: { sourceCount: number }) => bar.sourceCount)).toEqual([2, 1]);
    expect(body.lastSourceBar.sequence).toBe(2);
  });

  it("builds RTH windows across trading days while ETH keeps overnight bars", async () => {
    const startTimeMs = Date.parse("2021-09-12T22:00:00.000Z");
    const endTimeMs = Date.parse("2021-09-14T20:15:00.000Z");
    const count = Math.floor((endTimeMs - startTimeMs) / 60_000) + 1;
    await seed("cme-window", 60, count, -1, false, { symbol: "ES1!", startTimeMs });

    const rthResponse = await windowGET(new Request(
      `http://localhost/api/window?displayIntervalSeconds=60&displaySession=RTH&endSequence=${count - 1}&visibleCount=500&warmupCount=100`,
    ), context("cme-window"));
    expect(rthResponse.status).toBe(200);
    expect(rthResponse.headers.get("X-Replay-Window-Strategy")).toBe("time-aggregate");
    expect(rthResponse.headers.get("Server-Timing")).toContain("window;dur=");
    const rthBody = await rthResponse.json();
    expect(rthBody.visibleBars).toHaveLength(500);
    expect(rthBody.warmupBars).toHaveLength(100);
    const record = await prisma.marketDataset.findUniqueOrThrow({ where: { id: "cme-window" } });
    const rth = resolveDisplaySession(record, "RTH")!;
    const rthBars = [...rthBody.warmupBars, ...rthBody.visibleBars];
    expect(rthBars.every((bar: { timestamp: string }) => (
      getAggregationBucket(Date.parse(bar.timestamp), 60, 60, rth) !== null
    ))).toBe(true);
    expect(new Set(rthBars.map((bar: { timestamp: string }) => bar.timestamp.slice(0, 10))).size).toBeGreaterThan(1);
    const plan = await prisma.$queryRawUnsafe<Array<{ detail: string }>>(
      'EXPLAIN QUERY PLAN SELECT "sequence", "timestamp" FROM "MarketBar" WHERE "datasetId" = ? AND "timestamp" >= ? AND "timestamp" < ? ORDER BY "timestamp" ASC',
      "cme-window",
      new Date("2021-09-13T13:30:00.000Z"),
      new Date("2021-09-13T20:15:00.000Z"),
    );
    expect(plan.some((step) => step.detail.includes("MarketBar_datasetId_timestamp_key"))).toBe(true);

    const hourlyResponse = await windowGET(new Request(
      `http://localhost/api/window?displayIntervalSeconds=3600&displaySession=RTH&endSequence=${count - 1}&visibleCount=20&warmupCount=0`,
    ), context("cme-window"));
    expect(hourlyResponse.status).toBe(200);
    const hourlyBody = await hourlyResponse.json();
    expect(hourlyBody.visibleBars).toHaveLength(14);
    expect(hourlyBody.visibleBars[0].timestamp).toBe("2021-09-13T13:30:00.000Z");
    expect(hourlyBody.visibleBars.at(-1)).toMatchObject({
      timestamp: "2021-09-14T19:30:00.000Z",
      sourceCount: 45,
      expectedCount: 45,
      status: "COMPLETE",
    });

    const ethResponse = await windowGET(new Request(
      `http://localhost/api/window?displayIntervalSeconds=60&displaySession=ETH&endSequence=${count - 1}&visibleCount=500&warmupCount=0`,
    ), context("cme-window"));
    expect(ethResponse.status).toBe(200);
    const ethBody = await ethResponse.json();
    expect(ethBody.visibleBars).toHaveLength(500);
    expect(ethBody.visibleBars.some((bar: { timestamp: string }) => (
      getAggregationBucket(Date.parse(bar.timestamp), 60, 60, rth) === null
    ))).toBe(true);

    const saved = await progressPUT(new Request("http://localhost/api/progress", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startSequence: 0, currentSequence: -1, playbackRate: 20, displayIntervalSeconds: 60, displaySession: "RTH" }),
    }), context("cme-window"));
    expect(saved.status).toBe(200);
    const restored = await (await progressGET(new Request("http://localhost/api/progress"), context("cme-window"))).json();
    expect(restored.progress.displaySession).toBe("RTH");

    const unsupported = await windowGET(new Request(
      "http://localhost/api/window?displayIntervalSeconds=300&displaySession=RTH&endSequence=9&visibleCount=5&warmupCount=0",
    ), context("chunk-week"));
    expect(unsupported.status).toBe(400);
  });

  it("keeps later revealed RTH candles accessible after locating Friday, across the weekend", async () => {
    const datasetId = "rth-date-navigation";
    const startTimeMs = Date.parse("2021-09-10T13:30:00.000Z");
    const revealedTime = Date.parse("2021-09-14T14:30:00.000Z");
    const count = (Date.parse("2021-09-14T20:15:00.000Z") - startTimeMs) / 60_000 + 1;
    const revealedSequence = (revealedTime - startTimeMs) / 60_000;
    await seed(datasetId, 60, count, revealedSequence, false, { symbol: "ES1!", startTimeMs });
    const progressBefore = await prisma.replayProgress.findFirstOrThrow({ where: { datasetId } });
    const focus = (Date.parse("2021-09-10T19:30:00.000Z") - startTimeMs) / 60_000;
    const readWindow = async (focusSequence: number, visibleCount: number) => {
      const response = await windowGET(new Request(`http://localhost/api/window?displayIntervalSeconds=300&displaySession=RTH&endSequence=${revealedSequence}&focusSequence=${focusSequence}&visibleCount=${visibleCount}&warmupCount=20`), context(datasetId));
      expect(response.status).toBe(200);
      return await response.json() as { visibleBars: AggregatedMarketBarData[] };
    };
    const located = await readWindow(focus, 300);
    expect(located.visibleBars.at(-1)!.timestamp).toBe("2021-09-10T20:10:00.000Z");
    const later = await readLaterHistoryWindow({
      afterSequence: located.visibleBars.at(-1)!.lastSequence, endSequence: revealedSequence,
      sourceSeconds: 60, displaySeconds: 300, visibleCount: 300,
      readWindow: (sequence) => readWindow(sequence, 300),
    });
    expect(later).not.toBeNull();
    const merged = mergeHistoricalBars(located.visibleBars, later!.visibleBars);
    expect(merged.some((bar) => bar.timestamp === "2021-09-10T19:30:00.000Z")).toBe(true);
    expect(merged.some((bar) => bar.timestamp === "2021-09-13T13:30:00.000Z")).toBe(true);
    expect(merged.every((bar) => bar.lastSequence <= revealedSequence)).toBe(true);
    expect(new Set(merged.map((bar) => bar.timestamp)).size).toBe(merged.length);
    expect(await prisma.replayProgress.findFirstOrThrow({ where: { datasetId } })).toEqual(progressBefore);
  });

  it("fast-forwards hidden RTH bars without changing paper fills or equity", async () => {
    const startTimeMs = Date.parse("2021-09-13T20:15:00.000Z");
    const count = 1_041;
    for (const id of ["cme-rth", "cme-eth"]) {
      await seed(id, 60, count, -1, true, { symbol: "ES", startTimeMs });
      const session = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
      await seedOrder({
        id: `${id}-night-entry`, sessionId: session.id, side: "BUY", type: "MARKET", quantity: 2,
        createdSequence: -1, activeFromSequence: 0,
      });
    }

    const rthResponse = await POST(request({
      expectedCurrentSequence: -1, expectedVersion: 1, count: 1,
      displayIntervalSeconds: 300, displaySession: "RTH",
    }), context("cme-rth"));
    expect(rthResponse.status).toBe(200);
    const rthBody = await rthResponse.json();
    expect(rthBody.reachedVisibleBucket).toBe(true);
    expect(rthBody.currentSequence).toBe(1_039);
    expect(rthBody.aggregatedBars).toHaveLength(1);
    expect(rthBody.aggregatedBars[0]).toMatchObject({
      timestamp: "2021-09-14T13:30:00.000Z", sourceCount: 5, expectedCount: 5,
    });
    expect(rthBody.snapshot.recentFills.some((fill: { sequence: number }) => fill.sequence === 0)).toBe(true);
    expect(rthBody.aggregatedBars.some((bar: { firstSequence: number; lastSequence: number }) => (
      0 >= bar.firstSequence && 0 <= bar.lastSequence
    ))).toBe(false);

    let currentSequence = -1;
    let expectedVersion = 1;
    let ethBody: Awaited<ReturnType<Response["json"]>> | null = null;
    while (currentSequence < rthBody.currentSequence) {
      const step = Math.min(100, rthBody.currentSequence - currentSequence);
      const response = await POST(request({ expectedCurrentSequence: currentSequence, expectedVersion, count: step }), context("cme-eth"));
      expect(response.status).toBe(200);
      ethBody = await response.json();
      currentSequence = ethBody!.currentSequence;
      expectedVersion = ethBody!.snapshot.session.version;
    }
    expect(ethBody).not.toBeNull();
    const sessionFields = (body: { snapshot: { session: {
      balance: number; netQuantity: number; averageEntryPrice: number | null; realizedPnl: number;
      totalFees: number; peakEquity: number; maxDrawdown: number; lastProcessedSequence: number;
    } } }) => {
      const session = body.snapshot.session;
      return {
        balance: session.balance,
        netQuantity: session.netQuantity,
        averageEntryPrice: session.averageEntryPrice,
        realizedPnl: session.realizedPnl,
        totalFees: session.totalFees,
        peakEquity: session.peakEquity,
        maxDrawdown: session.maxDrawdown,
        lastProcessedSequence: session.lastProcessedSequence,
      };
    };
    expect(sessionFields(ethBody!)).toEqual(sessionFields(rthBody));
    expect(ethBody!.snapshot.stats).toEqual(rthBody.snapshot.stats);
    expect(ethBody!.snapshot.recentFills.map((fill: PaperFillData) => ({
      sequence: fill.sequence, side: fill.side, price: fill.price, quantity: fill.quantity, reason: fill.reason,
    }))).toEqual(rthBody.snapshot.recentFills.map((fill: PaperFillData) => ({
      sequence: fill.sequence, side: fill.side, price: fill.price, quantity: fill.quantity, reason: fill.reason,
    })));
  }, 15_000);

  it.skipIf(!process.env.REPLAY_BENCHMARK)("benchmarks 1s → 5m against native 5m", async () => {
    const report = [];
    for (const seconds of [1, 300]) {
      const ratio = 300 / seconds;
      const id = "bench-" + seconds;
      await seed(id, seconds, 80 * ratio, 40 * ratio - 1);
      const samples: number[] = [];
      let bytes = 0;
      for (let step = 0; step < 14; step++) {
        const progress = await prisma.replayProgress.findFirstOrThrow({ where: { datasetId: id } });
        const session = await prisma.paperTradingSession.findFirstOrThrow({ where: { datasetId: id } });
        const start = performance.now();
        const response = await POST(request({
          expectedCurrentSequence: progress.currentSequence, expectedVersion: session.version, count: 1, displayIntervalSeconds: 300,
        }), context(id));
        expect(response.status).toBe(200);
        const body = await response.json();
        let size = JSON.stringify(body).length;
        // Older implementation needs a full window request after every displayed step.
        if (!body.aggregatedBars) {
          const window = await windowGET(new Request(`http://localhost/api/window?displayIntervalSeconds=300&endSequence=${body.currentSequence}&visibleCount=300&warmupCount=1000`), context(id));
          expect(window.status).toBe(200);
          size += (await window.text()).length;
        }
        if (step >= 2) { samples.push(performance.now() - start); bytes += size; }
      }
      samples.sort((a, b) => a - b);
      report.push({ sourceSeconds: seconds, medianMs: Math.round(samples[Math.floor(samples.length / 2)]), p95Ms: Math.round(samples.at(-1)!), averageBytes: Math.round(bytes / samples.length) });
    }
    console.log("REPLAY_BENCHMARK", JSON.stringify(report));
  }, 120_000);
});
