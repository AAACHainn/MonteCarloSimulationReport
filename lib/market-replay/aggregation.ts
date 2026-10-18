import { TZDate } from "@date-fns/tz";
import type {
  AggregateBarStatus,
  AggregatedMarketBarData,
  MarketBarData,
  TradingSessionConfig,
} from "./types";
import { isValidDisplayInterval } from "./types";

type Bucket = { start: number; end: number; expectedCount: number };
const localPartFormatters = new Map<string, Intl.DateTimeFormat>();
const sessionBoundsCache = new Map<string, { start: number; end: number }>();
export type AggregationSegment = {
  firstSequence: number; lastSequence: number; timestamp: string; endTimestamp: string;
  open: number; high: number; low: number; close: number; volume: number | null; sourceCount: number;
};

function localParts(timestamp: number, timezone: string) {
  let formatter = localPartFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    localPartFormatters.set(timezone, formatter);
  }
  const values = Object.fromEntries(formatter.formatToParts(timestamp)
    .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(values.weekday) + 1;
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second), weekday,
  };
}

function shiftCalendarDate(date: { year: number; month: number; day: number }, days: number) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: ((shifted.getUTCDay() + 6) % 7) + 1,
  };
}

type CalendarDate = { year: number; month: number; day: number };

function tradingDateAt(timestampMs: number, session: TradingSessionConfig) {
  const parts = localParts(timestampMs, session.timezone);
  return shiftCalendarDate(parts, session.mode === "OVERNIGHT_SESSION"
    && parts.hour * 60 + parts.minute >= session.openMinute! ? 1 : 0);
}

/** Shared by aggregation, adjacent buckets and the drawing calendar. */
function tradingSessionBounds(tradingDate: CalendarDate, session: TradingSessionConfig) {
  if (session.openMinute === null || session.closeMinute === null
    || (session.mode === "DAILY_SESSION" && session.openMinute >= session.closeMinute)) return null;
  const date = shiftCalendarDate(tradingDate, 0);
  if (!session.weekdays.includes(date.weekday)) return null;
  const startDate = session.mode === "OVERNIGHT_SESSION" ? shiftCalendarDate(date, -1) : date;
  const key = [session.mode, session.timezone, session.openMinute, session.closeMinute,
    date.year, date.month, date.day].join(":");
  let bounds = sessionBoundsCache.get(key);
  if (!bounds) {
    bounds = {
      start: new TZDate(startDate.year, startDate.month - 1, startDate.day,
        Math.floor(session.openMinute / 60), session.openMinute % 60, 0, session.timezone).getTime(),
      end: new TZDate(date.year, date.month - 1, date.day,
        Math.floor(session.closeMinute / 60), session.closeMinute % 60, 0, session.timezone).getTime(),
    };
    if (sessionBoundsCache.size >= 10_000) sessionBoundsCache.clear();
    sessionBoundsCache.set(key, bounds);
  }
  return bounds.end > bounds.start ? bounds : null;
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

  if (session.openMinute === null || session.closeMinute === null) return null;
  const bounds = tradingSessionBounds(tradingDateAt(timestampMs, session), session);
  if (!bounds) return null;
  const sessionStart = bounds.start;
  const sessionEnd = bounds.end;
  if (timestampMs < sessionStart || timestampMs >= sessionEnd || (timestampMs - sessionStart) % sourceMs !== 0) return null;
  const start = sessionStart + Math.floor((timestampMs - sessionStart) / displayMs) * displayMs;
  const end = Math.min(start + displayMs, sessionEnd);
  return { start, end, expectedCount: (end - start) / sourceMs };
}

