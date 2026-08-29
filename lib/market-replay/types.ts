export const MAX_MARKET_CSV_BYTES = 50 * 1024 * 1024;
export const MAX_MARKET_BARS = 200_000;
export const REPLAY_HISTORY_BARS = 200;
export const REPLAY_INTERVALS = [10_000, 5_000, 3_000, 1_000, 500, 200, 100] as const;

export type ReplayIntervalMs = (typeof REPLAY_INTERVALS)[number];

export type MarketBarData = {
  sequence: number;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type ReplayProgressData = {
  startSequence: number;
  currentSequence: number;
  intervalMs: ReplayIntervalMs;
  updatedAt?: string;
};

export type MarketDatasetSummary = {
  id: string;
  name: string;
  description: string | null;
  symbol: string;
  timeframe: string;
  timezone: string;
  barCount: number;
  startTime: string;
  endTime: string;
  createdAt: string;
  progress: ReplayProgressData | null;
};

export type ReplayStatus = "paused" | "playing" | "finished";

export type ReplayState = ReplayProgressData & {
  barCount: number;
  status: ReplayStatus;
};

export function isReplayInterval(value: number): value is ReplayIntervalMs {
  return REPLAY_INTERVALS.includes(value as ReplayIntervalMs);
}
