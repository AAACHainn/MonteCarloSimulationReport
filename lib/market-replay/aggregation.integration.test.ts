import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("./aggregation-worker", () => ({ startAggregationWorker: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path"); const { randomUUID } = await import("node:crypto");
  return { prisma: createDatabaseClient({ datasourceUrl: `file:${join(tmpdir(), "aggregation-integration-" + randomUUID() + ".db")}` }, { allowCreate: true }), replayDatabaseQueryCount: () => null };
});
import { prisma } from "@/lib/db";
import { aggregateMarketBars } from "./aggregation";
import { resolveDisplaySession } from "./chart-sessions";
import { serializeSourceBar } from "./dataset";
import { readExportWindow } from "./export-window";
import { queueAggregation, processAggregationJob, cancelAggregation, aggregationStatus } from "./aggregation-jobs";
import { AggregationNotReadyError } from "./aggregation-storage";
import { acquireDatasetLease, assertDatasetIdle, releaseDatasetLease } from "@/lib/market-sync/lease";
import { POST as aggregationPOST, GET as aggregationGET } from "@/app/api/market-datasets/[id]/aggregation/route";
import { GET as windowGET } from "@/app/api/market-datasets/[id]/bars/window/route";

let file = "";
beforeAll(async () => {
  file = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${file}` }, stdio: "pipe" });
}, 30000);
afterAll(async () => { await prisma.$disconnect(); if (file.includes("aggregation-integration-")) rmSync(file, { force: true }); });
async function seed(id: string, source: number, count: number) {
  const start = Date.parse("2026-10-19T22:00:00Z");
  const dataset = await prisma.marketDataset.create({ data: { id, name: id, symbol: "ES", timeframe: `${source}s`, timezone: "UTC", sourceIntervalSeconds: source, barCount: count, startTime: new Date(start), endTime: new Date(start + (count - 1) * source * 1000) } });
  for (let cursor = 0; cursor < count; cursor += 1000) await prisma.marketBar.createMany({ data: Array.from({ length: Math.min(1000, count - cursor) }, (_, i) => {
    const sequence = cursor + i; const price = 100 + Math.sin(sequence / 31);
    return { datasetId: id, sequence, timestamp: new Date(start + sequence * source * 1000), open: price, high: price + 2, low: price - 1, close: price + 1, volume: sequence % 3 ? 1 : null };
  }) });
  return dataset;
}
describe("time aggregation lifecycle and indexed readers", () => {
  it("requires a generation for aggregated reads, while raw source reads stay available", async () => {
    const dataset = await seed("pending", 60, 100);
    const options = { dataset, datasetId: dataset.id, anchorSequence: 99, endSequence: 99, direction: "backward" as const, count: 10, warmupCount: 0, sourceSeconds: 60, displaySeconds: 300, session: resolveDisplaySession(dataset, "ETH")! };
    await expect(readExportWindow(options)).rejects.toBeInstanceOf(AggregationNotReadyError);
    expect((await readExportWindow({ ...options, displaySeconds: 60 })).bars).toHaveLength(10);
    const blocked = await windowGET(new Request("http://localhost/api/window?displayIntervalSeconds=300&displaySession=ETH&endSequence=99&visibleCount=10&warmupCount=0"), { params: Promise.resolve({ id: dataset.id }) });
    expect(blocked.status).toBe(409); expect((await blocked.json()).code).toBe("AGGREGATION_NOT_READY");
  });
  it("exposes idempotent build, status, cancellation and resume APIs", async () => {
    const dataset = await seed("api", 60, 100);
    const context = { params: Promise.resolve({ id: dataset.id }) };
    const post = (body: unknown) => aggregationPOST(new Request("http://localhost/api/aggregation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), context);
    const [first, concurrent] = await Promise.all([post({ action: "rebuild" }), post({ action: "rebuild" })]); expect(first.status).toBe(202); expect(concurrent.status).toBe(202);
    const queued = await first.json();
    expect((await concurrent.json()).job.id).toBe(queued.job.id);
    expect((await (await post({ action: "rebuild" })).json()).job.id).toBe(queued.job.id);
    expect((await post({ action: "cancel" })).status).toBe(202);
    await processAggregationJob(queued.job.id);
    expect((await (await aggregationGET(new Request("http://localhost/api/aggregation"), context)).json()).job.status).toBe("CANCELLED");
    expect((await post({ action: "resume", jobId: queued.job.id })).status).toBe(202);
    await processAggregationJob(queued.job.id);
    expect((await (await aggregationGET(new Request("http://localhost/api/aggregation"), context)).json()).ready).toBe(true);
    expect((await post({ action: "resume" })).status).toBe(400);
  });
  it.each([1, 60])("matches raw aggregation for custom periods and revealed cutoffs (source=%s)", async (source) => {
    const dataset = await seed(`custom-${source}`, source, source === 1 ? 16000 : 3000);
    const job = await queueAggregation(dataset.id); await processAggregationJob(job.id);
    const current = await prisma.marketDataset.findUniqueOrThrow({ where: { id: dataset.id } });
    const rows = await prisma.marketBar.findMany({ where: { datasetId: dataset.id }, orderBy: { sequence: "asc" } });
    for (const display of source === 1 ? [7, 61, 60, 420, 2700, 3900, 5400, 7200, 10800, 14400, 21600, 43200, 86400] : [420, 2700, 3900, 5400, 7200, 10800, 14400, 21600, 43200, 86400]) {
      for (const scope of ["ETH", "RTH"] as const) {
        const session = resolveDisplaySession(current, scope)!;
        const endSequence = rows.length - 137;
        const expected = aggregateMarketBars({ bars: rows.slice(0, endSequence + 1).map(serializeSourceBar), sourceSeconds: source, displaySeconds: display, session, currentSequence: endSequence, finalSequence: rows.length - 1 }).slice(-8);
        const result = await readExportWindow({ dataset: current, datasetId: dataset.id, anchorSequence: endSequence, endSequence, finalSequence: rows.length - 1, direction: "backward", count: 8, warmupCount: 0, sourceSeconds: source, displaySeconds: display, session });
        expect(result.bars, `${scope}:${display}`).toEqual(expected);
        expect(result.bars.every((bar) => bar.lastSequence <= endSequence)).toBe(true);
      }
    }
    expect(await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE name IN ('MarketBarBlock', 'MarketBarBlockBuildState')")).toEqual([]);
  }, 60000);
  it("reduces a custom-period page under the source budget without losing buckets between pages", async () => {
    const dataset = await seed("budget", 1, 35000);
    await processAggregationJob((await queueAggregation(dataset.id)).id);
    const current = await prisma.marketDataset.findUniqueOrThrow({ where: { id: dataset.id } });
    const options = { dataset: current, datasetId: dataset.id, anchorSequence: 34999, endSequence: 34999, finalSequence: 34999, direction: "backward" as const, count: 500, warmupCount: 0, sourceSeconds: 1, displaySeconds: 61, session: resolveDisplaySession(current, "ETH")! };
    const latest = await readExportWindow(options);
    expect(latest.bars.length).toBeLessThan(500); expect(latest.bars.length).toBeGreaterThan(0);
    const earlier = await readExportWindow({ ...options, anchorSequence: latest.previousSequence!, endSequence: latest.previousSequence!, count: 500 - latest.bars.length });
    const rows = await prisma.marketBar.findMany({ where: { datasetId: dataset.id }, orderBy: { sequence: "asc" } });
    const expected = aggregateMarketBars({ bars: rows.map(serializeSourceBar), sourceSeconds: 1, displaySeconds: 61, session: options.session, currentSequence: 34999, finalSequence: 34999 }).slice(-500);
    expect([...earlier.bars, ...latest.bars]).toEqual(expected);
  }, 30000);
  it("checkpoints failed builds, resumes, cancels and atomically retains the previous active generation", async () => {
    const dataset = await seed("resume", 1, 8500);
    const initial = await queueAggregation(dataset.id); await processAggregationJob(initial.id);
    const active = (await aggregationStatus(dataset.id)).generationId;
    const inFlightDataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: dataset.id } });
    const rebuild = await queueAggregation(dataset.id);
    expect((await queueAggregation(dataset.id)).id).toBe(rebuild.id);
    await expect(acquireDatasetLease(prisma, dataset.id, "import_other")).rejects.toThrow();
    await expect(processAggregationJob(rebuild.id, { afterBatch: async () => { throw new Error("simulated crash"); } })).rejects.toThrow("simulated crash");
    expect((await aggregationStatus(dataset.id))).toMatchObject({ ready: true, generationId: active, job: { status: "FAILED", processed: 4096 } });
    await queueAggregation(dataset.id, rebuild.id); await processAggregationJob(rebuild.id);
    expect((await aggregationStatus(dataset.id))).toMatchObject({ ready: true, generationId: rebuild.generationId, job: { status: "COMPLETED", processed: 8500 } });
    expect((await readExportWindow({ dataset: inFlightDataset, datasetId: dataset.id, anchorSequence: 8499, endSequence: 8499, direction: "backward", count: 5, warmupCount: 0, sourceSeconds: 1, displaySeconds: 900, session: resolveDisplaySession(dataset, "ETH")! })).bars).toHaveLength(5);
    const cancelled = await queueAggregation(dataset.id); await cancelAggregation(dataset.id); await processAggregationJob(cancelled.id);
    expect((await aggregationStatus(dataset.id))).toMatchObject({ generationId: rebuild.generationId, job: { status: "CANCELLED" } });
    await prisma.marketDataset.update({ where: { id: dataset.id }, data: { historyVersion: { increment: 1 } } });
    await expect(queueAggregation(dataset.id, cancelled.id)).rejects.toThrow();
  }, 30000);
  it("releases expired job reservations and never releases a newer owner's lease", async () => {
    const dataset = await seed("expired", 60, 50);
    const job = await queueAggregation(dataset.id);
    const staleOwner = `aggregation_${job.id}_stale`;
    await prisma.marketAggregationJob.update({ where: { id: job.id }, data: { status: "RUNNING", workerToken: "stale", leaseUntil: new Date(0) } });
    await prisma.marketDatasetUpdateLease.create({ data: { datasetId: dataset.id, owner: staleOwner, expiresAt: new Date(0) } });
    await assertDatasetIdle(dataset.id);
    expect((await aggregationStatus(dataset.id)).job?.status).toBe("INTERRUPTED");
    await acquireDatasetLease(prisma, dataset.id, "metadata_new");
    await releaseDatasetLease(dataset.id, staleOwner);
    expect((await prisma.marketDatasetUpdateLease.findUniqueOrThrow({ where: { datasetId: dataset.id } })).owner).toBe("metadata_new");
    await releaseDatasetLease(dataset.id, "metadata_new");
    await queueAggregation(dataset.id, job.id); await processAggregationJob(job.id);
    expect((await aggregationStatus(dataset.id)).ready).toBe(true);
  });
  it("uses explicit index range searches in every raw and summary branch", async () => {
    const raw = await prisma.$queryRawUnsafe<Array<{ detail: string }>>(`EXPLAIN QUERY PLAN SELECT * FROM "MarketBar" INDEXED BY "MarketBar_datasetId_timestamp_key" WHERE "datasetId" = ? AND "timestamp" >= ? AND "timestamp" < ? UNION ALL SELECT * FROM "MarketBar" INDEXED BY "MarketBar_datasetId_timestamp_key" WHERE "datasetId" = ? AND "timestamp" >= ? AND "timestamp" < ?`, "custom-60", 0, 100, "custom-60", 200, 300);
    expect(raw.filter((row) => row.detail.includes("SEARCH")).every((row) => row.detail.includes("timestamp>?") && row.detail.includes("timestamp<?"))).toBe(true);
    const summary = await prisma.$queryRawUnsafe<Array<{ detail: string }>>(`EXPLAIN QUERY PLAN SELECT * FROM "MarketAggregatedBar" WHERE "generationId" = ? AND "scope" = ? AND "intervalSeconds" = ? AND "bucketStart" >= ? AND "bucketStart" < ?`, "g", "ETH", 3600, 0, 100);
    expect(summary.some((row) => row.detail.includes("SEARCH") && row.detail.includes("bucketStart>?") && row.detail.includes("bucketStart<?"))).toBe(true);
  });
  it("keeps fixed-window reads unchanged when later source history grows", async () => {
    await processAggregationJob((await queueAggregation("pending")).id);
    let dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: "pending" } });
    const beforeMetrics = { sourceRows: 0, summaryRows: 0 }, afterMetrics = { sourceRows: 0, summaryRows: 0 };
    const options = { datasetId: dataset.id, anchorSequence: 98, endSequence: 98, direction: "backward" as const, count: 3, warmupCount: 0, sourceSeconds: 60, displaySeconds: 3600, session: resolveDisplaySession(dataset, "ETH")! };
    const before = await readExportWindow({ ...options, dataset, finalSequence: dataset.barCount - 1, metrics: beforeMetrics });
    await prisma.marketBar.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({ datasetId: dataset.id, sequence: i + 100, timestamp: new Date(dataset.startTime.getTime() + (i + 100) * 60000), open: 999999, high: 999999, low: 999999, close: 999999 })) });
    await prisma.marketDataset.update({ where: { id: dataset.id }, data: { barCount: 1100, endTime: new Date(dataset.startTime.getTime() + 1099 * 60000), dataVersion: { increment: 1 } } });
    await processAggregationJob((await queueAggregation(dataset.id)).id);
    dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: dataset.id } });
    const after = await readExportWindow({ ...options, dataset, finalSequence: dataset.barCount - 1, metrics: afterMetrics });
    expect(after.bars).toEqual(before.bars); expect(afterMetrics).toEqual(beforeMetrics);
  });
});
