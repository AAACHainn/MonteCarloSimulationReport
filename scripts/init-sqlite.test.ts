import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

describe("SQLite initialization compatibility", () => {
  it("removes the obsolete ReplayProgress.intervalMs column without losing progress", async () => {
    const databaseFile = join(tmpdir(), `legacy-replay-${randomUUID()}.db`);
    const databaseUrl = `file:${databaseFile}`;
    const initialize = () => execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });

    try {
      initialize();
      const legacyClient = new PrismaClient({ datasourceUrl: databaseUrl });
      await legacyClient.marketDataset.create({ data: {
        id: "legacy-dataset", name: "Legacy", symbol: "TEST", timeframe: "1m", timezone: "UTC",
        sourceIntervalSeconds: 60, barCount: 2,
        startTime: new Date("2026-01-01T00:00:00Z"), endTime: new Date("2026-01-01T00:01:00Z"),
      } });
      await legacyClient.replayProgress.create({ data: {
        datasetId: "legacy-dataset", startSequence: 0, currentSequence: 1,
        playbackRate: 2, displayIntervalSeconds: 60, displaySession: "ETH",
      } });
      await legacyClient.$executeRawUnsafe(
        `ALTER TABLE "ReplayProgress" ADD COLUMN "intervalMs" INTEGER NOT NULL DEFAULT 1000`,
      );
      await legacyClient.$disconnect();

      initialize();
      const repairedClient = new PrismaClient({ datasourceUrl: databaseUrl });
      const columns = await repairedClient.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("ReplayProgress")`,
      );
      const progress = await repairedClient.replayProgress.findUniqueOrThrow({
        where: { datasetId: "legacy-dataset" },
      });
      await repairedClient.marketDataset.create({ data: {
        id: "new-dataset", name: "New", symbol: "TEST", timeframe: "1m", timezone: "UTC",
        sourceIntervalSeconds: 60, barCount: 2,
        startTime: new Date("2026-02-01T00:00:00Z"), endTime: new Date("2026-02-01T00:01:00Z"),
      } });
      const newProgress = await repairedClient.replayProgress.create({ data: {
        datasetId: "new-dataset", startSequence: 0, currentSequence: -1,
        playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH",
      } });
      expect(columns.map((column) => column.name)).not.toContain("intervalMs");
      expect(progress).toMatchObject({
        startSequence: 0,
        currentSequence: 1,
        playbackRate: 2,
        displayIntervalSeconds: 60,
        displaySession: "ETH",
      });
      expect(newProgress).toMatchObject({ datasetId: "new-dataset", currentSequence: -1 });
      await repairedClient.$disconnect();
    } finally {
      for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        rmSync(databaseFile + suffix, { force: true });
      }
    }
  }, 30_000);
});
