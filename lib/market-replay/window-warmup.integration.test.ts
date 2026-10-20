import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  return { prisma: createDatabaseClient({ datasourceUrl: `file:${join(tmpdir(), "window-warmup-" + randomUUID() + ".db")}` }, { allowCreate: true }), replayDatabaseQueryCount: () => null };
});

import { prisma } from "@/lib/db";
import { GET } from "@/app/api/market-datasets/[id]/bars/window/route";
import { GET as exportGET } from "@/app/api/market-datasets/[id]/bars/export-window/route";
import { processAggregationJob, queueAggregation } from "./aggregation-jobs";
import { calculateLatestAbr } from "./abr";
import { calculateEmaSeries } from "./ema";
import { readCompleteWindow, WindowVersionChangedError } from "./export-window";
import * as windows from "./export-window";
import { WindowReadBudgetError, WindowSourceBudgetError } from "./aggregation-reader";
import { resolveDisplaySession } from "./chart-sessions";
import type { AggregatedMarketBarData } from "./types";

let databaseFile = "";
beforeAll(async () => {
  databaseFile = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${databaseFile}` }, stdio: "pipe" });
  await prisma.marketDataset.create({ data: { id: "warmup", name: "warmup", symbol: "TEST", timeframe: "1s", timezone: "UTC",
    sourceIntervalSeconds: 1, barEmissionMode: "DENSE", barCount: 100_000, startTime: new Date(0), endTime: new Date(99_999_000) } });
  for (let offset = 0; offset < 100_000; offset += 1000) {
    await prisma.marketBar.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({ datasetId: "warmup", sequence: offset + i,
      timestamp: new Date((offset + i) * 1000), open: 100, high: 101, low: 99, close: 100, volume: 1 })) });
  }
  await processAggregationJob((await queueAggregation("warmup")).id);
}, 60_000);
afterAll(async () => {
  await prisma.$disconnect();
  if (databaseFile.includes("window-warmup-")) rmSync(databaseFile, { force: true });
});

async function window(display: number, endSequence = 99_999) {
  const query = new URLSearchParams({ displayIntervalSeconds: String(display), displaySession: "ETH", endSequence: String(endSequence), visibleCount: "300", warmupCount: "1000" });
  return GET(new Request(`http://localhost/api/window?${query}`), { params: Promise.resolve({ id: "warmup" }) });
}

describe("complete indicator warmup across bounded pages (AR-01)", () => {
  it.each([60, 61])("fills 1000 warmup bars for %is without requiring a chart pan", async display => {
    const response = await window(display);
    expect(response.status).toBe(200);
    const data = await response.json() as { visibleBars: AggregatedMarketBarData[]; warmupBars: AggregatedMarketBarData[] };
    expect(data.visibleBars).toHaveLength(300);
    expect(data.warmupBars).toHaveLength(1000);
    expect(calculateLatestAbr(data.warmupBars, data.visibleBars, 1000)).toBe(2);
    const all = [...data.warmupBars, ...data.visibleBars];
    expect(calculateEmaSeries(all, 1000, all.length - 1).lastValue).toBeCloseTo(100, 10);
    expect(new Set(all.map(bar => bar.timestamp)).size).toBe(all.length);
    expect(all.every(bar => bar.lastSequence <= 99_999)).toBe(true);
  }, 30_000);

  it("returns genuinely short history and keeps the original reveal cutoff", async () => {
    const response = await window(61, 999);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.visibleBars).toHaveLength(17);
    expect(data.warmupBars).toHaveLength(0);
    expect(data.hasEarlierBars).toBe(false);
    expect(data.lastSourceBar.sequence).toBe(999);
    expect(data.visibleBars.at(-1).lastSequence).toBe(999);
    expect(calculateLatestAbr([], data.visibleBars, 1000)).toBeNull();
  });

  it("also completes exported indicator warmup without consuming the next source candle", async () => {
    const response = await exportGET(new Request("http://localhost/api/export-window?anchorSequence=70000&endSequence=99999&dataVersion=1&displayIntervalSeconds=61&displaySession=ETH&direction=forward&count=100&warmupCount=1000"),
      { params: Promise.resolve({ id: "warmup" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.bars).toHaveLength(100);
    expect(data.warmupBars).toHaveLength(1000);
    expect(data.warmupBars.at(-1).lastSequence).toBeLessThan(data.bars[0].firstSequence);
    expect(calculateLatestAbr(data.warmupBars, data.bars, 1000)).toBe(2);
  }, 30_000);

  it("rejects cumulative work exhaustion instead of returning a partial success", async () => {
    const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: "warmup" } });
    await expect(readCompleteWindow({ dataset, datasetId: dataset.id, anchorSequence: 99999, endSequence: 99999,
      direction: "backward", count: 1300, warmupCount: 0, sourceSeconds: 1, displaySeconds: 61,
      session: resolveDisplaySession(dataset, "ETH")!, budget: { rows: 1000, queries: 1000 } })).rejects.toBeInstanceOf(WindowReadBudgetError);
    const response = await window(61);
    expect(response.status).toBe(200); // A rejected read does not mutate progress or poison a later window.
  }, 30_000);

  it.each(["dataVersion", "historyVersion", "activeAggregationId", "barEmissionMode"] as const)("rejects a %s change across pages", async field => {
    const dataset = await prisma.marketDataset.findUniqueOrThrow({ where: { id: "warmup" } });
    const changed = { ...dataset, [field]: typeof dataset[field] === "number" ? Number(dataset[field]) + 1 : "changed" };
    const original = prisma.marketDataset.findUnique;
    const read = vi.spyOn(prisma.marketDataset, "findUnique").mockResolvedValueOnce(changed);
    try {
      await expect(readCompleteWindow({ dataset, datasetId: dataset.id, anchorSequence: 99999, endSequence: 99999,
        direction: "backward", count: 500, warmupCount: 0, sourceSeconds: 1, displaySeconds: 61,
        session: resolveDisplaySession(dataset, "ETH")! })).rejects.toBeInstanceOf(WindowVersionChangedError);
    } finally {
      read.mockRestore();
      // Prisma delegates are proxies: restore the resolved method, not an absent own property.
      prisma.marketDataset.findUnique = original;
    }
  }, 30_000);

  it.each([
    [new WindowReadBudgetError(), 422, "WINDOW_BUDGET"],
    [new WindowSourceBudgetError(), 422, "WINDOW_BUDGET"],
    [new WindowVersionChangedError(), 409, "WINDOW_VERSION_CHANGED"],
  ] as const)("reports incomplete reads explicitly (%s)", async (error, status, code) => {
    const read = vi.spyOn(windows, "readCompleteWindow").mockRejectedValueOnce(error);
    try {
      const response = await window(61);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code, error: expect.any(String) });
    } finally { read.mockRestore(); }
  });
});
