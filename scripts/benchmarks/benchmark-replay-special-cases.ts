import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
const audit = vi.hoisted(() => ({ queries: 0, marketRows: 0 }));
vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("../../lib/sqlite-client.mjs");
  const { randomUUID } = await import("node:crypto");
  const { join } = await import("node:path"); const { tmpdir } = await import("node:os");
  const db = createDatabaseClient({ datasourceUrl: "file:" + join(tmpdir(), "sqlite-wal-benchmark-" + randomUUID() + ".db"), log: [{ emit: "event", level: "query" }] }, { allowCreate: true });
  (db as unknown as { $on(event: "query", callback: () => void): void }).$on("query", () => audit.queries++);
  const client = db.$extends({ query: { marketBar: { async findMany({ args, query }) { const rows = await query(args); audit.marketRows += rows.length; return rows; } } } });
  return { prisma: client, replayDatabaseQueryCount: () => audit.queries };
});
import { prisma } from "@/lib/db";
import { createReplaySession } from "@/lib/replay-sessions/service";
import { POST as accountPOST } from "@/app/api/market-datasets/[id]/paper-session/route";
import { POST as advancePOST } from "@/app/api/market-datasets/[id]/replay/advance/route";
import { POST as syncPOST } from "@/app/api/market-datasets/[id]/replay/sync/route";
import { aggregateMarketBars, mergeSourceBarInto } from "@/lib/market-replay/aggregation";
import { calculateLatestAbr } from "@/lib/market-replay/abr";
import { appendContextRun, type ReplayContextRun } from "@/lib/replay-sessions/context-runs";
import * as limits from "@/lib/market-replay/types";
import type { MarketBarData } from "@/lib/market-replay/types";

