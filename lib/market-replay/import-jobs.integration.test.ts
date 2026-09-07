import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
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
  timeframe: "1m",
  timezone: "UTC",
  sourceIntervalSeconds: 60,
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
        metadata: JSON.stringify(metadata),
      },
    });

    await processImportJob(jobId);

    const job = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: jobId } });
    const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: job.datasetId! } });
    const bars = await prisma.marketBar.findMany({ where: { datasetId: dataset.id }, orderBy: { sequence: "asc" } });
    const blocks = await prisma.marketBarBlock.findMany({ where: { datasetId: dataset.id } });

    expect(job).toMatchObject({ status: "COMPLETED", processedRows: 4, importedBars: 2 });
    expect(dataset).toMatchObject({ symbol: "ES", barCount: 2 });
    expect(bars.map((bar) => ({ sequence: bar.sequence, close: bar.close, volume: bar.volume }))).toEqual([
      { sequence: 0, close: 4538.25, volume: null },
      { sequence: 1, close: 4538, volume: null },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ startSequence: 0, endSequence: 1, barCount: 2, volume: null, volumeCount: 0 });
  });
});
