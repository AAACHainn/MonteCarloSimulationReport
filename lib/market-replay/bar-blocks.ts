import { prisma } from "@/lib/db";
import { MARKET_BAR_BLOCK_SIZE } from "./types";

export async function ensureMarketBarBlocks(datasetId: string, barCount: number) {
  if (!barCount || await prisma.marketBarBlock.count({ where: { datasetId } })) return;
  for (let start = 0; start < barCount; start += MARKET_BAR_BLOCK_SIZE) {
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
  }
}
