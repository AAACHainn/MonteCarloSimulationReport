import { createUuid } from "@/lib/uuid";
import { type ReplayViewportSnapshot, DEFAULT_REPLAY_MAX_VISIBLE_BARS } from "@/lib/market-replay/chart-range";
import { replayDisplayMetadataKey } from "@/lib/market-replay/dataset-refresh";
import { EMA_LENGTH_MAX, EMA_LENGTH_MIN, type AggregatedMarketBarData, type DisplaySession, type MarketBarData, type MarketDatasetSummary } from "@/lib/market-replay/types";
import type { ReplayTradeAnnotationData } from "@/lib/paper-trading/types";
import type { ReplayServerResult } from "@/lib/market-replay/server-sync-types";
import { type FibonacciRetracementStyle } from "@/lib/market-replay/chart-drawings";

export type ReplayChartDisplay = {
  displayIntervalSeconds: number;
  displaySession: DisplaySession;
  viewport: ReplayViewportSnapshot | null;
};

export type WindowPayload = {
  visibleBars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
  lastSourceBar: MarketBarData | null;
  focusBarIndex?: number | null;
  nextEndSequence?: number | null;
  hasEarlierBars?: boolean;
};
export type ServerAdvancePayload = ReplayServerResult & {
  flatAdvanceUnavailable?: boolean;
  reachedVisibleBucket?: boolean;
  aggregatedBars?: AggregatedMarketBarData[];
  lastSourceBar?: MarketBarData | null;
};
export type TradeAnnotationsPayload = {
  items: ReplayTradeAnnotationData[];
  truncated: boolean;
};

export const REPLAY_SYNC_BATCH_SIZE = 100;

export function replayWindowRequest(
  dataset: MarketDatasetSummary,
  endSequence: number,
  displayIntervalSeconds: number,
  displaySession: DisplaySession,
  warmupCount: number,
  focusSequence: number | null = null,
  visibleCount = DEFAULT_REPLAY_MAX_VISIBLE_BARS,
) {
  const limitedWarmup = Math.min(EMA_LENGTH_MAX, warmupCount);
  const cacheKey = [
    "time-aggregation-v1", replayDisplayMetadataKey(dataset), dataset.id, dataset.dataVersion, endSequence, displayIntervalSeconds, displaySession,
    visibleCount, limitedWarmup, focusSequence ?? "live",
  ].join(":");
  const params = new URLSearchParams({
    displayIntervalSeconds: String(displayIntervalSeconds), displaySession, endSequence: String(endSequence),
    visibleCount: String(visibleCount), warmupCount: String(limitedWarmup),
  });
  if (focusSequence !== null) params.set("focusSequence", String(focusSequence));
  return { cacheKey, params };
}

export function createLocalDrawingId(prefix: "temporary" | "template") {
  return `${prefix}-${createUuid()}`;
}

export function cloneFibonacciStyle(style: FibonacciRetracementStyle): FibonacciRetracementStyle {
  return { ...style, levels: style.levels.map((level) => ({ ...level })) };
}

export function isValidEmaLength(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= EMA_LENGTH_MIN && Number(value) <= EMA_LENGTH_MAX;
}

export function formatDatasetTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

export type JournalFocus = { sequence: number; no: number; globalNo: number };

