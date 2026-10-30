import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import type { MarketBar } from "@prisma/client";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { randomUUID } = await import("node:crypto");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  return { prisma: new PrismaClient({ datasourceUrl: `file:${join(tmpdir(), `replay-scale-${randomUUID()}.db`)}` }), replayDatabaseQueryCount: () => null };
});
import { prisma } from "@/lib/db";
import { createReplaySession } from "./service";
import { loadReplayScope } from "./scope";
import { createCorrection, readCorrection, cancelCorrection } from "./corrections";
import { runReplayCorrection } from "./correction-runner";
import { POST as accountPOST } from "@/app/api/market-datasets/[id]/paper-session/route";

let databaseFile = "";
const origin = Date.UTC(2026, 0, 1);
const sourceCount = 20_000_000;
beforeAll(async () => {
  databaseFile = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/database/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${databaseFile}` }, stdio: "pipe" });
  await prisma.marketDataset.create({ data: { id: "virtual", name: "20M logical source", symbol: "TEST", timeframe: "1s", timezone: "UTC", sourceIntervalSeconds: 1,
    barCount: sourceCount, startTime: new Date(origin), endTime: new Date(origin + (sourceCount - 1) * 1000) } });
  await prisma.marketBar.create({ data: { datasetId: "virtual", sequence: 0, timestamp: new Date(origin), open: 100, high: 101, low: 99, close: 100 } });
}, 30_000);
afterAll(async () => { await prisma.$disconnect(); if (databaseFile.includes("replay-scale-")) rmSync(databaseFile, { force: true }); });

// Explicitly opt in: the user excluded large-scale performance work from this delivery.
const performanceTest = process.env.REPLAY_SCALE_TEST === "1" ? it : it.skip;
performanceTest("reconstructs twenty million logical source bars with bounded reads and heap", async () => {
  const session = await createReplaySession("virtual", { name: "scale", mode: "LIVE_REPLAY", timestamp: new Date(origin).toISOString(), playbackRate: 1, displayIntervalSeconds: 1, displaySession: "ETH" });
  const opened = await accountPOST(new Request(`http://localhost/api/account?replaySessionId=${session.id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Replay-Projection": session.activeProjectionId },
    body: JSON.stringify({ initialCapital: 10_000, currency: "USD", commissionBps: 0, slippageBps: 0 }) }), { params: Promise.resolve({ id: "virtual" }) });
  expect(opened.status).toBe(201);
  await prisma.replayProgress.update({ where: { replaySessionId: session.id }, data: { currentSequence: sourceCount - 1 } });
  await prisma.replayProjection.update({ where: { id: session.activeProjectionId }, data: { currentSequence: sourceCount - 1 } });
  await prisma.paperTradingSession.update({ where: { projectionId: session.activeProjectionId }, data: { lastProcessedSequence: sourceCount - 1, version: sourceCount + 1 } });
  await prisma.replayContextRun.create({ data: { projectionId: session.activeProjectionId, fromSequence: 0, toSequence: sourceCount - 1, context: JSON.stringify({ generation: 1, context: null }) } });
  const job = await createCorrection(session.id, { requestId: "twenty-million", type: "REWIND", targetSequence: sourceCount - 2, expectedVersion: (await loadReplayScope(session.id)).version });
  const bar = (sequence: number): MarketBar => ({ datasetId: "virtual", sequence, timestamp: new Date(origin + sequence * 1000), open: 100, high: 101, low: 99, close: 100, volume: null });
  let largestRead = 0; let reads = 0; let peakHeap = process.memoryUsage().heapUsed;
  const actualFindMany = prisma.marketBar.findMany.bind(prisma.marketBar);
  const actualFindUnique = prisma.marketBar.findUnique.bind(prisma.marketBar);
  prisma.marketBar.findMany = ((args) => {
    if (args?.where?.datasetId !== "virtual") return actualFindMany(args);
    const range = args.where.sequence as { gt: number; lte: number };
    const count = range.lte - range.gt;
    largestRead = Math.max(largestRead, count); reads += 1; peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    if (reads % 1000 === 0) process.stdout.write(JSON.stringify({ event: "replay-scale-progress", through: range.lte, maxRead: largestRead, heapMB: Math.round(peakHeap / 1048576) }) + "\n");
    return Promise.resolve(Array.from({ length: count }, (_, offset) => bar(range.gt + offset + 1))) as ReturnType<typeof prisma.marketBar.findMany>;
  }) as typeof prisma.marketBar.findMany;
  prisma.marketBar.findUnique = ((args) => {
    const key = args.where.datasetId_sequence;
    if (key?.datasetId !== "virtual") return actualFindUnique(args);
    return Promise.resolve(bar(key.sequence)) as ReturnType<typeof prisma.marketBar.findUnique>;
  }) as typeof prisma.marketBar.findUnique;
  try {
    await runReplayCorrection(job.id);
    const completed = await readCorrection(session.id, job.id);
    expect(completed.error).toBeNull(); expect(completed.status).toBe("READY");
    expect(completed.processedSourceBars).toBe(sourceCount - 1);
    expect(largestRead).toBeLessThanOrEqual(4096);
    expect(reads).toBe(Math.ceil((sourceCount - 1) / 4096));
    expect(peakHeap).toBeLessThan(512 * 1048576);
    const result = await prisma.paperTradingSession.findUniqueOrThrow({ where: { projectionId: completed.targetProjectionId! } });
    expect(result).toMatchObject({ lastProcessedSequence: sourceCount - 2, version: sourceCount, realizedPnl: 0, netQuantity: 0, maxDrawdown: 0, peakEquity: 10_000 });
    expect(await prisma.paperEquityPoint.count({ where: { sessionId: result.id } })).toBeLessThanOrEqual(20_001);
    expect((await loadReplayScope(session.id)).projectionId).toBe(session.activeProjectionId);
    process.stdout.write(JSON.stringify({ event: "replay-scale-complete", processed: completed.processedSourceBars, reads, maxRead: largestRead, peakHeapMB: Math.round(peakHeap / 1048576) }) + "\n");
    await cancelCorrection(session.id, job.id);
  } finally { prisma.marketBar.findMany = actualFindMany; prisma.marketBar.findUnique = actualFindUnique; }
}, 600_000);
