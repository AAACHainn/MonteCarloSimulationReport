import { prisma } from "@/lib/db";
import { MARKET_BAR_BLOCK_SIZE, MARKET_BAR_BLOCK_SIZES } from "./types";

const builds = new Map<string, Promise<void>>();
const RAW_BARS_PER_BUILD_BATCH = 16_384;
const MIN_BACKGROUND_BLOCK_BUILD_BARS = 250_000;

export async function buildMarketBarBlocks(
  datasetId: string,
  barCount: number,
  blockSizes: readonly number[] = [MARKET_BAR_BLOCK_SIZE],
  maxBatchesPerSize = Number.POSITIVE_INFINITY,
) {
  if (!barCount) return;
  for (const blockSize of blockSizes) {
    const rawBarsPerBatch = Math.min(RAW_BARS_PER_BUILD_BATCH, blockSize * 16);
    const state = await prisma.marketBarBlockBuildState.findUnique({
      where: { datasetId_blockSize: { datasetId, blockSize } },
      select: { cursor: true },
    });
    const legacy = blockSize === MARKET_BAR_BLOCK_SIZE
      ? await prisma.marketDataset.findUnique({ where: { id: datasetId }, select: { barBlockBuildCursor: true } })
      : null;
    const cursor = Math.max(state?.cursor ?? -1, legacy?.barBlockBuildCursor ?? -1);
    if (cursor >= barCount - 1) continue;
    let start = Math.floor((cursor + 1) / blockSize) * blockSize;
    let completedBatches = 0;
    while (start < barCount) {
      const bars = await prisma.marketBar.findMany({
        where: { datasetId, sequence: { gte: start } },
        orderBy: { sequence: "asc" },
        take: rawBarsPerBatch + 1,
      });
      if (!bars.length) {
        await persistBuildBatch(datasetId, blockSize, barCount - 1, []);
        break;
      }
      const hasMore = bars.length > rawBarsPerBatch;
      const selectedBars = hasMore ? bars.slice(0, rawBarsPerBatch) : bars;
      const lastBlockStart = Math.floor(selectedBars.at(-1)!.sequence / blockSize) * blockSize;
      const completedBars = hasMore
        ? selectedBars.filter((bar) => bar.sequence < lastBlockStart)
        : selectedBars;
      const groups = new Map<number, typeof completedBars>();
      for (const bar of completedBars) {
        const groupStart = Math.floor(bar.sequence / blockSize) * blockSize;
        const group = groups.get(groupStart);
        if (group) group.push(bar);
        else groups.set(groupStart, [bar]);
      }
      const blocks = [...groups.values()].map((group) => {
        const volumes = group.flatMap((bar) => bar.volume === null ? [] : [bar.volume]);
        return {
          datasetId,
          blockSize,
          startSequence: group[0].sequence,
          endSequence: group.at(-1)!.sequence,
          startTime: group[0].timestamp,
          endTime: group.at(-1)!.timestamp,
          open: group[0].open,
          high: Math.max(...group.map((bar) => bar.high)),
          low: Math.min(...group.map((bar) => bar.low)),
          close: group.at(-1)!.close,
          volume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) : null,
          volumeCount: volumes.length,
          barCount: group.length,
        };
      });
      const nextCursor = hasMore ? lastBlockStart - 1 : barCount - 1;
      await persistBuildBatch(datasetId, blockSize, nextCursor, blocks);
      completedBatches += 1;
      if (!hasMore) break;
      if (completedBatches >= maxBatchesPerSize) break;
      start = lastBlockStart;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
}

async function persistBuildBatch(
  datasetId: string,
  blockSize: number,
  cursor: number,
  blocks: Array<{
    datasetId: string;
    blockSize: number;
    startSequence: number;
    endSequence: number;
    startTime: Date;
    endTime: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
    volumeCount: number;
    barCount: number;
  }>,
) {
  await prisma.$transaction(async (transaction) => {
    if (blocks.length) {
      await transaction.marketBarBlock.deleteMany({
        where: {
          datasetId,
          blockSize,
          startSequence: { in: blocks.map((block) => block.startSequence) },
        },
      });
      await transaction.marketBarBlock.createMany({ data: blocks });
    }
    await transaction.marketBarBlockBuildState.upsert({
      where: { datasetId_blockSize: { datasetId, blockSize } },
      create: { datasetId, blockSize, cursor },
      update: { cursor },
    });
    if (blockSize === MARKET_BAR_BLOCK_SIZE) {
      await transaction.marketDataset.update({ where: { id: datasetId }, data: { barBlockBuildCursor: cursor } });
    }
  });
}

/** Start resumable legacy backfill without putting the full scan on the window request path. */
export function scheduleMarketBarBlockBuild(
  datasetId: string,
  barCount: number,
  blockSizes: readonly number[] = MARKET_BAR_BLOCK_SIZES,
) {
  // Small legacy datasets are faster to scan directly and should not contend with replay writes in SQLite.
  if (barCount < MIN_BACKGROUND_BLOCK_BUILD_BARS) return Promise.resolve();
  const requestedBlockSizes = [...new Set(blockSizes)].sort((left, right) => left - right);
  const buildKey = `${datasetId}:${requestedBlockSizes.join(",")}`;
  const active = builds.get(buildKey);
  if (active) return active;
  const operation = new Promise<void>((resolve) => setTimeout(resolve, 0))
    // A window read may nudge a legacy backfill forward, but it must never
    // start a sustained million-row scan that competes with replay writes.
    .then(() => buildMarketBarBlocks(datasetId, barCount, requestedBlockSizes, 1))
    .finally(() => {
      if (builds.get(buildKey) === operation) builds.delete(buildKey);
    });
  builds.set(buildKey, operation);
  return operation;
}
