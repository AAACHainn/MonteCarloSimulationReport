import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  return {
    prisma: new PrismaClient({ datasourceUrl: `file:${join(tmpdir(), "replay-integration-" + randomUUID() + ".db")}` }),
    replayDatabaseQueryCount: () => null,
  };
});

import { prisma } from "@/lib/db";
import { POST } from "@/app/api/market-datasets/[id]/replay/advance/route";
import { POST as syncPOST } from "@/app/api/market-datasets/[id]/replay/sync/route";
import { POST as resetPOST } from "@/app/api/market-datasets/[id]/replay/reset/route";
import { GET as progressGET, PUT as progressPUT } from "@/app/api/market-datasets/[id]/progress/route";
import { advancePaperTrading } from "@/lib/paper-trading/engine";
import { getPaperSessionSnapshot, serializePaperSession, serializePaperOrder } from "@/lib/paper-trading/serialize";
import { serializeSourceBar } from "./dataset";
import { createDeterministicEventIdFactory } from "@/lib/paper-trading/deterministic-id";
import type { PaperFillData, PaperEquityPointData, PaperSessionSnapshot } from "@/lib/paper-trading/types";
import { GET as windowGET } from "@/app/api/market-datasets/[id]/bars/window/route";
import { GET as chunksGET } from "@/app/api/market-datasets/[id]/bars/chunks/route";
import { applySpeculativeAdvance, paperStateFingerprint } from "@/lib/paper-trading/speculative";
import { buildPaperReplayDelta, createPaperDeltaAccumulator, recordPaperAdvance } from "./client-sync";
import { resolveDisplaySession } from "./chart-sessions";
import { getAggregationBucket } from "./aggregation";
import { buildMarketBarBlocks } from "./bar-blocks";

let databaseFile = "";
const baseTime = Date.UTC(2026, 8, 1);
const request = (body: unknown) => new Request("http://localhost/api/advance", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const syncRequest = (body: unknown) => new Request("http://localhost/api/sync", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  const files = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list");
  databaseFile = files[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], {
    env: { ...process.env, DATABASE_URL: `file:${databaseFile}` }, stdio: "pipe",
  });
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  if (databaseFile.includes("replay-integration-")) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(databaseFile + suffix, { force: true });
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
  await prisma.replayProgress.create({ data: {
    datasetId: id, startSequence: start + 1, currentSequence: start,
    playbackRate: 20, displayIntervalSeconds: 300,
  } });
  if (paper) await prisma.paperTradingSession.create({ data: {
    datasetId: id, initialCapital: 100000, currency: "USD", peakEquity: 100000,
    lastProcessedSequence: start, equitySampleStride: Math.max(1, Math.ceil(count / 20000)),
  } });
}

async function clientSyncBody(id: string, targetSequence: number, requestId: string) {
  const [dataset, progress, snapshot] = await Promise.all([
    prisma.marketDataset.findUniqueOrThrow({ where: { id } }),
    prisma.replayProgress.findUniqueOrThrow({ where: { datasetId: id } }),
    getPaperSessionSnapshot(id),
  ]);
  const accumulator = createPaperDeltaAccumulator(progress.currentSequence);
  let visible = snapshot;
  if (visible) {
    const bars = await prisma.marketBar.findMany({
      where: { datasetId: id, sequence: { gt: progress.currentSequence, lte: targetSequence } },
      orderBy: { sequence: "asc" },
    });
    for (const record of bars) {
      const result = advancePaperTrading({
        state: visible.session, orders: visible.activeOrders, bar: serializeSourceBar(record),
        makeId: createDeterministicEventIdFactory(visible.session.id, progress.generation, record.sequence),
      });
      recordPaperAdvance(accumulator, visible, result,
        result.fills.length > 0 || record.sequence === dataset.barCount - 1 || record.sequence % Math.max(1, Math.ceil(dataset.barCount / 20_000)) === 0);
      visible = applySpeculativeAdvance(visible, result);
    }
  }
  accumulator.toSequence = targetSequence;
  return {
    generation: progress.generation, requestId, confirmedSequence: progress.currentSequence,
    syncVersion: progress.syncVersion, dataVersion: dataset.dataVersion,
    expectedPaperVersion: snapshot?.session.version ?? null, targetSequence,
    paperDelta: visible ? buildPaperReplayDelta(accumulator, visible) : null,
  };
}

