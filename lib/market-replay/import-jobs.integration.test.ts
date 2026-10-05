import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { tmpdir: getTmpdir } = await import("node:os");
  const { join: joinPath } = await import("node:path");
  const { randomUUID: uuid } = await import("node:crypto");
  return {
    prisma: new PrismaClient({ datasourceUrl: `file:${joinPath(getTmpdir(), "market-import-" + uuid() + ".db")}` }),
    replayDatabaseQueryCount: () => null,
  };
});

import { prisma } from "@/lib/db";
import { processImportJob } from "./import-jobs";
import { DELETE as cancelImportJob } from "@/app/api/market-dataset-imports/[jobId]/route";

vi.setConfig({ testTimeout: 30_000 });

let databaseFile = "";
const temporaryFiles = new Set<string>();

beforeAll(async () => {
  const files = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list");
  databaseFile = files[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], {
    env: { ...process.env, DATABASE_URL: `file:${databaseFile}` },
    stdio: "pipe",
  });
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  for (const file of temporaryFiles) rmSync(file, { force: true });
  if (databaseFile.includes("market-import-")) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(databaseFile + suffix, { force: true });
  }
});

const metadata = {
  name: "ES lead contract",
  description: null,
  symbol: "ES",
  timeframe: "auto",
  timezone: "UTC",
  sourceIntervalSeconds: null,
  priceTickSize: 0.25,
  sessionMode: "TWENTY_FOUR_SEVEN",
  sessionOpenMinute: null,
  sessionCloseMinute: null,
  tradingWeekdays: [1, 2, 3, 4, 5, 6, 7],
};

const csv = [
  "ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume,symbol",
  "2021-09-07T00:00:00.000000000Z,33,1,1030,4539.25,4539.25,4538,4538.25,576,ESU1",
  "2021-09-07T00:00:00.000000000Z,33,1,8858,4529.5,4529.5,4528.25,4528.5,20,ESZ1",
  "2021-09-07T00:01:00.000000000Z,33,1,1030,4538.25,4538.25,4537.5,4538,367,ESU1",
  "2021-09-07T00:01:00.000000000Z,33,1,8858,4528.25,4528.25,4528,4528,3,ESZ1",
].join("\n");

