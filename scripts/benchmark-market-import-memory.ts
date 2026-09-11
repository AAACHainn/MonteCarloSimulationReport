import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  const requestedRows = Number.parseInt(process.argv[2] ?? "1000000", 10);
  if (!Number.isInteger(requestedRows) || requestedRows < 2) {
    throw new Error("Row count must be an integer greater than one.");
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "market-import-memory-"));
  const databasePath = join(temporaryRoot, "benchmark.db");
  const csvPath = join(temporaryRoot, "benchmark.csv");
  process.env.DATABASE_URL = `file:${databasePath.replaceAll("\\", "/")}`;

  try {
    execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    });

    const writer = createWriteStream(csvPath);
    writer.write("timestamp,open,high,low,close,volume\n");
    const firstTimestamp = Date.UTC(2020, 0, 1);
    for (let index = 0; index < requestedRows; index += 1) {
      const timestamp = new Date(firstTimestamp + index * 60_000).toISOString();
      if (!writer.write(`${timestamp},100,101,99,100,1\n`)) await once(writer, "drain");
    }
    writer.end();
    await once(writer, "finish");

    const [{ prisma }, { processImportJob }] = await Promise.all([
      import("../lib/db"),
      import("../lib/market-replay/import-jobs"),
    ]);
    const jobId = randomUUID();
    const file = await stat(csvPath);
    await prisma.marketDatasetImport.create({ data: {
      id: jobId,
      status: "UPLOADED",
      fileName: "benchmark.csv",
      storedPath: csvPath,
      compressedBytes: file.size,
      metadata: JSON.stringify({
        name: "Memory benchmark",
        description: null,
        symbol: "TEST",
        timeframe: "1m",
        timezone: "UTC",
        sourceIntervalSeconds: 60,
        priceTickSize: 0.01,
        sessionMode: "TWENTY_FOUR_SEVEN",
        sessionOpenMinute: null,
        sessionCloseMinute: null,
        tradingWeekdays: [1, 2, 3, 4, 5, 6, 7],
      }),
    } });

    const startedAt = Date.now();
    await processImportJob(jobId);
    const job = await prisma.marketDatasetImport.findUniqueOrThrow({ where: { id: jobId } });
    console.log(JSON.stringify({
      rows: requestedRows,
      importedBars: job.importedBars,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
      peakRssMiB: Math.round(Number(job.peakWorkerRssBytes) / 1024 / 1024 * 10) / 10,
      status: job.status,
    }));
    await prisma.$disconnect();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

void main();
