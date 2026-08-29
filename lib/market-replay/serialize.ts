import type { MarketDatasetSummary, ReplayIntervalMs } from "./types";

type DatasetRecord = {
  id: string;
  name: string;
  description: string | null;
  symbol: string;
  timeframe: string;
  timezone: string;
  barCount: number;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  progress: null | {
    startSequence: number;
    currentSequence: number;
    intervalMs: number;
    updatedAt: Date;
  };
};

export function serializeMarketDataset(dataset: DatasetRecord): MarketDatasetSummary {
  return {
    ...dataset,
    startTime: dataset.startTime.toISOString(),
    endTime: dataset.endTime.toISOString(),
    createdAt: dataset.createdAt.toISOString(),
    progress: dataset.progress ? {
      startSequence: dataset.progress.startSequence,
      currentSequence: dataset.progress.currentSequence,
      intervalMs: dataset.progress.intervalMs as ReplayIntervalMs,
      updatedAt: dataset.progress.updatedAt.toISOString(),
    } : null,
  };
}