describe("replay advance with real SQLite", () => {
  it("resumes legacy block construction from the persisted cursor", async () => {
    const id = "block-resume";
    await seed(id, 1, 5_000, -1, false);
    await buildMarketBarBlocks(id, 5_000);
    expect(await prisma.marketBarBlock.count({ where: { datasetId: id } })).toBe(2);
    expect(await prisma.marketDataset.findUniqueOrThrow({ where: { id } })).toMatchObject({
      barBlockBuildCursor: 4_999,
    });

    await buildMarketBarBlocks(id, 5_000);
    expect(await prisma.marketBarBlock.count({ where: { datasetId: id } })).toBe(2);
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
    const body = await clientSyncBody("sync-idempotent", 99, "same-request");
    const first = await syncPOST(syncRequest(body), context("sync-idempotent"));
    const retried = await syncPOST(syncRequest(body), context("sync-idempotent"));
    expect(first.status).toBe(200);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(await first.json());
    expect(await prisma.paperEquityPoint.count({
      where: { session: { datasetId: "sync-idempotent" } },
    })).toBe(100);
    const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { datasetId: "sync-idempotent" } });
    expect(progress).toMatchObject({ currentSequence: 99, syncVersion: 1, lastSyncRequestId: "same-request" });
  });

  it("rejects a tampered client accounting delta without moving the saved cursor", async () => {
    await seed("sync-tampered", 1, 30);
    const body = await clientSyncBody("sync-tampered", 9, "tampered");
    if (!body.paperDelta) throw new Error("Expected a paper delta");
    body.paperDelta.state.totalFees += 10;
    const response = await syncPOST(syncRequest(body), context("sync-tampered"));
    expect(response.status).toBe(400);
    const [progress, session] = await Promise.all([
      prisma.replayProgress.findUniqueOrThrow({ where: { datasetId: "sync-tampered" } }),
      prisma.paperTradingSession.findUniqueOrThrow({ where: { datasetId: "sync-tampered" } }),
    ]);
    expect(progress).toMatchObject({ currentSequence: -1, syncVersion: 0 });
    expect(session).toMatchObject({ lastProcessedSequence: -1, version: 1, totalFees: 0 });
  });

  it("rejects stale sync versions and requests from a reset generation", async () => {
    await seed("sync-generation", 1, 300, -1, false);
    const staleVersion = await syncPOST(syncRequest({
      generation: 1, requestId: "version", confirmedSequence: -1, syncVersion: 1,
      dataVersion: 1, expectedPaperVersion: null, targetSequence: 1, paperDelta: null,
    }), context("sync-generation"));
    expect(staleVersion.status).toBe(409);

    const reset = await resetPOST(request({ action: "RESET" }), context("sync-generation"));
    expect(reset.status).toBe(200);
    const resetBody = await reset.json();
    expect(resetBody.generation).toBe(2);
    const staleGeneration = await syncPOST(syncRequest({
      generation: 1, requestId: "old-generation", confirmedSequence: -1, syncVersion: 0,
      dataVersion: 1, expectedPaperVersion: null, targetSequence: 1, paperDelta: null,
    }), context("sync-generation"));
    expect(staleGeneration.status).toBe(409);
  });

  it("limits browser sync batches to one hundred source bars", async () => {
    await seed("sync-limit", 1, 300, -1, false);
    const response = await syncPOST(syncRequest({
      generation: 1, requestId: "too-many", confirmedSequence: -1, syncVersion: 0,
      dataVersion: 1, expectedPaperVersion: null, targetSequence: 100, paperDelta: null,
    }), context("sync-limit"));
    expect(response.status).toBe(400);
  });

  it("matches browser-side deterministic fill and protective-order ids", async () => {
    await seed("sync-deterministic", 1, 30);
    const session = await prisma.paperTradingSession.findUniqueOrThrow({ where: { datasetId: "sync-deterministic" } });
    await prisma.paperOrder.create({ data: {
      id: "entry-sync", sessionId: session.id, side: "BUY", type: "MARKET", quantity: 2,
      stopLoss: 95, takeProfit: 105, createdSequence: -1, activeFromSequence: 0,
    } });
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
        makeId: createDeterministicEventIdFactory(session.id, 1, record.sequence),
      });
      state = result.state;
      orders = result.orders;
      expectedFillIds.push(...result.fills.map((fill) => fill.id));
    }
    const response = await syncPOST(syncRequest(
      await clientSyncBody("sync-deterministic", 9, "deterministic"),
    ), context("sync-deterministic"));
    expect(response.status).toBe(200);
    const persistedFills = await prisma.paperFill.findMany({ where: { sessionId: session.id }, orderBy: { sequence: "asc" } });
    const persistedProtective = await prisma.paperOrder.findMany({
      where: { sessionId: session.id, isProtective: true },
      orderBy: { id: "asc" },
    });
    expect(persistedFills.map((fill) => fill.id)).toEqual(expectedFillIds);
    expect(persistedProtective.map((order) => order.id)).toEqual(
      orders.filter((order) => order.isProtective).map((order) => order.id).sort(),
    );
  });

  it("ignores database-only order metadata on the sync after creating protective orders", async () => {
    const id = "sync-protective-metadata";
    await seed(id, 1, 30);
    const [dataset, progress, initial] = await Promise.all([
      prisma.marketDataset.findUniqueOrThrow({ where: { id } }),
      prisma.replayProgress.findUniqueOrThrow({ where: { datasetId: id } }),
      getPaperSessionSnapshot(id),
    ]);
    if (!initial) throw new Error("Expected a paper session");
    await prisma.paperOrder.create({ data: {
      id: "metadata-entry", sessionId: initial.session.id, side: "BUY", type: "MARKET", quantity: 2,
      stopLoss: 95, takeProfit: 105, createdSequence: -1, activeFromSequence: 0,
    } });
    const starting = await getPaperSessionSnapshot(id);
    if (!starting) throw new Error("Expected a paper session snapshot");

    const advanceOne = async (snapshot: PaperSessionSnapshot, sequence: number) => {
      const record = await prisma.marketBar.findUniqueOrThrow({ where: { datasetId_sequence: { datasetId: id, sequence } } });
      const accumulator = createPaperDeltaAccumulator(sequence - 1);
      const result = advancePaperTrading({
        state: snapshot.session,
        orders: snapshot.activeOrders,
        bar: serializeSourceBar(record),
        makeId: createDeterministicEventIdFactory(snapshot.session.id, progress.generation, sequence),
      });
      recordPaperAdvance(accumulator, snapshot, result, true);
      const next = applySpeculativeAdvance(snapshot, result);
      return { next, delta: buildPaperReplayDelta(accumulator, next) };
    };

    const first = await advanceOne(starting, 0);
    const firstResponse = await syncPOST(syncRequest({
      generation: progress.generation, requestId: "protective-first", confirmedSequence: -1,
      syncVersion: progress.syncVersion, dataVersion: dataset.dataVersion,
      expectedPaperVersion: starting.session.version, targetSequence: 0, paperDelta: first.delta,
    }), context(id));
    expect(firstResponse.status).toBe(200);
    const firstReceipt = await firstResponse.json();
    expect(first.next.activeOrders).toHaveLength(2);
    expect(first.next.activeOrders.every((order) => order.createdAt === undefined)).toBe(true);
    const persistedProtective = await prisma.paperOrder.findMany({ where: { sessionId: starting.session.id, status: "PENDING" } });
    expect(persistedProtective.every((order) => order.createdAt instanceof Date)).toBe(true);

    const second = await advanceOne(first.next, 1);
    expect(second.delta.orderChanges).toEqual([]);
    const tamperedDelta = {
      ...second.delta,
      activeOrders: second.delta.activeOrders.map((order, index) => (
        index === 0 ? { ...order, price: Number(order.price) + 1 } : order
      )),
    };
    tamperedDelta.fingerprint = paperStateFingerprint(tamperedDelta.state, tamperedDelta.activeOrders);
    const tamperedResponse = await syncPOST(syncRequest({
      generation: progress.generation, requestId: "protective-tampered", confirmedSequence: 0,
      syncVersion: firstReceipt.syncVersion, dataVersion: dataset.dataVersion,
      expectedPaperVersion: firstReceipt.paperVersion, targetSequence: 1, paperDelta: tamperedDelta,
    }), context(id));
    expect(tamperedResponse.status).toBe(400);

    const secondResponse = await syncPOST(syncRequest({
      generation: progress.generation, requestId: "protective-second", confirmedSequence: 0,
      syncVersion: firstReceipt.syncVersion, dataVersion: dataset.dataVersion,
      expectedPaperVersion: firstReceipt.paperVersion, targetSequence: 1, paperDelta: second.delta,
    }), context(id));
    expect(secondResponse.status).toBe(200);
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
    expect(body.aggregatedBars[0]).toMatchObject({ firstSequence: 0, lastSequence: 2, sourceCount: 3, expectedCount: 5, volume: 30, status: "INCOMPLETE" });
    expect(body.lastSourceBar.sequence).toBe(2);
    expect(body.advancedBars).toEqual([]);
  });

  it("matches sequential source-bar fills, OCO, equity and drawdown during a displayed step", async () => {
    await seed("trades", 1, 600);
    const session = await prisma.paperTradingSession.findUniqueOrThrow({ where: { datasetId: "trades" } });
    await prisma.paperOrder.create({ data: {
      id: "entry", sessionId: session.id, side: "BUY", type: "MARKET", quantity: 2,
      stopLoss: 95, takeProfit: 105, createdSequence: -1, activeFromSequence: 0,
    } });
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
    const session = await prisma.paperTradingSession.findUniqueOrThrow({ where: { datasetId: id } });
    await prisma.paperOrder.create({ data: {
      id: "stats-entry", sessionId: session.id, side: "BUY", type: "MARKET", quantity: 2,
      stopLoss: 90, takeProfit: 105, createdSequence: -1, activeFromSequence: 0,
    } });
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
    expect(await prisma.paperTradingSession.findUniqueOrThrow({ where: { datasetId: id } })).toMatchObject({
      tradeStatsVersion: 1, closedTradeCount: 1, winningTradeCount: 1, losingTradeCount: 0,
      grossWinningPnl: 10, grossLosingPnl: 0, maxConsecutiveWins: 1,
    });
    const journalEntry = await prisma.replayJournalEntry.findFirstOrThrow({
      where: { journalSession: { datasetId: id } },
      include: { journalSession: true },
    });
    expect(journalEntry).toMatchObject({
      no: 1, direction: "LONG", quantity: 2,
      entryPrice: 100, entryOrderType: "MARKET", exitPrice: 105, initialStopPrice: 90, initialRisk: 10, actualRisk: 1, gainLoss: 5,
    });
    expect(journalEntry.journalSession.archivedAt).toBeNull();

    const reset = await resetPOST(request({ action: "RESET" }), context(id));
    expect(reset.status).toBe(200);
    expect(await prisma.paperTradingSession.findUnique({ where: { datasetId: id } })).toBeNull();
    expect(await prisma.replayJournalEntry.count({ where: { journalSession: { datasetId: id } } })).toBe(1);
    expect((await prisma.replayJournalSession.findFirstOrThrow({ where: { datasetId: id } })).archivedAt).not.toBeNull();
  });

  it("backfills incremental statistics once for a legacy paper session", async () => {
    const id = "legacy-trade-stats";
    await seed(id, 1, 2);
    const session = await prisma.paperTradingSession.findUniqueOrThrow({ where: { datasetId: id } });
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
    expect(await prisma.paperTradingSession.findUniqueOrThrow({ where: { datasetId: id } })).toMatchObject({
      tradeStatsVersion: 1, closedTradeCount: 2, winningTradeCount: 1, losingTradeCount: 1,
      grossWinningPnl: 10, grossLosingPnl: 5,
    });
  });


  it("repairs a cursor left behind by an older client using the processed account cursor", async () => {
    await seed("old-client", 1, 600);
    await POST(request({ expectedCurrentSequence: -1, expectedVersion: 1, count: 1, displayIntervalSeconds: 300 }), context("old-client"));
    await prisma.replayProgress.update({ where: { datasetId: "old-client" }, data: { currentSequence: 0 } });
    const response = await progressGET(new Request("http://localhost/api/progress"), context("old-client"));
    const recovered = await response.json();
    expect(recovered.progress.currentSequence).toBe(299);
    expect(recovered.snapshot.session.lastProcessedSequence).toBe(299);
    expect(await prisma.paperEquityPoint.count({ where: { session: { datasetId: "old-client" } } })).toBe(300);
  });

  it("does not resurrect a cleared replay from a delayed save", async () => {
    await seed("cleared", 1, 10, -1, false);
    await prisma.replayProgress.delete({ where: { datasetId: "cleared" } });
    const response = await progressPUT(new Request("http://localhost/api/progress", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startSequence: 0, currentSequence: -1, playbackRate: 1, displayIntervalSeconds: 300 }),
    }), context("cleared"));
    expect(response.status).toBe(409);
    expect(await prisma.replayProgress.findUnique({ where: { datasetId: "cleared" } })).toBeNull();
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

  it("fast-forwards hidden RTH bars without changing paper fills or equity", async () => {
    const startTimeMs = Date.parse("2021-09-13T20:15:00.000Z");
    const count = 1_041;
    for (const id of ["cme-rth", "cme-eth"]) {
      await seed(id, 60, count, -1, true, { symbol: "ES", startTimeMs });
      const session = await prisma.paperTradingSession.findUniqueOrThrow({ where: { datasetId: id } });
      await prisma.paperOrder.create({ data: {
        id: `${id}-night-entry`, sessionId: session.id, side: "BUY", type: "MARKET", quantity: 2,
        createdSequence: -1, activeFromSequence: 0,
      } });
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
        const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { datasetId: id } });
        const session = await prisma.paperTradingSession.findUniqueOrThrow({ where: { datasetId: id } });
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
