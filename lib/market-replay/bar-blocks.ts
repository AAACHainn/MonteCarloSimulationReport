import { prisma } from "@/lib/db";
import { MARKET_BAR_BLOCK_SIZE } from "./types";

const builds = new Map<string, Promise<void>>();

export async function buildMarketBarBlocks(datasetId: string, barCount: number) {
  if (!barCount) return;
  const dataset = await prisma.marketDataset.findUnique({
    where: { id: datasetId },
    select: { barBlockBuildCursor: true },
  });
  if (!dataset || dataset.barBlockBuildCursor >= barCount - 1) return;
  const firstMissing = dataset.barBlockBuildCursor + 1;
  const initialStart = Math.floor(firstMissing / MARKET_BAR_BLOCK_SIZE) * MARKET_BAR_BLOCK_SIZE;
  for (let start = initialStart; start < barCount; start += MARKET_BAR_BLOCK_SIZE) {
    const bars = await prisma.marketBar.findMany({
      where: { datasetId, sequence: { gte: start, lt: start + MARKET_BAR_BLOCK_SIZE } },
      orderBy: { sequence: "asc" },
    });
    if (!bars.length) continue;
    const volumes = bars.flatMap((bar) => bar.volume === null ? [] : [bar.volume]);
    await prisma.marketBarBlock.upsert({
      where: { datasetId_startSequence: { datasetId, startSequence: bars[0].sequence } },
      create: {
        datasetId, startSequence: bars[0].sequence, endSequence: bars.at(-1)!.sequence,
        startTime: bars[0].timestamp, endTime: bars.at(-1)!.timestamp,
        open: bars[0].open, high: Math.max(...bars.map((bar) => bar.high)), low: Math.min(...bars.map((bar) => bar.low)),
        close: bars.at(-1)!.close, volume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) : null,
        volumeCount: volumes.length, barCount: bars.length,
      },
      update: {},
    });
    await prisma.marketDataset.update({
      where: { id: datasetId },
      data: { barBlockBuildCursor: bars.at(-1)!.sequence },
    });
  }
}

/** Start resumable legacy backfill without putting the full scan on the window request path. */
export function scheduleMarketBarBlockBuild(datasetId: string, barCount: number) {
  const active = builds.get(datasetId);
  if (active) return active;
  const operation = new Promise<void>((resolve) => setTimeout(resolve, 0))
    .then(() => buildMarketBarBlocks(datasetId, barCount))
    .finally(() => {
      if (builds.get(datasetId) === operation) builds.delete(datasetId);
    });
  builds.set(datasetId, operation);
  return operation;
}