describe("market dataset streaming import", () => {
  it.each([
    ["CSV", false],
    ["CSV.GZ", true],
  ])("imports only dense lead-contract bars from %s while counting every source row", async (_label, compressed) => {
    const jobId = randomUUID();
    const path = join(tmpdir(), `${jobId}.${compressed ? "csv.gz" : "csv"}`);
    temporaryFiles.add(path);
    writeFileSync(path, compressed ? gzipSync(csv) : csv);
    await prisma.marketDatasetImport.create({
      data: {
        id: jobId,
        status: "UPLOADED",
        fileName: compressed ? "es.csv.gz" : "es.csv",
        storedPath: path,
        compressedBytes: statSync(path).size,
        metadata: JSON.stringify(metadata),
      },
    });

    await processImportJob(jobId);

    const job = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: jobId } });
    const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: job.datasetId! } });
    const bars = await prisma.marketBar.findMany({ where: { datasetId: dataset.id }, orderBy: { sequence: "asc" } });
    const blocks = await prisma.marketBarBlock.findMany({ where: { datasetId: dataset.id } });

    expect(job).toMatchObject({
      status: "COMPLETED", stage: "COMPLETED", processedRows: 4, totalRows: 4,
      importedBars: 2, workerPid: null,
    });
    expect(job.stageProcessedBytes).toBe(job.stageTotalBytes);
    expect(Number(job.peakWorkerRssBytes)).toBeGreaterThan(0);
    expect(dataset).toMatchObject({
      symbol: "ES", timeframe: "1m", sourceIntervalSeconds: 60, barCount: 2, barBlockBuildCursor: 1,
    });
    expect(bars.map((bar) => ({ sequence: bar.sequence, close: bar.close, volume: bar.volume }))).toEqual([
      { sequence: 0, close: 4538.25, volume: 576 },
      { sequence: 1, close: 4538, volume: 367 },
    ]);
    expect(blocks).toHaveLength(3);
    expect(blocks).toEqual(expect.arrayContaining([64, 512, 4_096].map((blockSize) => expect.objectContaining({
      blockSize, startSequence: 0, endSequence: 1, barCount: 2, volume: 943, volumeCount: 2,
    }))));
  });

  it("infers an ordinary CSV's source interval from its timestamp cadence", async () => {
    const jobId = randomUUID();
    const path = join(tmpdir(), `${jobId}.csv`);
    temporaryFiles.add(path);
    writeFileSync(path, [
      "timestamp,open,high,low,close,volume",
      "2026-01-01T00:00:00Z,10,12,9,11,100",
      "2026-01-01T00:05:00Z,11,13,10,12,200",
      "2026-01-01T00:10:00Z,12,14,11,13,300",
    ].join("\n"));
    await prisma.marketDatasetImport.create({
      data: {
        id: jobId, status: "UPLOADED", fileName: "ordinary.csv", storedPath: path,
        compressedBytes: statSync(path).size,
        metadata: JSON.stringify({ ...metadata, name: "Ordinary", symbol: "TEST" }),
      },
    });

    await processImportJob(jobId);

    const job = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: jobId } });
    const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: job.datasetId! } });
    expect(job).toMatchObject({ status: "COMPLETED", processedRows: 3, importedBars: 3 });
    expect(dataset).toMatchObject({ timeframe: "5m", sourceIntervalSeconds: 300, barCount: 3 });
  });

  it("imports MGC outright delivery months and rolls by the prior UTC day's volume", async () => {
    const jobId = randomUUID();
    const path = join(tmpdir(), `${jobId}.csv`);
    temporaryFiles.add(path);
    writeFileSync(path, [
      "ts_event,rtype,open,high,low,close,volume,symbol",
      "2021-09-10T00:00:00Z,33,1780,1781,1779,1780,100,MGCV1",
      "2021-09-10T00:00:00Z,33,1790,1791,1789,1790,20,MGCZ1",
      "2021-09-10T00:00:00Z,33,-2,-2,-2,-2,999,MGCV1-MGCZ1",
      "2021-09-12T22:00:00Z,33,1781,1782,1780,1781,10,MGCV1",
      "2021-09-12T22:00:00Z,33,1791,1792,1790,1791,200,MGCZ1",
      "2021-09-13T00:00:00Z,33,1782,1783,1781,1782,1,MGCV1",
      "2021-09-13T00:00:00Z,33,1792,1793,1791,1792,250,MGCZ1",
    ].join("\n"));
    await prisma.marketDatasetImport.create({
      data: {
        id: jobId, status: "UPLOADED", fileName: "mgc.csv", storedPath: path,
        compressedBytes: statSync(path).size,
        metadata: JSON.stringify({ ...metadata, name: "MGC lead", symbol: "MGC", priceTickSize: 0.1 }),
      },
    });

    await processImportJob(jobId);

    const job = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: jobId } });
    const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: job.datasetId! } });
    const bars = await prisma.marketBar.findMany({ where: { datasetId: dataset.id }, orderBy: { sequence: "asc" } });
    expect(job).toMatchObject({ status: "COMPLETED", processedRows: 7, importedBars: 3 });
    expect(dataset).toMatchObject({ symbol: "MGC", timeframe: "1m", sourceIntervalSeconds: 60, barCount: 3 });
    expect(bars.map((bar) => ({ close: bar.close, volume: bar.volume }))).toEqual([
      { close: 1780, volume: 100 },
      { close: 1781, volume: 10 },
      { close: 1792, volume: 250 },
    ]);
  });

  it("removes an interrupted task's partial dataset before retrying from the beginning", async () => {
    const jobId = randomUUID();
    const path = join(tmpdir(), `${jobId}.csv`);
    temporaryFiles.add(path);
    writeFileSync(path, [
      "timestamp,open,high,low,close,volume",
      "2026-01-01T00:00:00Z,10,12,9,11,100",
      "2026-01-01T00:05:00Z,11,13,10,12,200",
      "2026-01-01T00:10:00Z,12,14,11,13,300",
    ].join("\n"));
    const partial = await prisma.marketDataset.create({ data: {
      name: "partial", symbol: "TEST", timeframe: "5m", timezone: "UTC", status: "IMPORTING",
      sourceIntervalSeconds: 300, priceTickSize: 0.25, sessionMode: "TWENTY_FOUR_SEVEN",
      tradingWeekdays: "1,2,3,4,5,6,7", barCount: 0, startTime: new Date(0), endTime: new Date(0),
    } });
    await prisma.marketBar.create({ data: {
      datasetId: partial.id, sequence: 0, timestamp: new Date("2025-01-01T00:00:00Z"),
      open: 1, high: 1, low: 1, close: 1,
    } });
    await prisma.marketDatasetImport.create({ data: {
      id: jobId, datasetId: partial.id, status: "INTERRUPTED", stage: "IMPORTING",
      fileName: "retry.csv", storedPath: path, compressedBytes: statSync(path).size,
      metadata: JSON.stringify({ ...metadata, name: "retried", symbol: "TEST" }),
    } });

    await processImportJob(jobId);

    const job = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "COMPLETED", stage: "COMPLETED", totalRows: 3, importedBars: 3 });
    expect(job.datasetId).not.toBe(partial.id);
    await expect(prisma.marketDataset.findUnique({ where: { id: partial.id } })).resolves.toBeNull();
    await expect(prisma.marketBar.count({ where: { datasetId: partial.id } })).resolves.toBe(0);
  });
});

