import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

/** Run only against an upgraded disposable copy. Never performs a schema upgrade. */
async function main() {
  const database = process.argv[2];
  if (!database || !process.argv.includes("--disposable-copy")) throw new Error("Usage: benchmark-time-aggregation.ts <absolute database copy> --disposable-copy [--build]");
  process.env.DATABASE_URL = "file:" + resolve(database);
  process.env.MARKET_DATA_SYNC_ENABLED = "0";
  process.env.REPLAY_QUERY_METRICS = "1";
  const { prisma } = await import("../../lib/db");
  const { queueAggregation, processAggregationJob, AGGREGATION_BATCH_SIZE } = await import("../../lib/market-replay/aggregation-jobs");
  const { availableDisplaySessions } = await import("../../lib/market-replay/chart-sessions");
  const { GET } = await import("../../app/api/market-datasets/[id]/bars/window/route");
  const results: unknown[] = [];
  try {
    const datasets = await prisma.marketDataset.findMany({ where: { status: "READY" } });
    for (const dataset of datasets) {
      if (process.argv.includes("--build")) {
        const started = performance.now();
        const job = await queueAggregation(dataset.id);
        let batches = 0;
        const buildResult = await processAggregationJob(job.id, { afterBatch: async () => { if (++batches % 50 === 0) console.info(JSON.stringify({ datasetId: dataset.id, processed: Math.min(job.cursor + 1 + batches * AGGREGATION_BATCH_SIZE, dataset.barCount), total: dataset.barCount })); } });
        if (buildResult.status !== "COMPLETED") throw new Error("Aggregation did not complete: " + buildResult.status);
        console.info(JSON.stringify({ datasetId: dataset.id, buildMs: performance.now() - started }));
      }
      for (const scope of availableDisplaySessions(dataset.symbol)) for (const seconds of [3600, 14400, 21600, 28800, 86400, 3900]) {
        if (!dataset.sourceIntervalSeconds || seconds < dataset.sourceIntervalSeconds || seconds % dataset.sourceIntervalSeconds) continue;
        const times: number[] = [];
        let firstMs = 0, returnedBars = 0, sourceRowsRead = 0, summaryRowsRead = 0, queries = 0;
        for (let run = 0; run < 6; run++) {
          if (!run) await prisma.$disconnect();
          const query = new URLSearchParams({ displayIntervalSeconds: String(seconds), displaySession: scope, endSequence: String(dataset.barCount - 1), visibleCount: "500", warmupCount: "0" });
          const started = performance.now();
          const response = await GET(new Request(`http://localhost/api/window?${query}`), { params: Promise.resolve({ id: dataset.id }) });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error);
          const duration = performance.now() - started;
          returnedBars = body.visibleBars.length;
          sourceRowsRead = Number(response.headers.get("X-Replay-Source-Rows"));
          summaryRowsRead = Number(response.headers.get("X-Replay-Summary-Rows"));
          queries = Number(response.headers.get("X-Replay-Database-Queries"));
          if (!run) firstMs = duration; else times.push(duration);
        }
        times.sort((a, b) => a - b);
        const result = { datasetId: dataset.id, symbol: dataset.symbol, sourceSeconds: dataset.sourceIntervalSeconds, sourceRows: dataset.barCount, scope, displaySeconds: seconds, requestedBars: 500, returnedBars,
          sourceRowsRead, summaryRowsRead, queries, firstMs, medianMs: times[2], p95Ms: times[4] };
        results.push(result); console.info(JSON.stringify(result));
      }
    }
    const space = await prisma.$queryRawUnsafe(`SELECT name, SUM(pgsize) AS bytes FROM dbstat WHERE name IN ('MarketBar', 'MarketBar_datasetId_timestamp_key', 'MarketAggregationGeneration', 'MarketAggregatedBar', 'MarketAggregationJob') OR name LIKE 'sqlite_autoindex_MarketBar_%' OR name LIKE 'sqlite_autoindex_MarketAggregat%' OR name LIKE 'MarketAggregation%_idx' OR name LIKE 'MarketAggregation%_key' GROUP BY name`);
    await mkdir("tmp", { recursive: true });
    const output = `tmp/time-aggregation-benchmark-${process.env.SQLITE_DRIVER ?? "native"}.json`;
    await writeFile(output, JSON.stringify({ driver: process.env.SQLITE_DRIVER ?? "native", results, space }, (_key, value) => typeof value === "bigint" ? Number(value) : value, 2));
    console.info(`Saved ${output}`);
  } finally { await prisma.$disconnect(); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
