import { availableDisplaySessions } from "./chart-sessions";
import { AGGREGATION_RULE_VERSION } from "./time-aggregation";
import { parseSourceInterval, type DisplaySession, type MarketDatasetSummary, type SessionMode } from "./types";

type DatasetRecord = {
  id: string;
  name: string;
  description: string | null;
  symbol: string;
  timeframe: string;
  timezone: string;
  status: string;
  dataVersion: number;
  historyVersion?: number;
  activeAggregationId?: string | null;
  sourceIntervalSeconds: number | null;
  priceTickSize: number;
  sessionMode: string;
  sessionOpenMinute: number | null;
  sessionCloseMinute: number | null;
  tradingWeekdays: string;
  barCount: number;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  progress: null | ProgressRecord | ProgressRecord[];
};

type ProgressRecord = {
    startSequence: number;
    currentSequence: number;
    playbackRate: number;
    displayIntervalSeconds: number | null;
    displaySession: string;
    generation: number;
    syncVersion: number;
    updatedAt: Date;
};

export function serializeMarketDataset(dataset: DatasetRecord): MarketDatasetSummary {
  const sourceIntervalSeconds = dataset.sourceIntervalSeconds ?? parseSourceInterval(dataset.timeframe);
  // Dataset listings have no selected session. Never choose an arbitrary cursor.
  const progress = Array.isArray(dataset.progress) ? null : dataset.progress;
  return {
    ...dataset,
    historyVersion: dataset.historyVersion ?? 1,
    aggregationGenerationId: dataset.activeAggregationId ?? null,
    aggregationRuleVersion: AGGREGATION_RULE_VERSION,
    aggregationStatus: dataset.activeAggregationId ? "READY" : "PENDING",
    startTime: dataset.startTime.toISOString(),
    endTime: dataset.endTime.toISOString(),
    createdAt: dataset.createdAt.toISOString(),
    sourceIntervalSeconds,
    sessionMode: dataset.sessionMode as SessionMode,
    tradingWeekdays: dataset.tradingWeekdays.split(",").map(Number).filter((value) => value >= 1 && value <= 7),
    availableDisplaySessions: availableDisplaySessions(dataset.symbol),
    progress: progress ? {
      startSequence: progress.startSequence,
      currentSequence: progress.currentSequence,
      playbackRate: progress.playbackRate,
      displayIntervalSeconds: progress.displayIntervalSeconds ?? sourceIntervalSeconds ?? 1,
      displaySession: progress.displaySession as DisplaySession,
      generation: progress.generation,
      syncVersion: progress.syncVersion,
      updatedAt: progress.updatedAt.toISOString(),
    } : null,
  };
}
