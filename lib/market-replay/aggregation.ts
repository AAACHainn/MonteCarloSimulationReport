import { TZDate } from "@date-fns/tz";
import type {
  AggregateBarStatus,
  AggregatedMarketBarData,
  MarketBarData,
  TradingSessionConfig,
} from "./types";
import { isValidDisplayInterval } from "./types";

type Bucket = { start: number; end: number; expectedCount: number };
export type AggregationSegment = {
  firstSequence: number; lastSequence: number; timestamp: string; endTimestamp: string;
  open: number; high: number; low: number; close: number; volume: number | null; sourceCount: number;
};

function localParts(timestamp: number, timezone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(timestamp).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(values.weekday) + 1;
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second), weekday,
  };
}

export function getAggregationBucket(
  timestampMs: number,
  sourceSeconds: number,
  displaySeconds: number,
  session: TradingSessionConfig,
): Bucket | null {
  if (!isValidDisplayInterval(sourceSeconds, displaySeconds)) return null;
  const sourceMs = sourceSeconds * 1_000;
  const displayMs = displaySeconds * 1_000;
  if (session.mode === "TWENTY_FOUR_SEVEN") {
    if (timestampMs % sourceMs !== 0) return null;
    const start = Math.floor(timestampMs / displayMs) * displayMs;
    return { start, end: start + displayMs, expectedCount: displaySeconds / sourceSeconds };
  }

  if (session.openMinute === null || session.closeMinute === null || session.openMinute >= session.closeMinute) return null;
  const parts = localParts(timestampMs, session.timezone);
  if (!session.weekdays.includes(parts.weekday)) return null;
  const openHour = Math.floor(session.openMinute / 60);
  const openMinute = session.openMinute % 60;
  const closeHour = Math.floor(session.closeMinute / 60);
  const closeMinute = session.closeMinute % 60;
  const sessionStart = new TZDate(parts.year, parts.month - 1, parts.day, openHour, openMinute, 0, session.timezone).getTime();
  const sessionEnd = new TZDate(parts.year, parts.month - 1, parts.day, closeHour, closeMinute, 0, session.timezone).getTime();
  if (timestampMs < sessionStart || timestampMs >= sessionEnd || (timestampMs - sessionStart) % sourceMs !== 0) return null;
  const start = sessionStart + Math.floor((timestampMs - sessionStart) / displayMs) * displayMs;
  const end = Math.min(start + displayMs, sessionEnd);
  return { start, end, expectedCount: (end - start) / sourceMs };
}

export function aggregateMarketBars({
  bars,
  sourceSeconds,
  displaySeconds,
  session,
  currentSequence,
  finalSequence,
}: {
  bars: MarketBarData[];
  sourceSeconds: number;
  displaySeconds: number;
  session: TradingSessionConfig;
  currentSequence: number;
  finalSequence: number;
}): AggregatedMarketBarData[] {
  return aggregateMarketSegments({
    segments: bars.map((bar) => ({
      firstSequence: bar.sequence, lastSequence: bar.sequence, timestamp: bar.timestamp, endTimestamp: bar.timestamp,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, sourceCount: 1,
    })), sourceSeconds, displaySeconds, session, currentSequence, finalSequence,
  });
}

export function aggregateMarketSegments({
  segments, sourceSeconds, displaySeconds, session, currentSequence, finalSequence,
}: {
  segments: AggregationSegment[];
  sourceSeconds: number;
  displaySeconds: number;
  session: TradingSessionConfig;
  currentSequence: number;
  finalSequence: number;
}): AggregatedMarketBarData[] {
  const result: AggregatedMarketBarData[] = [];
  for (const bar of segments) {
    if (bar.firstSequence > currentSequence) break;
    const bucket = getAggregationBucket(new Date(bar.timestamp).getTime(), sourceSeconds, displaySeconds, session);
    if (!bucket) continue;
    const endBucket = getAggregationBucket(new Date(bar.endTimestamp).getTime(), sourceSeconds, displaySeconds, session);
    if (!endBucket || endBucket.start !== bucket.start) throw new Error("Aggregation segment crosses a target bucket boundary.");
    const last = result.at(-1);
    if (!last || new Date(last.timestamp).getTime() !== bucket.start) {
      result.push({
        timestamp: new Date(bucket.start).toISOString(), bucketEnd: new Date(bucket.end).toISOString(),
        firstSequence: bar.firstSequence, lastSequence: bar.lastSequence,
        open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        volume: bar.volume, sourceCount: bar.sourceCount, expectedCount: bucket.expectedCount, status: "FORMING",
      });
    } else {
      last.lastSequence = bar.lastSequence;
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.sourceCount += bar.sourceCount;
      if (bar.volume !== null) last.volume = (last.volume ?? 0) + bar.volume;
    }
  }

  const currentTime = result.length ? new Date(result.at(-1)!.timestamp).getTime() : Number.NEGATIVE_INFINITY;
  for (const bar of result) {
    const closed = new Date(bar.timestamp).getTime() < currentTime || currentSequence >= finalSequence;
    const status: AggregateBarStatus = !closed ? "FORMING" : bar.sourceCount === bar.expectedCount ? "COMPLETE" : "INCOMPLETE";
    bar.status = status;
  }
  return result;
}

export function mergeSourceBar(
  existing: AggregatedMarketBarData[],
  source: MarketBarData,
  options: {
    sourceSeconds: number;
    displaySeconds: number;
    session: TradingSessionConfig;
    finalSequence: number;
  },
) {
  const bucket = getAggregationBucket(
    new Date(source.timestamp).getTime(), options.sourceSeconds, options.displaySeconds, options.session,
  );
  if (!bucket) return existing;
  const next = existing.map((bar) => ({ ...bar }));
  const last = next.at(-1);
  if (!last || new Date(last.timestamp).getTime() !== bucket.start) {
    if (last && last.status === "FORMING") {
      last.status = last.sourceCount === last.expectedCount ? "COMPLETE" : "INCOMPLETE";
    }
    next.push({
      timestamp: new Date(bucket.start).toISOString(), bucketEnd: new Date(bucket.end).toISOString(),
      firstSequence: source.sequence, lastSequence: source.sequence,
      open: source.open, high: source.high, low: source.low, close: source.close,
      volume: source.volume, sourceCount: 1, expectedCount: bucket.expectedCount,
      status: source.sequence >= options.finalSequence ? (bucket.expectedCount === 1 ? "COMPLETE" : "INCOMPLETE") : "FORMING",
    });
    return next;
  }
  last.lastSequence = source.sequence;
  last.high = Math.max(last.high, source.high);
  last.low = Math.min(last.low, source.low);
  last.close = source.close;
  last.sourceCount += 1;
  if (source.volume !== null) last.volume = (last.volume ?? 0) + source.volume;
  if (source.sequence >= options.finalSequence) last.status = last.sourceCount === last.expectedCount ? "COMPLETE" : "INCOMPLETE";
  return next;
}
