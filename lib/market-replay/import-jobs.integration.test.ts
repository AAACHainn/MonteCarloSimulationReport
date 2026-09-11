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
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ startSequence: 0, endSequence: 1, barCount: 2, volume: 943, volumeCount: 2 });
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
