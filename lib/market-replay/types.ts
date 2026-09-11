export const MAX_MARKET_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_MARKET_EXPANDED_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_MARKET_BARS = 20_000_000;
export const MARKET_BAR_BLOCK_SIZE = 4_096;
export const REPLAY_HISTORY_BARS = 200;
export const MAX_REPLAY_ADVANCE_COUNT = 100;
export const MAX_DISPLAY_ADVANCE_SOURCE_BARS = 86_400;
export const MAX_REPLAY_SYNC_SOURCE_BARS = 100;
export const MARKET_CACHE_BUDGET_BYTES = 256 * 1024 * 1024;
export const MARKET_CACHE_EVICT_TO_RATIO = 0.8;
export const MIN_PLAYBACK_RATE = 1;
export const MAX_PLAYBACK_RATE = 100;
export const MAX_DISPLAY_INTERVAL_SECONDS = 86_400;
export const EMA_LENGTH_MIN = 2;
export const EMA_LENGTH_MAX = 1_000;
export const MAX_EMA_INDICATORS = 5;
export const EMA_LINE_WIDTHS = [1, 2, 3, 4] as const;
export const EMA_LINE_STYLES = ["SOLID", "DASHED", "DOTTED"] as const;

export type PlaybackRate = number;
export type SessionMode = "TWENTY_FOUR_SEVEN" | "DAILY_SESSION" | "OVERNIGHT_SESSION";
export type DisplaySession = "ETH" | "RTH";
export type AggregateBarStatus = "FORMING" | "COMPLETE" | "INCOMPLETE";
export type EmaLineWidth = (typeof EMA_LINE_WIDTHS)[number];
export type EmaLineStyle = (typeof EMA_LINE_STYLES)[number];

export type TradingSessionConfig = {
  mode: SessionMode;
  timezone: string;
  openMinute: number | null;
  closeMinute: number | null;
  weekdays: number[];
};

export type AggregationInterval = {
  sourceSeconds: number;
  displaySeconds: number;
};

export type EmaIndicatorConfig = {
  id: string;
  length: number;
  color: string;
  lineWidth: EmaLineWidth;
  lineStyle: EmaLineStyle;
  visible: boolean;
};

export type MarketBarData = {
  sequence: number;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type MarketBarBlockData = {
  startSequence: number;
  endSequence: number;
  startTime: string;
  endTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  volumeCount: number;
  barCount: number;
};

export type AggregatedMarketBarData = {
  timestamp: string;
  bucketEnd: string;
  firstSequence: number;
  lastSequence: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  sourceCount: number;
  expectedCount: number;
  status: AggregateBarStatus;
};

export type ReplayProgressData = {
  startSequence: number;
  currentSequence: number;
  playbackRate: PlaybackRate;
  displayIntervalSeconds: number;
  displaySession: DisplaySession;
  generation: number;
  syncVersion: number;
  updatedAt?: string;
};

export type MarketDatasetSummary = {
  id: string;
  name: string;
  description: string | null;
  symbol: string;
  timeframe: string;
  timezone: string;
  status: string;
  dataVersion: number;
  sourceIntervalSeconds: number | null;
  priceTickSize: number;
  sessionMode: SessionMode;
  sessionOpenMinute: number | null;
  sessionCloseMinute: number | null;
  tradingWeekdays: number[];
  availableDisplaySessions: DisplaySession[];
  barCount: number;
  startTime: string;
  endTime: string;
  createdAt: string;
  progress: ReplayProgressData | null;
};

export type MarketBarDayChunk = {
  tradingDay: string;
  rangeStart: string;
  rangeEnd: string;
  bars: MarketBarData[];
};

export type MarketBarChunksResponse = {
  datasetId: string;
  dataVersion: number;
  symbol: string;
  sourceIntervalSeconds: number;
  requestStartDate: string;
  requestEndDate: string;
  coveredDates: string[];
  chunks: MarketBarDayChunk[];
  nextStartDate: string | null;
};

export type ReplayStatus = "paused" | "playing" | "finished";

export type ReplayState = ReplayProgressData & {
  barCount: number;
  status: ReplayStatus;
  confirmedSequence: number;
};

export function isPlaybackRate(value: number): value is PlaybackRate {
  return Number.isInteger(value) && value >= MIN_PLAYBACK_RATE && value <= MAX_PLAYBACK_RATE;
}

export function parseSourceInterval(value: string) {
  const match = /^\s*(\d+)\s*([smh])\s*$/i.exec(value);
  if (!match) return null;
  const multiplier = match[2].toLowerCase() === "s" ? 1 : match[2].toLowerCase() === "m" ? 60 : 3_600;
  const seconds = Number(match[1]) * multiplier;
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= MAX_DISPLAY_INTERVAL_SECONDS ? seconds : null;
}

export function formatInterval(seconds: number) {
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function isValidDisplayInterval(sourceSeconds: number, displaySeconds: number) {
  return Number.isInteger(displaySeconds)
    && displaySeconds >= sourceSeconds
    && displaySeconds <= MAX_DISPLAY_INTERVAL_SECONDS
    && displaySeconds % sourceSeconds === 0;
}
