import { parseSourceInterval, type MarketDatasetSummary, type SessionMode } from "./types";

type DatasetRecord = {
  id: string;
  name: string;
  description: string | null;
  symbol: string;
  timeframe: string;
  timezone: string;
  status: string;
  sourceIntervalSeconds: number | null;
  sessionMode: string;
  sessionOpenMinute: number | null;
  sessionCloseMinute: number | null;
  tradingWeekdays: string;
  barCount: number;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  progress: null | {
    startSequence: number;
    currentSequence: number;
    intervalMs: number;
    playbackRate: number;
    displayIntervalSeconds: number | null;
    updatedAt: Date;
  };
};

export function serializeMarketDataset(dataset: DatasetRecord): MarketDatasetSummary {
  const sourceIntervalSeconds = dataset.sourceIntervalSeconds ?? parseSourceInterval(dataset.timeframe);
  return {
    ...dataset,
    startTime: dataset.startTime.toISOString(),
    endTime: dataset.endTime.toISOString(),
    createdAt: dataset.createdAt.toISOString(),
    sourceIntervalSeconds,
    sessionMode: dataset.sessionMode as SessionMode,
    tradingWeekdays: dataset.tradingWeekdays.split(",").map(Number).filter((value) => value >= 1 && value <= 7),
    progress: dataset.progress ? {
      startSequence: dataset.progress.startSequence,
      currentSequence: dataset.progress.currentSequence,
      playbackRate: dataset.progress.playbackRate,
      displayIntervalSeconds: dataset.progress.displayIntervalSeconds ?? sourceIntervalSeconds ?? 1,
      updatedAt: dataset.progress.updatedAt.toISOString(),
    } : null,
  };
}
