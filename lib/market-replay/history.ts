import {
  REPLAY_HISTORY_BAR_LIMIT,
  REPLAY_HISTORY_PAGE_LIMIT,
  REPLAY_HISTORY_RAW_SOURCE_BUDGET,
  type AggregatedMarketBarData,
  type TradingSessionConfig,
} from "./types";
import { addCalendarDays, tradingDayBounds, tradingDayForTimestamp } from "./chunks";
import { BASE_AGGREGATION_INTERVALS } from "./time-aggregation";

export type ReplayHistorySlice = {
  bars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
};

function preferredBar(current: AggregatedMarketBarData, candidate: AggregatedMarketBarData) {
  const currentSpan = current.lastSequence - current.firstSequence;
  const candidateSpan = candidate.lastSequence - candidate.firstSequence;
  if (candidateSpan !== currentSpan) return candidateSpan > currentSpan ? candidate : current;
  if (candidate.sourceCount !== current.sourceCount) return candidate.sourceCount > current.sourceCount ? candidate : current;
  return candidate.lastSequence >= current.lastSequence ? candidate : current;
}

/** Merge cached and authoritative windows without duplicating aggregation buckets. */
export function mergeReplayHistory(
  inputs: AggregatedMarketBarData[][],
  warmupCount: number,
  historyLimit = REPLAY_HISTORY_BAR_LIMIT,
): ReplayHistorySlice {
  const byTimestamp = new Map<string, AggregatedMarketBarData>();
  for (const input of inputs) {
    for (const bar of input) {
      const current = byTimestamp.get(bar.timestamp);
      byTimestamp.set(bar.timestamp, current ? preferredBar(current, bar) : bar);
    }
  }
  const ordered = [...byTimestamp.values()].sort((a, b) => (
    a.firstSequence - b.firstSequence || a.timestamp.localeCompare(b.timestamp)
  ));
  const visibleFrom = Math.max(0, ordered.length - Math.max(0, historyLimit));
  const bars = ordered.slice(visibleFrom);
  return {
    bars,
    warmupBars: ordered.slice(Math.max(0, visibleFrom - Math.max(0, warmupCount)), visibleFrom),
  };
}

export function replayHistoryPageSize(sourceSeconds: number, displaySeconds: number) {
  const multiplier = Math.max(1, Math.floor(displaySeconds / sourceSeconds));
  const layers = [...BASE_AGGREGATION_INTERVALS, 3600].filter((seconds) => seconds > sourceSeconds && seconds <= displaySeconds && seconds % sourceSeconds === 0);
  const estimatedRows = layers.length ? Math.min(multiplier,
    2 * (layers[0] / sourceSeconds - 1) + Math.ceil(displaySeconds / layers.at(-1)!)) : multiplier;
  return Math.max(1, Math.min(REPLAY_HISTORY_PAGE_LIMIT, Math.floor(REPLAY_HISTORY_RAW_SOURCE_BUDGET / estimatedRows)));
}

export function nextHistoryEndSequence(bars: AggregatedMarketBarData[]) {
  const first = bars[0];
  return first && first.firstSequence > 0 ? first.firstSequence - 1 : null;
}

function nextScheduledTradingDay(tradingDay: string, session: TradingSessionConfig) {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addCalendarDays(tradingDay, offset);
    const weekday = ((new Date(`${candidate}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
    if (session.weekdays.includes(weekday)) return candidate;
  }
  return null;
}

/**
 * Cached display bars are reusable only when their newest suffix attaches to the
 * authoritative window. This prevents independent cached periods from being
 * drawn as one price series after the replay start changes.
 */
export function contiguousCachedHistoryBefore(
  cached: AggregatedMarketBarData[],
  current: AggregatedMarketBarData[],
  limit: number,
  session: TradingSessionConfig,
) {
  const firstCurrent = current[0];
  if (!firstCurrent || limit <= 0) return [];
  const ordered = mergeReplayHistory([cached], 0, cached.length).bars
    .filter((bar) => bar.timestamp < firstCurrent.timestamp);
  const result: AggregatedMarketBarData[] = [];
  let next = firstCurrent;

  for (let index = ordered.length - 1; index >= 0 && result.length < limit; index -= 1) {
    const candidate = ordered[index];
    let attached = candidate.lastSequence + 1 === next.firstSequence;
    if (!attached && session.mode !== "TWENTY_FOUR_SEVEN") {
      const candidateDay = tradingDayForTimestamp(candidate.timestamp, session);
      const nextDay = tradingDayForTimestamp(next.timestamp, session);
      const candidateBounds = tradingDayBounds(candidateDay, session);
      const nextBounds = tradingDayBounds(nextDay, session);
      attached = new Date(candidate.bucketEnd).getTime() === candidateBounds.end
        && new Date(next.timestamp).getTime() === nextBounds.start
        && nextScheduledTradingDay(candidateDay, session) === nextDay;
    }
    if (!attached) break;
    result.unshift(candidate);
    next = candidate;
  }
  return result;
}
