import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
const audit = vi.hoisted(() => ({ queries: [] as Array<{ query: string; duration: number }> }));
vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("../../../lib/sqlite-client.mjs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { randomUUID } = await import("node:crypto");
  const client = createDatabaseClient({ datasourceUrl: "file:" + join(tmpdir(), "sqlite-wal-benchmark-" + randomUUID() + ".db"), log: [{ emit: "event", level: "query" }] }, { allowCreate: true });
  (client as unknown as { $on(event: "query", callback: (event: { query: string; duration: number }) => void): void })
    .$on("query", event => audit.queries.push({ query: event.query, duration: event.duration }));
  return { prisma: client, replayDatabaseQueryCount: () => audit.queries.length };
});
import { prisma } from "@/lib/db";
import { createReplaySession } from "@/lib/replay-sessions/service";
import { POST as accountPOST } from "@/app/api/market-datasets/[id]/paper-session/route";
import { POST as orderPOST } from "@/app/api/market-datasets/[id]/paper-session/orders/route";
import { POST as syncPOST } from "@/app/api/market-datasets/[id]/replay/sync/route";

import * as snapshots from "@/lib/paper-trading/serialize";
import * as persistence from "@/lib/replay-sessions/persistence";
import * as contexts from "@/lib/replay-sessions/context-storage";
import * as engine from "@/lib/paper-trading/engine";
const phase = { snapshot: 0, persistence: 0, context: 0, matching: 0 };
const originalSnapshot = snapshots.getPaperSessionSnapshot;
vi.spyOn(snapshots, "getPaperSessionSnapshot").mockImplementation(async (...args) => {
  const start = performance.now(); try { return await originalSnapshot(...args); } finally { phase.snapshot += performance.now() - start; }
});
const originalPersistence = persistence.persistDerivedBatch;
vi.spyOn(persistence, "persistDerivedBatch").mockImplementation(async (...args) => {
  const start = performance.now(); try { return await originalPersistence(...args); } finally { phase.persistence += performance.now() - start; }
});
const originalContext = contexts.persistContextRuns;
vi.spyOn(contexts, "persistContextRuns").mockImplementation(async (...args) => {
  const start = performance.now(); try { return await originalContext(...args); } finally { phase.context += performance.now() - start; }
});
const originalMatching = engine.advancePaperTrading;
vi.spyOn(engine, "advancePaperTrading").mockImplementation((...args) => {
  const start = performance.now(); try { return originalMatching(...args); } finally { phase.matching += performance.now() - start; }
});