const appendBaseTime = Date.UTC(2026, 8, 10, 23, 0);
const standardHeader = "timestamp,open,high,low,close,volume,symbol";
function standardRow(index: number, symbol = "MGC") {
  return [new Date(appendBaseTime + index * 60_000).toISOString(), 10, 12, 9, 11, 5, symbol].join(",");
}
async function makeImportJob(text: string, options: Record<string, unknown>, compressed = false) {
  const id = randomUUID(); const path = join(tmpdir(), id + (compressed ? ".csv.gz" : ".csv"));
  temporaryFiles.add(path);
  writeFileSync(path, compressed ? gzipSync(text) : text);
  return prisma.marketDatasetImport.create({ data: {
    id, status: "UPLOADED", fileName: compressed ? "append.csv.gz" : "append.csv", storedPath: path,
    compressedBytes: statSync(path).size, metadata: JSON.stringify(options),
  } });
}
async function makeAppendTarget(count = 63) {
  const job = await makeImportJob([standardHeader, ...Array.from({ length: count }, (_, i) => standardRow(i))].join("\n"),
    { ...metadata, name: "MGC append", symbol: "MGC", sourceIntervalSeconds: 60 });
  await processImportJob(job.id);
  const imported = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: job.id } });
  return prisma.marketDataset.findUniqueOrThrow({ where: { id: imported.datasetId! } });
}
function appendMetadata(target: Awaited<ReturnType<typeof makeAppendTarget>>) {
  return { ...target, tradingWeekdays: target.tradingWeekdays.split(",").map(Number), mode: "APPEND", targetDatasetId: target.id };
}
async function confirmAppend(jobId: string) {
  const job = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: jobId } });
  await prisma.marketDatasetImport.update({ where: { id: jobId }, data: {
    status: "QUEUED", stage: "FINALIZING", metadata: JSON.stringify({ ...JSON.parse(job.metadata), confirmed: true }),
  } });
  await processImportJob(jobId);
}

