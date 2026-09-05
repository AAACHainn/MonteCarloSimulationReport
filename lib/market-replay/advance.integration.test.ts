import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  return { prisma: new PrismaClient({ datasourceUrl: `file:${join(tmpdir(), "replay-integration-" + randomUUID() + ".db")}` }) };
});

import { prisma } from "@/lib/db";
import { POST } from "@/app/api/market-datasets/[id]/replay/advance/route";
import { GET as progressGET, PUT as progressPUT } from "@/app/api/market-datasets/[id]/progress/route";
import { advancePaperTrading } from "@/lib/paper-trading/engine";
import { serializePaperSession, serializePaperOrder } from "@/lib/paper-trading/serialize";
import { serializeSourceBar } from "./dataset";
import type { PaperFillData, PaperEquityPointData } from "@/lib/paper-trading/types";
import { GET as windowGET } from "@/app/api/market-datasets/[id]/bars/window/route";

let databaseFile = "";
const baseTime = Date.UTC(2026, 8, 1);
const request = (body: unknown) => new Request("http://localhost/api/advance", {
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

async function seed(id: string, seconds: number, count: number, start = -1, paper = true) {
  await prisma.marketDataset.create({ data: {
    id, name: id, symbol: "TEST", timeframe: `${seconds}s`, timezone: "UTC",
    sourceIntervalSeconds: seconds, barCount: count, startTime: new Date(baseTime),
    endTime: new Date(baseTime + (count - 1) * seconds * 1000),
  } });
  for (let from = 0; from < count; from += 1000) {
    await prisma.marketBar.createMany({ data: Array.from({ length: Math.min(1000, count - from) }, (_, offset) => {
      const sequence = from + offset;
      const close = 100 + Math.sin(sequence * seconds / 300);
      return { datasetId: id, sequence, timestamp: new Date(baseTime + sequence * seconds * 1000),
        open: close, high: close + 1, low: close - 1, close, volume: 10 };
    }) });
  }
  await prisma.replayProgress.create({ data: {
    datasetId: id, startSequence: start + 1, currentSequence: start, intervalMs: 1000,
    playbackRate: 20, displayIntervalSeconds: 300,
  } });
  if (paper) await prisma.paperTradingSession.create({ data: {
    datasetId: id, initialCapital: 100000, currency: "USD", peakEquity: 100000,
    lastProcessedSequence: start, equitySampleStride: Math.max(1, Math.ceil(count / 20000)),
  } });
}

describe("replay advance with real SQLite", () => {
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
