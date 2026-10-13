import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const executed = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  return { prisma: new PrismaClient({ datasourceUrl: `file:${join(tmpdir(), "market-runtime-" + randomUUID() + ".db")}` }) };
});
vi.mock("./engine", () => ({ executeSyncRun: async (id: string) => {
  executed(id); const { prisma } = await import("@/lib/db"); const run = await prisma.marketDataSyncRun.update({ where: { id }, data: { status: "COMPLETED" } });
  await prisma.marketDatasetUpdateLease.deleteMany({ where: { datasetId: run.datasetId, owner: id } });
} }));
import { prisma } from "@/lib/db";
import { startMarketSyncRuntime } from "./runtime";
import { defaultSchedule } from "./types";
let databaseFile = "";
beforeAll(async () => {
  const rows = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"); databaseFile = rows[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${databaseFile}` }, stdio: "pipe" });
});
afterAll(async () => {
  const globals = globalThis as unknown as { marketSyncRuntime?: { stop: () => void } }; globals.marketSyncRuntime?.stop(); delete globals.marketSyncRuntime;
  vi.unstubAllEnvs(); await prisma.$disconnect(); if (databaseFile.includes("market-runtime-")) rmSync(databaseFile, { force: true });
});
describe("application lifecycle scheduler", () => {
  it("does not run during build or tests", () => { expect(startMarketSyncRuntime()).toBeUndefined(); vi.stubEnv("VITEST", ""); vi.stubEnv("NEXT_PHASE", "phase-production-build"); expect(startMarketSyncRuntime()).toBeUndefined(); });
  it("coalesces missed automatic plans and leaves disabled/manual datasets alone", async () => {
    vi.stubEnv("VITEST", ""); vi.stubEnv("NEXT_PHASE", "phase-production-server"); vi.stubEnv("MARKET_DATA_SYNC_ENABLED", "1");
    for (const mode of ["OFF", "MANUAL", "AUTO"]) {
      await prisma.marketDataset.create({ data: { id: mode, name: mode, symbol: "ES", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: 1, startTime: new Date(0), endTime: new Date(0) } });
      await prisma.marketDatasetSyncConfig.create({ data: { datasetId: mode, mode, profile: JSON.stringify({ root: "ES", interval: 60, contractMode: "CONTINUOUS", contract: "" }), schedule: JSON.stringify({ ...defaultSchedule(), unit: "MINUTE", anchor: new Date(Date.now() - 86400000).toISOString() }), perRunBudget: 0, dailyBudget: 0, nextRunAt: new Date(Date.now() - 3600000) } });
    }
    const runtime = startMarketSyncRuntime(); expect(runtime).toBeDefined();
    await vi.waitFor(() => expect(executed).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect((await prisma.marketDataSyncRun.findFirst())?.status).toBe("COMPLETED"));
    await runtime!.tick();
    expect(await prisma.marketDataSyncRun.count()).toBe(1);
    const run = await prisma.marketDataSyncRun.findFirst(); expect(run?.datasetId).toBe("AUTO");
    expect((await prisma.marketDatasetSyncConfig.findUniqueOrThrow({ where: { datasetId: "AUTO" } })).nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    runtime!.stop(); await runtime!.tick(); expect(executed).toHaveBeenCalledTimes(1);
  });
});