let file = "";
const base = Date.UTC(2026, 9, 1);
beforeAll(async () => {
  file = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/database/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: "file:" + file }, stdio: "pipe", timeout: 45000 });
  await prisma.marketDataset.create({ data: { id: "audit", name: "Audit", symbol: "TEST", timeframe: "1m", sourceIntervalSeconds: 60,
    timezone: "UTC", barCount: 5000, startTime: new Date(base), endTime: new Date(base + 4999 * 60000), priceTickSize: 0.25 } });
  for (let from = 0; from < 5000; from += 500) await prisma.marketBar.createMany({ data: Array.from({ length: 500 }, (_, i) => ({
    datasetId: "audit", sequence: from + i, timestamp: new Date(base + (from + i) * 60000), open: 100, high: 101, low: 99, close: 100,
  })) });
}, 60000);
afterAll(async () => { await prisma.$disconnect(); if (file.includes("sqlite-wal-benchmark-")) rmSync(file, { force: true }); });
const ctx = { params: Promise.resolve({ id: "audit" }) };
function req(session: { id: string; activeProjectionId: string | null }, body: unknown) {
  return new Request("http://localhost/api/test?replaySessionId=" + session.id, { method: "POST", headers: { "Content-Type": "application/json", "X-Replay-Projection": session.activeProjectionId! }, body: JSON.stringify(body) });
}
function p(values: number[], q: number) { return Math.round([...values].sort((a,b) => a-b)[Math.min(values.length - 1, Math.floor(values.length * q))] * 10) / 10; }
it("audits current sync routes in an isolated database", async () => {
  const report = [];
  const runtime = { version: (await prisma.$queryRawUnsafe<Array<{ version: string }>>("SELECT sqlite_version() AS version"))[0].version, journalMode: (await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode"))[0].journal_mode, synchronous: Number((await prisma.$queryRawUnsafe<Array<{ synchronous: bigint | number }>>("PRAGMA synchronous"))[0].synchronous) };
  expect(runtime.journalMode).toBe(process.env.SQLITE_WAL_VALIDATION_MODE === "wal" ? "wal" : "delete");
  expect(runtime.synchronous).toBe(2);
  expect(runtime.version).toBe(process.env.SQLITE_WAL_VALIDATION_MODE === "native-delete" ? "3.46.0" : "3.51.3");
  console.log("AUDIT_ENGINE", JSON.stringify(runtime));
  for (const spec of [
    { name: "flat-1", batch: 1, position: false, history: false, changingContext: false },
    { name: "position-1", batch: 1, position: true, history: false, changingContext: false },
    { name: "history-1", batch: 1, position: false, history: true, changingContext: false },
    { name: "flat-5", batch: 5, position: false, history: false, changingContext: false },
    { name: "context-5", batch: 5, position: false, history: false, changingContext: true },
    { name: "context-100", batch: 100, position: false, history: false, changingContext: true },
  ]) {
    const session = await createReplaySession("audit", { name: spec.name, mode: "TRAINING", timestamp: new Date(base + 100 * 60000).toISOString(),
      playbackRate: 100, displayIntervalSeconds: 300, displaySession: "ETH" });
    expect((await accountPOST(req(session, { initialCapital: 100000, currency: "USD", commissionBps: 0, slippageBps: 0 }), ctx)).status).toBe(201);
    let account = await prisma.paperTradingSession.findUniqueOrThrow({ where: { projectionId: session.activeProjectionId } });
    if (spec.position) expect((await orderPOST(req(session, { side: "BUY", type: "MARKET", quantity: 1, stopLoss: 50, takeProfit: 150, expectedVersion: account.version }), ctx)).status).toBe(201);
    if (spec.history) {
      await prisma.paperOrder.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ id: session.id + "-past-order-" + i,
        sessionId: account.id, side: "BUY", type: "MARKET", status: "FILLED", quantity: 1, createdSequence: i, activeFromSequence: i + 1,
        filledSequence: i + 1, filledAt: new Date(base + i * 60000), filledPrice: 100 })) });
      await prisma.paperFill.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ id: session.id + "-past-fill-" + i,
        sessionId: account.id, orderId: session.id + "-past-order-" + (i % 30), sequence: i + 1, timestamp: new Date(base + i * 60000),
        side: "SELL", price: 100, quantity: 1, fee: 0, slippageCost: 0, realizedPnl: 0, closedQuantity: 1, openedQuantity: 0, netQuantityAfter: 0, reason: "CLOSE" })) });
      await prisma.paperTrade.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ sessionId: account.id, side: "LONG", status: "CLOSED",
        openedSequence: i, closedSequence: i + 1, openedAt: new Date(base + i * 60000), closedAt: new Date(base + (i + 1) * 60000) })) });
    }
    const phases = [] as Array<typeof phase>;
    const commits = [], sqlTotals = [];
    const samples = [], queries = [], bytes = [], statements: Record<string, number> = {};
    for (let step = 0; step < 35; step++) {
      const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { replaySessionId: session.id } });
      account = await prisma.paperTradingSession.findUniqueOrThrow({ where: { projectionId: session.activeProjectionId } });
      const from = progress.currentSequence + 1, to = progress.currentSequence + spec.batch;
      const context = { abrValue: 2, abrLength: 8, displayIntervalSeconds: 300, displaySession: "ETH" as const, displayUtcOffsetMinutes: 0, priceTickSize: 0.25 };
      const contextRuns = spec.changingContext ? Array.from({ length: spec.batch }, (_, i) => ({ fromSequence: from + i, toSequence: from + i,
        generation: progress.generation, context: { ...context, abrValue: 2 + ((from + i) % 10) / 10 } })) : [{ fromSequence: from, toSequence: to, generation: progress.generation, context }];
      const input = req(session, { requestId: spec.name + "-" + step, generation: progress.generation, confirmedSequence: progress.currentSequence,
        syncVersion: progress.syncVersion, dataVersion: 1, historyVersion: 1, expectedPaperVersion: account.version, targetSequence: to, contextRuns });
      for (const key of Object.keys(phase) as Array<keyof typeof phase>) phase[key] = 0;
      const before = audit.queries.length, started = performance.now();
      const response = await syncPOST(input, ctx);
      const text = await response.text();
      expect(response.status, text).toBe(200);
      const elapsed = performance.now() - started;
      if (step >= 5) {
        phases.push({ ...phase });
        const queryBatch = audit.queries.slice(before);
        commits.push(queryBatch.filter(q => q.query.startsWith("COMMIT")).reduce((sum,q) => sum + q.duration,0));
        sqlTotals.push(queryBatch.reduce((sum,q) => sum + q.duration,0));
        samples.push(elapsed); queries.push(audit.queries.length - before); bytes.push(Buffer.byteLength(text));
        if (step === 5) for (const query of audit.queries.slice(before)) {
          const operation = query.query.split(/\s+/)[0]; statements[operation] = (statements[operation] ?? 0) + 1;
        }
      }
    }
    const entry = { scenario: spec.name, samples: samples.length, medianMs: p(samples,.5), p95Ms: p(samples,.95),
      medianCommitMs: p(commits,.5), medianSqlMs: p(sqlTotals,.5), durationsMs: samples.map(value => Math.round(value * 10) / 10), commitDurationsMs: commits, queries: p(queries,.5), bodyBytes: p(bytes,.5), statements, medianPhasesMs: Object.fromEntries(Object.keys(phase).map(key => [key, p(phases.map(value => value[key as keyof typeof phase]), .5)])) };
    report.push(entry); console.log("AUDIT_SAMPLE", JSON.stringify({ scenario: entry.scenario, medianMs: entry.medianMs, p95Ms: entry.p95Ms, medianCommitMs: entry.medianCommitMs }));
  }
  const mode = process.env.SQLITE_WAL_VALIDATION_MODE;
  const checkpoint = mode === "wal" ? await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(PASSIVE)") : null;
  writeFileSync("tmp/sqlite-wal-validation/benchmark-" + mode + ".json", JSON.stringify({ mode, runtime, node: process.version, platform: process.platform, report, checkpoint }, (_key, value) => typeof value === "bigint" ? Number(value) : value, 2));
}, 180000);
