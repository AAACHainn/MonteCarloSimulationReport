import { prisma } from "@/lib/db";
import { aggregateMarketBars } from "./aggregation";
import { addCalendarDays, tradingDayBounds, tradingDayForTimestamp } from "./chunks";
import { serializeSourceBar } from "./dataset";
import type { AggregatedMarketBarData, MarketBarData, TradingSessionConfig } from "./types";

const SOURCE_BAR_SELECT = {
  sequence: true,
  timestamp: true,
  open: true,
  high: true,
  low: true,
  close: true,
  volume: true,
} as const;

function weekday(tradingDay: string) {
  return ((new Date(`${tradingDay}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
}

function bucketsPerSession(displaySeconds: number, session: TradingSessionConfig) {
  if (session.openMinute === null || session.closeMinute === null) return 1;
  const durationMinutes = session.mode === "OVERNIGHT_SESSION"
    ? 1_440 - session.openMinute + session.closeMinute
    : session.closeMinute - session.openMinute;
  return Math.max(1, Math.ceil(durationMinutes * 60 / displaySeconds));
}

type CommonWindowOptions = {
  datasetId: string;
  endSequence: number;
  wanted: number;
  sourceSeconds: number;
  displaySeconds: number;
  session: TradingSessionConfig;
  finalSequence: number;
};

export async function readSequentialRawWindow(options: CommonWindowOptions) {
  const { datasetId, endSequence, wanted, sourceSeconds, displaySeconds, session, finalSequence } = options;
  const multiplier = displaySeconds / sourceSeconds;
  const initialTake = Math.min(endSequence + 1, Math.max(1, Math.ceil((wanted + 2) * multiplier)));
  let fromSequence = endSequence - initialTake + 1;
  let sourceBars: MarketBarData[] = [];
  let aggregated: AggregatedMarketBarData[] = [];
  while (true) {
    const records = await prisma.marketBar.findMany({
      where: {
        datasetId,
        sequence: { gte: fromSequence, lte: sourceBars.length ? sourceBars[0].sequence - 1 : endSequence },
      },
      orderBy: { sequence: "asc" },
      select: SOURCE_BAR_SELECT,
    });
    sourceBars = records.map(serializeSourceBar).concat(sourceBars);
    aggregated = aggregateMarketBars({
      bars: sourceBars, sourceSeconds, displaySeconds, session,
      currentSequence: endSequence, finalSequence,
    });
    if (aggregated.length >= wanted || fromSequence === 0) return aggregated;
    const loadedCount = endSequence - fromSequence + 1;
    fromSequence = Math.max(0, endSequence - Math.min(endSequence + 1, loadedCount * 2) + 1);
  }
}

export async function readSessionRawWindow(options: CommonWindowOptions & {
  datasetStart: Date;
  endBar: MarketBarData;
}) {
  const {
    datasetId, datasetStart, endSequence, endBar, wanted,
    sourceSeconds, displaySeconds, session, finalSequence,
  } = options;
  const datasetStartMs = datasetStart.getTime();
  const endTimeMs = new Date(endBar.timestamp).getTime() + sourceSeconds * 1_000;
  const expectedPerDay = bucketsPerSession(displaySeconds, session);
  let tradingDay = tradingDayForTimestamp(endBar.timestamp, session);
  let requestedDays = Math.max(1, Math.ceil((wanted + 2) / expectedPerDay) + 2);
  let reachedStart = false;
  let sourceBars: MarketBarData[] = [];
  let aggregated: AggregatedMarketBarData[] = [];

  while (true) {
    const ranges: Array<{ start: number; end: number }> = [];
    while (ranges.length < requestedDays && !reachedStart) {
      const bounds = tradingDayBounds(tradingDay, session);
      if (bounds.end <= datasetStartMs) {
        reachedStart = true;
        break;
      }
      if (session.weekdays.includes(weekday(tradingDay))) {
        const start = Math.max(bounds.start, datasetStartMs);
        const end = Math.min(bounds.end, endTimeMs);
        if (start < end) ranges.push({ start, end });
      }
      tradingDay = addCalendarDays(tradingDay, -1);
    }

    // Independent timestamp ranges force SQLite to use the existing
    // MarketBar(datasetId, timestamp) index. A combined OR plus sequence
    // ordering otherwise scans every source bar before a late replay cursor.
    for (const range of ranges) {
      const records = await prisma.marketBar.findMany({
        where: {
          datasetId,
          timestamp: { gte: new Date(range.start), lt: new Date(range.end) },
        },
        orderBy: { timestamp: "asc" },
        select: SOURCE_BAR_SELECT,
      });
      sourceBars = records
        .filter((record) => record.sequence <= endSequence)
        .map(serializeSourceBar)
        .concat(sourceBars);
    }

    sourceBars.sort((left, right) => left.sequence - right.sequence);
    aggregated = aggregateMarketBars({
      bars: sourceBars, sourceSeconds, displaySeconds, session,
      currentSequence: endSequence, finalSequence,
    });
    if (aggregated.length >= wanted || reachedStart) return aggregated;
    const missing = wanted - aggregated.length;
    requestedDays = Math.max(3, Math.ceil((missing + 2) / expectedPerDay) + 2);
  }
}