let file = "";
const base = Date.parse("2021-09-13T20:15:00Z");
const sessionConfig = { mode: "TWENTY_FOUR_SEVEN" as const, timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1,2,3,4,5,6,7] };
const sources: MarketBarData[] = Array.from({ length: 6000 }, (_, sequence) => ({ sequence, timestamp: new Date(base + sequence * 1000).toISOString(), open: 100, high: 101 + sequence % 7 / 10, low: 99, close: 100, volume: null }));
function req(session: { id: string; activeProjectionId: string | null }, body: unknown) {
  return new Request("http://localhost/api/test?replaySessionId=" + session.id, { method: "POST", headers: { "Content-Type": "application/json", "X-Replay-Projection": session.activeProjectionId! }, body: JSON.stringify(body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
beforeAll(async () => {
  file = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/database/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: "file:" + file }, stdio: "pipe" });
  for (const [id, symbol, count, seconds] of [["special-rth", "ES", 90000, 60], ["special-high", "TEST", sources.length, 1]] as const) {
    await prisma.marketDataset.create({ data: { id, name: id, symbol, timeframe: seconds === 60 ? "1m" : "1s", sourceIntervalSeconds: seconds, timezone: "UTC", barCount: count, startTime: new Date(base), endTime: new Date(base + (count - 1) * seconds * 1000) } });
    for (let from = 0; from < count; from += 1000) await prisma.marketBar.createMany({ data: Array.from({ length: Math.min(1000, count - from) }, (_, offset) => ({ datasetId: id, ...(id === "special-high" ? { ...sources[from + offset], timestamp: new Date(sources[from + offset].timestamp) } : { sequence: from + offset, timestamp: new Date(base + (from + offset) * seconds * 1000), open: 100, high: 101, low: 99, close: 100 }) })) });
  }
}, 120000);
afterAll(async () => { await prisma.$disconnect(); if (file.includes("sqlite-wal-benchmark-")) rmSync(file, { force: true }); });
function percentile(values: number[], ratio: number) { return Math.round([...values].sort((a,b) => a-b)[Math.min(values.length - 1, Math.floor(values.length * ratio))] * 10) / 10; }
it("measures special replay waits with the real application driver and isolated market data", async () => {
  const runtime = { version: (await prisma.$queryRawUnsafe<Array<{ version: string }>>("SELECT sqlite_version() AS version"))[0].version, mode: (await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode"))[0].journal_mode };
  expect(runtime).toEqual({ version: "3.51.3", mode: "wal" });
  const bulk = Number((limits as unknown as Record<string, unknown>).MAX_REPLAY_BULK_SOURCE_BARS ?? 100);
  const report = [];
  for (const scenario of ["rth-gap", "1s-to-5m"] as const) {
    const samples = []; const queryCounts = []; const requestCounts = []; const rowsRead = [];
    for (let sample = 0; sample < 5; sample++) {
      const datasetId = scenario === "rth-gap" ? "special-rth" : "special-high";
      const from = scenario === "rth-gap" ? 0 : 2400;
      const session = await createReplaySession(datasetId, { name: scenario + sample, mode: "TRAINING", timestamp: new Date(base + from * 1000).toISOString(), displayIntervalSeconds: 300, displaySession: scenario === "rth-gap" ? "RTH" : "ETH", playbackRate: 100 });
      const account = await accountPOST(req(session, { initialCapital: 100000, currency: "USD", commissionBps: 0, slippageBps: 0 }), ctx(datasetId));
      expect(account.status).toBe(201);
      let snapshot = (await account.json()).snapshot; let requests = 0;
      const rowStart = audit.marketRows; const queryStart = audit.queries; const started = performance.now();
      {
        if (scenario === "rth-gap") {
          const response = await advancePOST(req(session, { requestId: "gap-" + sample, expectedCurrentSequence: -1, expectedVersion: snapshot.session.version, count: 1, displayIntervalSeconds: 300, displaySession: "RTH" }), ctx(datasetId)); requests++;
          expect(response.status).toBe(200); const result = await response.json(); expect(result.currentSequence).toBe(1039);
        } else {
          const progress = await prisma.replayProgress.findFirstOrThrow({ where: { replaySessionId: session.id } });
          let sequence = progress.currentSequence; let syncVersion = progress.syncVersion;
          const bars = aggregateMarketBars({ bars: sources.slice(0, from), sourceSeconds: 1, displaySeconds: 300, session: sessionConfig, currentSequence: from - 1, finalSequence: sources.length - 1 });
          while (sequence < from + 299) {
            const next = sources.slice(sequence + 1, Math.min(from + 300, sequence + 1 + bulk)); const runs: ReplayContextRun[] = [];
            for (const source of next) {
              const abrValue = calculateLatestAbr([], bars, 8);
              mergeSourceBarInto(bars, source, { sourceSeconds: 1, displaySeconds: 300, session: sessionConfig, finalSequence: sources.length - 1 });
              appendContextRun(runs, source.sequence, { abrValue, abrLength: 8, displayIntervalSeconds: 300, displaySession: "ETH", displayUtcOffsetMinutes: 0, priceTickSize: 0.01 }, progress.generation);
            }
            const response = await syncPOST(req(session, { requestId: "step-" + sample + "-" + sequence, generation: progress.generation, confirmedSequence: sequence, syncVersion, dataVersion: 1, historyVersion: 1, expectedPaperVersion: snapshot.session.version, targetSequence: next.at(-1)!.sequence, contextRuns: runs, ...(bulk > 100 ? { batchMode: "BULK" } : {}) }), ctx(datasetId)); requests++;
            expect(response.status, await response.clone().text()).toBe(200); const result = await response.json(); sequence = result.currentSequence; syncVersion = result.syncVersion; snapshot = result.snapshot;
          }
          expect(sequence).toBe(from + 299);
        }
      }
      samples.push(performance.now() - started); queryCounts.push(audit.queries - queryStart); requestCounts.push(requests); rowsRead.push(audit.marketRows - rowStart);
    }
    report.push({ scenario, medianMs: percentile(samples,.5), p95Ms: percentile(samples,.95), samples, queryCounts, requestCounts, marketRowsRead: rowsRead });
  }
  const label = process.env.REPLAY_SPECIAL_BENCHMARK_LABEL ?? "current";
  if (!/^[a-z0-9-]+$/.test(label)) throw Error("Invalid report label");
  mkdirSync("tmp", { recursive: true });
  writeFileSync("tmp/replay-special-benchmark-" + label + ".json", JSON.stringify({ runtime, bulk, report }, null, 2));
  console.log(JSON.stringify({ runtime, bulk, report }, null, 2));
}, 180000);