/** Returns the adjacent chart bucket without walking every closed-market source slot. */
export function getAdjacentAggregationBucketStart(
  timestampMs: number,
  direction: -1 | 1,
  displaySeconds: number,
  session: TradingSessionConfig,
) {
  const displayMs = displaySeconds * 1_000;
  if (session.mode === "TWENTY_FOUR_SEVEN") return timestampMs + direction * displayMs;
  if (session.openMinute === null || session.closeMinute === null) return null;

  const baseTradingDate = tradingDateAt(timestampMs, session);
  for (let step = 0; step <= 14; step += 1) {
    const tradingDate = shiftCalendarDate(baseTradingDate, direction * step);
    const bounds = tradingSessionBounds(tradingDate, session);
    if (!bounds) continue;
    const { start: sessionStart, end: sessionEnd } = bounds;

    let candidate: number;
    if (direction > 0) {
      if (timestampMs < sessionStart) candidate = sessionStart;
      else if (timestampMs < sessionEnd) {
        candidate = sessionStart + (Math.floor((timestampMs - sessionStart) / displayMs) + 1) * displayMs;
      } else continue;
      if (candidate >= sessionEnd || candidate <= timestampMs) continue;
      return candidate;
    } else {
      if (timestampMs > sessionEnd) {
        candidate = sessionStart + Math.floor((sessionEnd - sessionStart - 1) / displayMs) * displayMs;
      } else if (timestampMs > sessionStart) {
        candidate = sessionStart + Math.floor((timestampMs - sessionStart - 1) / displayMs) * displayMs;
      } else continue;
      if (candidate < sessionStart || candidate >= timestampMs) continue;
      return candidate;
    }
  }
  return null;
}

const CALENDAR_DAY_MS = 86_400_000;
export const MAX_DRAWING_CALENDAR_DAYS = 36_600;
type CalendarDay = { start: number; end: number; count: number; ordinal: number };

/** Counts chart slots by trading day, never by individual candles. Ordinals stay
 * stable when either end of the cached calendar grows. No market data is created. */
export class AggregationCalendar {
  private readonly days = new Map<number, CalendarDay>();
  private firstDay = 0;
  private lastDay = -1;
  private readonly displayMs: number;

  constructor(displaySeconds: number, private readonly session: TradingSessionConfig) {
    this.displayMs = Math.max(1, displaySeconds) * 1_000;
  }

  private dayNumber(timestamp: number) {
    const date = tradingDateAt(timestamp, this.session);
    return Date.UTC(date.year, date.month - 1, date.day) / CALENDAR_DAY_MS;
  }

  private makeDay(day: number, ordinal: number): CalendarDay {
    const date = new Date(day * CALENDAR_DAY_MS);
    const bounds = tradingSessionBounds({ year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1, day: date.getUTCDate() }, this.session);
    return { start: bounds?.start ?? 0, end: bounds?.end ?? 0,
      count: bounds ? Math.ceil((bounds.end - bounds.start) / this.displayMs) : 0, ordinal };
  }

  private ensureDay(day: number) {
    if (!Number.isFinite(day)) return false;
    if (!this.days.size) {
      this.firstDay = day; this.lastDay = day;
      this.days.set(day, this.makeDay(day, 0));
      return true;
    }
    // Refuse the entire request rather than returning an apparently valid,
    // truncated coordinate when the bounded calendar cannot reach an anchor.
    if (Math.max(day, this.lastDay) - Math.min(day, this.firstDay) + 1 > MAX_DRAWING_CALENDAR_DAYS) return false;
    while (this.lastDay < day) {
      const previous = this.days.get(this.lastDay)!;
      this.lastDay += 1;
      this.days.set(this.lastDay, this.makeDay(this.lastDay, previous.ordinal + previous.count));
    }
    while (this.firstDay > day) {
      const next = this.days.get(this.firstDay)!;
      this.firstDay -= 1;
      const previous = this.makeDay(this.firstDay, 0);
      previous.ordinal = next.ordinal - previous.count;
      this.days.set(this.firstDay, previous);
    }
    return true;
  }

  position(timestamp: number, direction: -1 | 1): number | null {
    if (!Number.isFinite(timestamp)) return null;
    if (this.session.mode === "TWENTY_FOUR_SEVEN") return Math.floor(timestamp / this.displayMs);
    const day = this.dayNumber(timestamp);
    if (!this.ensureDay(day)) return null;
    for (let step = 0; step <= 7; step += 1) {
      const candidate = day + step * direction;
      if (!this.ensureDay(candidate)) return null;
      const entry = this.days.get(candidate)!;
      if (!entry.count) continue;
      if (timestamp >= entry.start && timestamp < entry.end) {
        return entry.ordinal + Math.floor((timestamp - entry.start) / this.displayMs);
      }
      if (direction > 0 && timestamp < entry.start) return entry.ordinal;
      if (direction < 0 && timestamp >= entry.end) return entry.ordinal + entry.count - 1;
    }
    return null;
  }