describe("market dataset append import", () => {
  it.each([false, true])("trims overlap, deduplicates new bars and preserves replay and account state (gzip=%s)", async (compressed) => {
    const target = await makeAppendTarget();
    const progress = await prisma.replayProgress.create({ data: { datasetId: target.id, startSequence: 5, currentSequence: 42, playbackRate: 7, generation: 3 } });
    const account = await prisma.paperTradingSession.create({ data: { datasetId: target.id, initialCapital: 1000, currency: "USD", peakEquity: 1030, realizedPnl: 30, netQuantity: 2, lastProcessedSequence: 42 } });
    const oldBars = await prisma.marketBar.findMany({ where: { datasetId: target.id }, orderBy: { sequence: "asc" } });
    const job = await makeImportJob([standardHeader, standardRow(61), standardRow(62), standardRow(63), standardRow(63), standardRow(64)].join("\n"), appendMetadata(target), compressed);
    await processImportJob(job.id);
    const result = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: job.id } });
    expect(result).toMatchObject({ status: "COMPLETED", datasetId: target.id, importedBars: 2, totalRows: 5 });
    expect(JSON.parse(result.metadata).preview).toMatchObject({ overlappingRows: 2, duplicateRows: 1, gapCount: 0 });
    const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: target.id } });
    expect(dataset).toMatchObject({ barCount: 65, dataVersion: target.dataVersion + 1, startTime: target.startTime, endTime: new Date(appendBaseTime + 64 * 60_000), barBlockBuildCursor: 64 });
    const bars = await prisma.marketBar.findMany({ where: { datasetId: target.id }, orderBy: { sequence: "asc" } });
    expect(bars.slice(0, 63)).toEqual(oldBars);
    expect(bars.map((bar) => bar.sequence)).toEqual(Array.from({ length: 65 }, (_, i) => i));
    expect(await prisma.replayProgress.findUnique({ where: { datasetId: target.id } })).toEqual(progress);
    expect(await prisma.paperTradingSession.findUnique({ where: { datasetId: target.id } })).toEqual(account);
    const blocks = await prisma.marketBarBlock.findMany({ where: { datasetId: target.id } });
    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockSize: 64, startSequence: 0, endSequence: 63, barCount: 64, volume: 320 }),
      expect.objectContaining({ blockSize: 64, startSequence: 64, endSequence: 64, barCount: 1, volume: 5 }),
      expect.objectContaining({ blockSize: 512, startSequence: 0, endSequence: 64, barCount: 65, volume: 325 }),
    ]));
    expect(await prisma.marketDataset.count({ where: { status: "IMPORTING" } })).toBe(0);
  });

  it("deduplicates repeated chunks and rebuilds every partial block across 4,096 bars", async () => {
    const target = await makeAppendTarget(4095);
    const lines = Array.from({ length: 1002 }, (_, i) => standardRow(4095 + i));
    const job = await makeImportJob([standardHeader, ...lines, ...lines.slice(0, 1000)].join("\n"), appendMetadata(target));
    await processImportJob(job.id);
    const result = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: job.id } });
    expect(result).toMatchObject({ status: "COMPLETED", importedBars: 1002 });
    expect(JSON.parse(result.metadata).preview.duplicateRows).toBe(1000);
    const blocks = await prisma.marketBarBlock.findMany({ where: { datasetId: target.id, blockSize: 4096 }, orderBy: { startSequence: "asc" } });
    expect(blocks).toMatchObject([{ startSequence: 0, endSequence: 4095, barCount: 4096, volume: 20480 }, { startSequence: 4096, endSequence: 5096, barCount: 1001, volume: 5005 }]);
    expect(await prisma.marketBarBlockBuildState.findMany({ where: { datasetId: target.id } })).toEqual(expect.arrayContaining([64, 512, 4096].map((blockSize) => expect.objectContaining({ blockSize, cursor: 5096 }))));
  });

  it("stages boundary and internal gaps until the user confirms", async () => {
    const target = await makeAppendTarget(2);
    const job = await makeImportJob([standardHeader, standardRow(4), standardRow(6)].join("\n"), appendMetadata(target));
    await processImportJob(job.id);
    const waiting = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: job.id } });
    expect(waiting).toMatchObject({ status: "AWAITING_CONFIRMATION", stage: "AWAITING_CONFIRMATION", importedBars: 2, workerPid: null });
    expect(JSON.parse(waiting.metadata).preview).toMatchObject({ gapCount: 2, missingBars: 3, gaps: [expect.objectContaining({ missingBars: 2 }), expect.objectContaining({ missingBars: 1 })] });
    expect(await prisma.marketDataset.findUnique({ where: { id: target.id } })).toEqual(target);
    expect(await prisma.marketBar.count({ where: { datasetId: target.id } })).toBe(2);
    await confirmAppend(job.id);
    expect(await prisma.marketDataset.findUnique({ where: { id: target.id } })).toMatchObject({ barCount: 4, endTime: new Date(appendBaseTime + 6 * 60_000) });
    expect((await prisma.marketBar.findMany({ where: { datasetId: target.id }, orderBy: { sequence: "asc" } })).map((bar) => bar.timestamp.getTime())).toEqual([0, 1, 4, 6].map((i) => appendBaseTime + i * 60_000));
  });

  it("accepts one new bar and treats an all-overlap file as an unchanged success", async () => {
    const target = await makeAppendTarget(2);
    const same = await makeImportJob([standardHeader, standardRow(0), standardRow(1)].join("\n"), appendMetadata(target));
    await processImportJob(same.id);
    expect(await prisma.marketDataset.findUnique({ where: { id: target.id } })).toEqual(target);
    expect(await prisma.marketDatasetImport.findUnique({ where: { id: same.id } })).toMatchObject({ status: "COMPLETED", importedBars: 0 });
    const single = await makeImportJob([standardHeader, standardRow(2)].join("\n"), appendMetadata(target));
    await processImportJob(single.id);
    expect(await prisma.marketDataset.findUnique({ where: { id: target.id } })).toMatchObject({ barCount: 3 });
  });

  it.each([
    ["wrong standard symbol", [standardHeader, standardRow(2, "ES")].join("\n")],
    ["misaligned timestamp", [standardHeader, standardRow(2).replace("23:02:00", "23:02:30")].join("\n")],
    ["wrong Databento root", ["ts_event,rtype,open,high,low,close,volume,symbol", "2026-09-10T23:02:00Z,33,10,12,9,11,5,ESZ6"].join("\n")],
    ["wrong Databento period", ["ts_event,rtype,open,high,low,close,volume,symbol", "2026-09-11T00:00:00Z,34,10,12,9,11,5,MGCZ6"].join("\n")],
  ])("rejects %s without changing the target", async (_label, csvText) => {
    const target = await makeAppendTarget(2);
    const job = await makeImportJob(csvText, appendMetadata(target));
    await expect(processImportJob(job.id)).rejects.toThrow();
    expect(await prisma.marketDataset.findUnique({ where: { id: target.id } })).toEqual(target);
    expect(await prisma.marketDatasetImport.findUnique({ where: { id: job.id } })).toMatchObject({ status: "FAILED", datasetId: null });
  });

  it("cancels a pending gap confirmation without touching existing data", async () => {
    const target = await makeAppendTarget(2);
    const job = await makeImportJob([standardHeader, standardRow(4)].join("\n"), appendMetadata(target));
    await processImportJob(job.id);
    const waiting = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: job.id } });
    const response = await cancelImportJob(new Request("http://localhost/imports/" + job.id, { method: "DELETE" }), { params: Promise.resolve({ jobId: job.id }) });
    expect(response.status).toBe(200);
    expect(await prisma.marketDatasetImport.findUnique({ where: { id: job.id } })).toBeNull();
    expect(await prisma.marketDataset.findUnique({ where: { id: waiting.datasetId! } })).toBeNull();
    expect(await prisma.marketDataset.findUnique({ where: { id: target.id } })).toEqual(target);
  });

  it("rolls back a late validation failure and retries cleanly from the file", async () => {
    const target = await makeAppendTarget(2);
    const lines = Array.from({ length: 1001 }, (_, i) => standardRow(i + 2));
    const job = await makeImportJob([standardHeader, ...lines.slice(0, -1), lines.at(-1)!.replace(",10,12,9,11,", ",10,8,9,11,")].join("\n"), appendMetadata(target));
    await expect(processImportJob(job.id)).rejects.toThrow();
    expect(await prisma.marketDataset.findUnique({ where: { id: target.id } })).toEqual(target);
    expect(await prisma.marketBar.count({ where: { datasetId: target.id } })).toBe(2);
    expect(await prisma.marketDataset.count({ where: { status: "IMPORTING" } })).toBe(0);
    writeFileSync(job.storedPath!, [standardHeader, ...lines].join("\n"));
    await processImportJob(job.id);
    expect(await prisma.marketDataset.findUnique({ where: { id: target.id } })).toMatchObject({ barCount: 1003 });
  });

  it("rejects a stale confirmation after another append and allows a fresh retry", async () => {
    const target = await makeAppendTarget(2);
    const job = await makeImportJob([standardHeader, standardRow(4)].join("\n"), appendMetadata(target));
    await processImportJob(job.id);
    const concurrent = await makeImportJob([standardHeader, standardRow(2), standardRow(3)].join("\n"), appendMetadata(target));
    await processImportJob(concurrent.id);
    await expect(confirmAppend(job.id)).rejects.toThrow("目标数据集已变更");
    expect(await prisma.marketDataset.findUnique({ where: { id: target.id } })).toMatchObject({ barCount: 4 });
    await processImportJob(job.id);
    expect(await prisma.marketDataset.findUnique({ where: { id: target.id } })).toMatchObject({ barCount: 5 });
    expect(await prisma.marketDataset.count({ where: { status: "IMPORTING" } })).toBe(0);
  });
});
