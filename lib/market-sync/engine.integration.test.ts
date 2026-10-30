import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  return { prisma: new PrismaClient({ datasourceUrl: `file:${join(tmpdir(), "market-sync-" + randomUUID() + ".db")}` }), replayDatabaseQueryCount: () => null };
});
import { queueAggregation, processAggregationJob } from "@/lib/market-replay/aggregation-jobs";
import { prisma } from "@/lib/db";
import { configView, enqueueSync, saveConfig, saveConnection, getConnection } from "./service";
import { executeSyncRun } from "./engine";
import type { MarketProvider } from "./databento";
import { DatabentoProvider } from "./databento";
import { defaultSchedule, type SyncBar } from "./types";
import { syncReplayToTarget } from "@/lib/market-replay/replay-sync";
import { GET as chunksGET } from "@/app/api/market-datasets/[id]/bars/chunks/route";
import { acquireDatasetLease, releaseDatasetLease } from "./lease";
import { SyncError } from "./security";

let databaseFile = "";
beforeAll(async () => {
  const rows = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"); databaseFile = rows[0].file;
  execFileSync(process.execPath, ["scripts/database/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${databaseFile}` }, stdio: "pipe" });
  process.env.MARKET_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  await saveConnection({ apiKey: "mock-databento-api-key" });
  await prisma.marketDataConnection.update({ where: { id: "databento" }, data: { status: "CONNECTED" } });
});
afterAll(async () => { await prisma.$disconnect(); if (databaseFile.includes("market-sync-")) rmSync(databaseFile, { force: true }); });
const base = Date.UTC(2026, 8, 1);
const bar = (index: number): SyncBar => ({ timestamp: new Date(base + index * 60000), open: 100, high: 102, low: 99, close: 101, volume: 10, symbol: "ESU6" });
async function fixture(budget = 10) {
  const id = randomUUID();
  await prisma.marketDataset.create({ data: { id, name: "ES", symbol: "ES", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: 2, startTime: new Date(base), endTime: new Date(base + 60000) } });
  await prisma.marketBar.createMany({ data: [0, 1].map((i) => { const { symbol: _symbol, ...value } = bar(i); void _symbol; return { ...value, datasetId: id, sequence: i }; }) });
  await processAggregationJob((await queueAggregation(id)).id);
  await saveConfig(id, { mode: "MANUAL", profile: { root: "ES", interval: 60, contractMode: "CONTINUOUS", contract: "" }, schedule: defaultSchedule(), perRunBudget: budget, dailyBudget: budget });
  return id;
}
function provider(bars = [0, 1, 2, 3].map(bar), cost = 0): MarketProvider {
  return { range: async () => ({ start: new Date(base), end: new Date(base + 240000) }), conditions: async (start) => [{ date: start.toISOString().slice(0, 10), condition: "available" }], cost: async () => cost, bars: async function* (_p, start, end) { for (const value of bars) if (value.timestamp >= start && value.timestamp < end) yield value; } };
}
describe("persistent incremental market synchronization", () => {
  it("never exposes a saved credential", async () => { const view = await getConnection(); expect(JSON.stringify(view)).not.toContain("mock-databento-api-key"); expect(view.suffix).toBe("-key"); });
  it("defaults existing datasets to disabled and requires explicit opt in", async () => {
    const id = await fixture(); await prisma.marketDatasetSyncConfig.delete({ where: { datasetId: id } });
    expect((await configView(id)).mode).toBe("OFF"); await expect(enqueueSync(id)).rejects.toThrow();
    expect((await saveConfig(id, { mode: "OFF" })).mode).toBe("OFF");
  });
  it("coalesces triggers, appends without changing history or replay and completes no-new checks", async () => {
    const id = await fixture(); await prisma.replayProgress.create({ data: { datasetId: id, startSequence: 0, currentSequence: 0 } });
    const run = await enqueueSync(id); expect((await enqueueSync(id, "SCHEDULED")).id).toBe(run.id);
    await executeSyncRun(run.id, new AbortController().signal, provider());
    expect(await prisma.marketDataset.findUnique({ where: { id } })).toMatchObject({ barCount: 4, dataVersion: 2, historyVersion: 1 });
    expect((await prisma.replayProgress.findFirst({ where: { datasetId: id } }))?.currentSequence).toBe(0);
    const active = await prisma.marketDataset.findUniqueOrThrow({ where: { id } });
    expect(await prisma.marketAggregationGeneration.findUniqueOrThrow({ where: { id: active.activeAggregationId! } })).toMatchObject({ status: "READY", cursor: 3 });
    expect((await prisma.marketDatasetSyncConfig.findUnique({ where: { datasetId: id } }))?.checkedThrough).toEqual(new Date(base + 240000));
    const next = await enqueueSync(id); const noData = provider(); const fetchBars = vi.spyOn(noData, "bars");
    await executeSyncRun(next.id, new AbortController().signal, noData); expect(fetchBars).not.toHaveBeenCalled();
    expect((await prisma.marketDataSyncRun.findUnique({ where: { id: next.id } }))?.status).toBe("COMPLETED");
    const outcome = await syncReplayToTarget(id, { requestId: "new-client", generation: 1, syncVersion: 0, confirmedSequence: 0, targetSequence: 1, expectedPaperVersion: null, dataVersion: 1, historyVersion: 1 }); expect(outcome.status).toBe(200);
    const legacy = await syncReplayToTarget(id, { requestId: "old-client", generation: 1, syncVersion: 1, confirmedSequence: 1, targetSequence: 2, expectedPaperVersion: null, dataVersion: 1 }); expect(legacy.status).toBe(409);
    const context = { params: Promise.resolve({ id }) };
    expect((await chunksGET(new Request(`http://localhost/api/bars?version=1&historyVersion=1&startDate=2026-09-01`), context)).status).toBe(200);
    expect((await chunksGET(new Request(`http://localhost/api/bars?version=1&startDate=2026-09-01`), context)).status).toBe(409);
    await prisma.marketDataset.update({ where: { id }, data: { historyVersion: { increment: 1 }, dataVersion: { increment: 1 } } });
    expect((await chunksGET(new Request(`http://localhost/api/bars?version=1&historyVersion=1&startDate=2026-09-01`), context)).status).toBe(409);
    expect((await syncReplayToTarget(id, { requestId: "changed-history", generation: 1, syncVersion: 1, confirmedSequence: 1, targetSequence: 2, expectedPaperVersion: null, dataVersion: 2, historyVersion: 1 })).status).toBe(409);
    expect((await syncReplayToTarget(id, { requestId: "new-client", generation: 1, syncVersion: 0, confirmedSequence: 0, targetSequence: 1, expectedPaperVersion: null, dataVersion: 1, historyVersion: 1 })).status).toBe(200);
  });
  it("blocks paid downloads before fetching when budget is insufficient", async () => {
    const id = await fixture(0); const run = await enqueueSync(id); const source = provider(undefined, 0.01); const fetchBars = vi.spyOn(source, "bars");
    await executeSyncRun(run.id, new AbortController().signal, source); expect(fetchBars).not.toHaveBeenCalled();
    expect((await prisma.marketDataSyncRun.findUnique({ where: { id: run.id } }))?.status).toBe("BLOCKED");
    expect((await prisma.marketDataset.findUnique({ where: { id } }))?.barCount).toBe(2);
  });
  it("queries the account range before estimating or downloading and excludes unfinished bars", async () => {
    const id = await fixture(); const run = await enqueueSync(id); const source = provider([0, 1, 2, 3, 4].map(bar));
    const events: string[] = []; const cutoff = new Date(base + 240000);
    source.range = async () => { events.push("range"); return { start: new Date(base), end: new Date(cutoff.getTime() + 35000) }; };
    source.cost = async (_profile, _start, end) => { events.push("estimate"); expect(end).toEqual(cutoff); return 0; };
    source.bars = async function* (_profile, start, end) {
      events.push("download"); expect(end).toEqual(cutoff);
      for (const value of [0, 1, 2, 3, 4].map(bar)) if (value.timestamp >= start && value.timestamp < end) yield value;
    };
    await executeSyncRun(run.id, new AbortController().signal, source);
    expect(events).toEqual(["range", "estimate", "download"]);
    expect(await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "COMPLETED", requestEnd: cutoff, cursor: cutoff, addedBars: 2 });
    expect(await prisma.marketDatasetSyncConfig.findUniqueOrThrow({ where: { datasetId: id } })).toMatchObject({ availableThrough: cutoff, checkedThrough: cutoff });
    expect((await prisma.marketDataset.findUniqueOrThrow({ where: { id } })).endTime).toEqual(bar(3).timestamp);
  });
  it("does not estimate or download when the account range check fails", async () => {
    const id = await fixture(); const run = await enqueueSync(id); const source = provider();
    source.range = async () => { throw new SyncError("Range unavailable", 503, "HTTP"); };
    const estimate = vi.spyOn(source, "cost"); const download = vi.spyOn(source, "bars");
    await executeSyncRun(run.id, new AbortController().signal, source);
    expect(estimate).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
    expect(await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "FAILED", stage: "CHECKING", estimatedCost: 0, addedBars: 0 });
  });
  it("rechecks and caps an interrupted task's stale target when entitlements shrink", async () => {
    const id = await fixture(); const run = await enqueueSync(id);
    await prisma.marketDataSyncRun.update({ where: { id: run.id }, data: { status: "INTERRUPTED", requestStart: new Date(base), cursor: new Date(base), requestEnd: new Date(base + 360000) } });
    const source = provider([0, 1, 2, 3, 4, 5].map(bar)); const download = vi.spyOn(source, "bars");
    await executeSyncRun(run.id, new AbortController().signal, source);
    expect(download.mock.calls[0][2]).toEqual(new Date(base + 240000));
    expect(await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "COMPLETED", requestEnd: new Date(base + 240000), cursor: new Date(base + 240000), addedBars: 2 });
    // When the range expands again, the next check fills the remainder without gaps or duplicates.
    const next = await enqueueSync(id); source.range = async () => ({ start: new Date(base), end: new Date(base + 360000) });
    await executeSyncRun(next.id, new AbortController().signal, source);
    expect(await prisma.marketDataset.findUniqueOrThrow({ where: { id } })).toMatchObject({ barCount: 6, historyVersion: 1 });
    expect((await prisma.marketBar.findMany({ where: { datasetId: id }, orderBy: { sequence: "asc" } })).map((value) => value.timestamp)).toEqual([0, 1, 2, 3, 4, 5].map((i) => bar(i).timestamp));
  });
  it("preserves the cursor and avoids downloads when a resumed cursor is outside the current range", async () => {
    const id = await fixture(); const run = await enqueueSync(id); const cursor = new Date(base + 300000);
    await prisma.marketDataSyncRun.update({ where: { id: run.id }, data: { status: "INTERRUPTED", requestStart: new Date(base), cursor, requestEnd: new Date(base + 360000) } });
    const source = provider(); const estimate = vi.spyOn(source, "cost"); const download = vi.spyOn(source, "bars");
    await executeSyncRun(run.id, new AbortController().signal, source);
    expect(estimate).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
    expect(await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "BLOCKED", cursor, addedBars: 0 });
    expect((await prisma.marketDataset.findUniqueOrThrow({ where: { id } })).barCount).toBe(2);
  });
  it("finalizes after a crash following the last published segment without downloading it twice", async () => {
    const id = await fixture(); const run = await enqueueSync(id);
    await executeSyncRun(run.id, new AbortController().signal, provider());
    await prisma.marketDataSyncRun.update({ where: { id: run.id }, data: { status: "INTERRUPTED" } });
    const source = provider(); const download = vi.spyOn(source, "bars");
    await executeSyncRun(run.id, new AbortController().signal, source);
    expect(download).not.toHaveBeenCalled();
    expect(await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "COMPLETED", addedBars: 2 });
    expect((await prisma.marketDataset.findUniqueOrThrow({ where: { id } })).barCount).toBe(4);
  });
  it.each([false, true])("appends new UTC dates after the initial overlap verification (restart=%s)", async (restart) => {
    const id = await fixture(); const run = await enqueueSync(id);
    const values = [0, 1, 1440, 1441, 2880, 2881].map(bar);
    const source = provider(values);
    source.range = async () => ({ start: new Date(base), end: new Date(base + 2882 * 60000) });
    if (restart) {
      const controller = new AbortController(); const interrupted = { ...source };
      interrupted.conditions = async (start) => {
        if (start.getTime() > base) controller.abort();
        return [{ date: start.toISOString().slice(0, 10), condition: "available" }];
      };
      await executeSyncRun(run.id, controller.signal, interrupted);
      expect(await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "INTERRUPTED", cursor: new Date(base + 86400000), addedBars: 0 });
      expect(await prisma.marketDatasetSyncConfig.findUniqueOrThrow({ where: { datasetId: id } })).toMatchObject({ verified: true, checkedThrough: new Date(base + 86400000) });
    }
    await executeSyncRun(run.id, new AbortController().signal, source);
    expect(await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "COMPLETED", addedBars: 4, conflicts: "[]", cursor: new Date(base + 2882 * 60000) });
    expect(await prisma.marketDataset.findUniqueOrThrow({ where: { id } })).toMatchObject({ barCount: 6, historyVersion: 1 });
    const saved = await prisma.marketBar.findMany({ where: { datasetId: id }, orderBy: { sequence: "asc" } });
    expect(saved.map((value) => value.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(saved.map((value) => value.timestamp)).toEqual(values.map((value) => value.timestamp));
  });
  it("publishes the final partial UTC day without extending a metadata request beyond entitlements", async () => {
    const id = await fixture(); const run = await enqueueSync(id);
    const through = new Date(base + 1442 * 60000); const values = [0, 1, 1440, 1441].map(bar);
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], options?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const params = options?.body instanceof URLSearchParams ? options.body : url.searchParams;
      const method = url.pathname.split("/").at(-1);
      if (method === "metadata.get_dataset_range") return Response.json({ schema: { "ohlcv-1m": { start: new Date(base).toISOString(), end: through.toISOString() } } });
      if (method === "metadata.get_dataset_condition") return Response.json([{ date: params.get("start_date"), condition: "available" }]);
      if (method === "metadata.get_cost") return Response.json(0);
      if (method === "timeseries.get_range") {
        const from = new Date(params.get("start")!); const end = new Date(params.get("end")!);
        expect(end.getTime()).toBeLessThanOrEqual(through.getTime());
        return new Response("ts_event,rtype,instrument_id,open,high,low,close,volume\n" + values.filter((v) => v.timestamp >= from && v.timestamp < end).map((v) => `${v.timestamp.toISOString()},33,123,${v.open},${v.high},${v.low},${v.close},${v.volume}\n`).join(""));
      }
      if (method === "symbology.resolve") {
        const end = new Date(params.get("end_date")!);
        if (end > through) return Response.json({ detail: { case: "dataset_unavailable_range", payload: { available_end: through.toISOString() } } }, { status: 422 });
        const d1 = new Date(Math.ceil(end.getTime() / 86400000) * 86400000).toISOString().slice(0, 10);
        return Response.json({ result: { "123": [{ d0: params.get("start_date")!.slice(0, 10), d1, s: "ESU6" }] } });
      }
      throw new Error("Unexpected mock endpoint");
    });
    await executeSyncRun(run.id, new AbortController().signal, new DatabentoProvider("mock-key", fetcher));
    expect(await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "COMPLETED", addedBars: 2, cursor: through });
    expect(await prisma.marketDatasetSyncConfig.findUniqueOrThrow({ where: { datasetId: id } })).toMatchObject({ checkedThrough: through, availableThrough: through, pausedReason: null });
    expect(await prisma.marketDataset.findUniqueOrThrow({ where: { id } })).toMatchObject({ barCount: 4, endTime: new Date(through.getTime() - 60000), historyVersion: 1 });
  });
  it("preserves history and does not publish staged rows when an overlap changes", async () => {
    const id = await fixture(); const run = await enqueueSync(id); const revised = [bar(0), { ...bar(1), close: 100 }, bar(2)];
    await executeSyncRun(run.id, new AbortController().signal, provider(revised));
    expect((await prisma.marketDataSyncRun.findUnique({ where: { id: run.id } }))?.status).toBe("BLOCKED");
    expect((await prisma.marketDataset.findUnique({ where: { id } }))?.barCount).toBe(2);
    expect((await prisma.marketDatasetSyncConfig.findUnique({ where: { datasetId: id } }))?.pausedReason).toBeTruthy();
  });
  it("does not invent candles or flag normal empty intervals as timestamp gaps", async () => {
    const id = await fixture(); const run = await enqueueSync(id); await executeSyncRun(run.id, new AbortController().signal, provider([bar(0), bar(1), bar(3)]));
    expect((await prisma.marketDataset.findUnique({ where: { id } }))?.barCount).toBe(3);
    expect((await prisma.marketDataSyncRun.findUnique({ where: { id: run.id } }))?.status).toBe("COMPLETED");
  });
  it("retains interrupted charges and resumes without duplicate bars", async () => {
    const id = await fixture(); const run = await enqueueSync(id); const controller = new AbortController(); const source = provider();
    source.bars = async function* () { yield bar(0); controller.abort(); };
    await executeSyncRun(run.id, controller.signal, source);
    expect((await prisma.marketDataSyncRun.findUnique({ where: { id: run.id } }))?.status).toBe("INTERRUPTED");
    await executeSyncRun(run.id, new AbortController().signal, provider());
    expect((await prisma.marketDataset.findUnique({ where: { id } }))?.barCount).toBe(4);
  });
  it("shares the dataset lock with CSV import and other updates", async () => {
    const id = await fixture(); await acquireDatasetLease(prisma, id, "import_test");
    await expect(enqueueSync(id)).rejects.toThrow();
    await releaseDatasetLease(id, "import_test"); expect((await enqueueSync(id)).status).toBe("QUEUED");
  });
  it("accounts for failed billable downloads before reserving a retry", async () => {
    const id = await fixture(1); const run = await enqueueSync(id); const source = provider(undefined, 0.6);
    const downloads = vi.fn(); source.bars = async function* () { downloads(); throw new SyncError("test network failure", 502, "HTTP"); };
    await executeSyncRun(run.id, new AbortController().signal, source);
    const saved = await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("BLOCKED"); expect(saved.estimatedCost).toBe(0.6); expect(downloads).toHaveBeenCalledTimes(1);
    expect(JSON.parse(saved.charges)).toHaveLength(1);
  });
  it("enforces the shared daily budget across successive runs", async () => {
    const id = await fixture(1); await prisma.marketDatasetSyncConfig.update({ where: { datasetId: id }, data: { dailyBudget: 0.01 } });
    const first = await enqueueSync(id); await executeSyncRun(first.id, new AbortController().signal, provider(undefined, 0.008));
    const second = await enqueueSync(id); const source = provider([0, 1, 2, 3, 4].map(bar), 0.008); source.range = async () => ({ start: new Date(base), end: new Date(base + 300000) });
    const downloads = vi.spyOn(source, "bars"); await executeSyncRun(second.id, new AbortController().signal, source);
    expect(downloads).not.toHaveBeenCalled(); expect((await prisma.marketDataSyncRun.findUnique({ where: { id: second.id } }))?.status).toBe("BLOCKED");
  });
  it("does not advance the cursor when the provider marks a date pending", async () => {
    const id = await fixture(); const run = await enqueueSync(id); const source = provider(); source.conditions = async (start) => [{ date: start.toISOString().slice(0, 10), condition: "pending" }];
    const downloads = vi.spyOn(source, "bars"); await executeSyncRun(run.id, new AbortController().signal, source);
    expect(downloads).not.toHaveBeenCalled(); expect((await prisma.marketDatasetSyncConfig.findUnique({ where: { datasetId: id } }))?.checkedThrough).toBeNull();
  });
  it("persists licensing errors and logs structured diagnostics without advancing or publishing", async () => {
    const id = await fixture(); const run = await enqueueSync(id); const source = provider();
    source.bars = async function* () { throw new SyncError("License required (HTTP 422, dataset_unavailable_range)", 422, "AUTH", { method: "timeseries.get_range", case: "dataset_unavailable_range" }); };
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await executeSyncRun(run.id, new AbortController().signal, source);
      const saved = await prisma.marketDataSyncRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(saved).toMatchObject({ status: "BLOCKED", addedBars: 0, error: "License required (HTTP 422, dataset_unavailable_range)" });
      expect((await prisma.marketDatasetSyncConfig.findUniqueOrThrow({ where: { datasetId: id } })).checkedThrough).toBeNull();
      expect((await prisma.marketDataset.findUniqueOrThrow({ where: { id } })).barCount).toBe(2);
      const entry = JSON.parse(log.mock.calls.at(-1)![0]);
      expect(entry).toMatchObject({ event: "market-sync", errorCode: "AUTH", httpStatus: 422, providerMethod: "timeseries.get_range", providerCase: "dataset_unavailable_range" });
      expect(JSON.stringify(entry)).not.toContain("mock-databento-api-key");
    } finally { log.mockRestore(); }
  });
});