  timestampAtOffset(timestamp: number, offset: number): number | null {
    if (!Number.isSafeInteger(offset) || !Number.isFinite(timestamp)) return null;
    if (this.session.mode === "TWENTY_FOUR_SEVEN") return timestamp + offset * this.displayMs;
    if (!this.session.weekdays.length
      || Math.abs(offset) > MAX_DRAWING_CALENDAR_DAYS * Math.ceil(49 * 3_600_000 / this.displayMs)) return null;
    const origin = this.position(timestamp, 1);
    if (origin === null) return null;
    const target = origin + offset;
    let step = 8;
    for (;;) {
      const first = this.days.get(this.firstDay)!;
      const last = this.days.get(this.lastDay)!;
      if (target >= first.ordinal && target < last.ordinal + last.count) break;
      const remaining = MAX_DRAWING_CALENDAR_DAYS - this.days.size;
      if (!remaining) return null;
      const extension = Math.min(step, remaining);
      if (!this.ensureDay(target < first.ordinal ? this.firstDay - extension : this.lastDay + extension)) return null;
      step *= 2;
    }
    let low = this.firstDay, high = this.lastDay;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const day = this.days.get(mid)!;
      if (day.ordinal + day.count <= target) low = mid + 1;
      else high = mid;
    }
    const day = this.days.get(low)!;
    return day.start + (target - day.ordinal) * this.displayMs;
  }
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
  let cachedBucket: Bucket | null = null;
  const resolveBucket = (timestamp: string) => {
    const time = new Date(timestamp).getTime();
    if (cachedBucket && time >= cachedBucket.start && time < cachedBucket.end
      && (time - cachedBucket.start) % (sourceSeconds * 1000) === 0) return cachedBucket;
    cachedBucket = getAggregationBucket(time, sourceSeconds, displaySeconds, session);
    return cachedBucket;
  };
  for (const bar of segments) {
    if (bar.firstSequence > currentSequence) break;
    const bucket = resolveBucket(bar.timestamp);
    if (!bucket) continue;
    const endBucket = resolveBucket(bar.endTimestamp);
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
    const closed = bar.sourceCount === bar.expectedCount
      || new Date(bar.timestamp).getTime() < currentTime
      || currentSequence >= finalSequence;
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
  const next = existing.slice();
  mergeSourceBarInto(next, source, options);
  return next;
}

/** Mutates an array owned by the caller; avoids copying a long history for every source bar in one replay batch. */
export function mergeSourceBarInto(
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
  if (!bucket) return false;
  const previousLast = existing.at(-1);
  const last = previousLast ? { ...previousLast } : undefined;
  if (last) existing[existing.length - 1] = last;
  if (!last || new Date(last.timestamp).getTime() !== bucket.start) {
    if (last && last.status === "FORMING") {
      last.status = last.sourceCount === last.expectedCount ? "COMPLETE" : "INCOMPLETE";
    }
    existing.push({
      timestamp: new Date(bucket.start).toISOString(), bucketEnd: new Date(bucket.end).toISOString(),
      firstSequence: source.sequence, lastSequence: source.sequence,
      open: source.open, high: source.high, low: source.low, close: source.close,
      volume: source.volume, sourceCount: 1, expectedCount: bucket.expectedCount,
      status: bucket.expectedCount === 1 ? "COMPLETE" : source.sequence >= options.finalSequence ? "INCOMPLETE" : "FORMING",
    });
    return true;
  }
  last.lastSequence = source.sequence;
  last.high = Math.max(last.high, source.high);
  last.low = Math.min(last.low, source.low);
  last.close = source.close;
  last.sourceCount += 1;
  if (source.volume !== null) last.volume = (last.volume ?? 0) + source.volume;
  if (last.sourceCount === last.expectedCount) last.status = "COMPLETE";
  else if (source.sequence >= options.finalSequence) last.status = "INCOMPLETE";
  return true;
}

/** Replace server bucket revisions; replayed responses never add volume twice. */
export function mergeAggregatedBars(existing: AggregatedMarketBarData[], updates: AggregatedMarketBarData[]) {
  const next = existing.slice();
  for (const update of updates) {
    const index = next.findIndex((bar) => bar.timestamp === update.timestamp);
    if (index >= 0) {
      if (next[index].lastSequence <= update.lastSequence) next[index] = update;
    } else if (!next.length || update.timestamp > next.at(-1)!.timestamp) {
      const last = next.at(-1);
      if (last?.status === "FORMING") {
        next[next.length - 1] = { ...last, status: last.sourceCount === last.expectedCount ? "COMPLETE" : "INCOMPLETE" };
      }
      next.push(update);
    }
  }
  return next;
}
