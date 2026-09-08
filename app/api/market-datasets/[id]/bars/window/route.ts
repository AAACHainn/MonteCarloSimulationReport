import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { aggregateMarketBars, aggregateMarketSegments, getAggregationBucket, type AggregationSegment } from "@/lib/market-replay/aggregation";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { addCalendarDays, tradingDayBounds, tradingDayForTimestamp } from "@/lib/market-replay/chunks";
import { datasetSourceInterval, serializeSourceBar } from "@/lib/market-replay/dataset";
import {
  isValidDisplayInterval,
  MARKET_BAR_BLOCK_SIZE,
  type AggregatedMarketBarData,
  type MarketBarData,
  type TradingSessionConfig,
} from "@/lib/market-replay/types";
import { ensureMarketBarBlocks } from "@/lib/market-replay/bar-blocks";
import { replayWindowSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };
const SESSION_DATES_PER_QUERY = 40;
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

async function readSequentialRawWindow({
  datasetId, endSequence, wanted, sourceSeconds, displaySeconds, session, finalSequence,
}: {
  datasetId: string;
  endSequence: number;
  wanted: number;
  sourceSeconds: number;
  displaySeconds: number;
  session: TradingSessionConfig;
  finalSequence: number;
}) {
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

async function readSessionRawWindow({
  datasetId, datasetStart, endSequence, endBar, wanted, sourceSeconds, displaySeconds, session, finalSequence,
}: {
  datasetId: string;
  datasetStart: Date;
  endSequence: number;
  endBar: MarketBarData;
  wanted: number;
  sourceSeconds: number;
  displaySeconds: number;
  session: TradingSessionConfig;
  finalSequence: number;
}) {
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

    for (let index = 0; index < ranges.length; index += SESSION_DATES_PER_QUERY) {
      const batch = ranges.slice(index, index + SESSION_DATES_PER_QUERY);
      const records = await prisma.marketBar.findMany({
        where: {
          datasetId,
          sequence: { lte: endSequence },
          OR: batch.map((range) => ({ timestamp: { gte: new Date(range.start), lt: new Date(range.end) } })),
        },
        orderBy: { sequence: "asc" },
        select: SOURCE_BAR_SELECT,
      });
      sourceBars = records.map(serializeSourceBar).concat(sourceBars);
    }

    aggregated = aggregateMarketBars({
      bars: sourceBars, sourceSeconds, displaySeconds, session,
      currentSequence: endSequence, finalSequence,
    });
    if (aggregated.length >= wanted || reachedStart) return aggregated;
    const missing = wanted - aggregated.length;
    requestedDays = Math.max(3, Math.ceil((missing + 2) / expectedPerDay) + 2);
  }
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const parsed = replayWindowSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const dataset = await prisma.marketDataset.findUnique({ where: { id } });
  if (!dataset || dataset.status !== "READY") return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  const sourceSeconds = datasetSourceInterval(dataset);
  if (!sourceSeconds || !isValidDisplayInterval(sourceSeconds, parsed.data.displayIntervalSeconds)) {
    return NextResponse.json({ error: copy.marketReplay.invalidDisplayInterval }, { status: 400 });
  }
  const endSequence = Math.min(parsed.data.endSequence, dataset.barCount - 1);
  if (endSequence < 0) return NextResponse.json({ visibleBars: [], warmupBars: [], lastSourceBar: null });

  const session = resolveDisplaySession(dataset, parsed.data.displaySession);
  if (!session) return NextResponse.json({ error: copy.marketReplay.unsupportedDisplaySession }, { status: 400 });
  const multiplier = parsed.data.displayIntervalSeconds / sourceSeconds;
  const wanted = parsed.data.visibleCount + parsed.data.warmupCount;
  const lastSourceBar = serializeSourceBar(await prisma.marketBar.findUniqueOrThrow({
    where: { datasetId_sequence: { datasetId: id, sequence: endSequence } },
    select: SOURCE_BAR_SELECT,
  }));
  let aggregated: AggregatedMarketBarData[];

  if (multiplier < MARKET_BAR_BLOCK_SIZE) {
    aggregated = session.mode === "TWENTY_FOUR_SEVEN"
      ? await readSequentialRawWindow({
          datasetId: id, endSequence, wanted, sourceSeconds,
          displaySeconds: parsed.data.displayIntervalSeconds, session, finalSequence: dataset.barCount - 1,
        })
      : await readSessionRawWindow({
          datasetId: id, datasetStart: dataset.startTime, endSequence, endBar: lastSourceBar,
          wanted, sourceSeconds, displaySeconds: parsed.data.displayIntervalSeconds,
          session, finalSequence: dataset.barCount - 1,
        });
  } else {
    const aggregateCount = wanted + 2;
    let sourceTake = Math.min(endSequence + 1, Math.max(1, Math.ceil(aggregateCount * multiplier)));
    await ensureMarketBarBlocks(id, dataset.barCount);
    aggregated = [];
    while (true) {
      const fromSequence = endSequence - sourceTake + 1;
      const blocks = await prisma.marketBarBlock.findMany({
        where: { datasetId: id, startSequence: { gte: fromSequence }, endSequence: { lte: endSequence } },
        orderBy: { startSequence: "asc" },
      });
      const acceptedBlocks = blocks.filter((block) => {
        const first = getAggregationBucket(block.startTime.getTime(), sourceSeconds, parsed.data.displayIntervalSeconds, session);
        const last = getAggregationBucket(block.endTime.getTime(), sourceSeconds, parsed.data.displayIntervalSeconds, session);
        return first && last && first.start === last.start;
      });
      const rawRanges: Array<{ from: number; to: number }> = [];
      let cursor = fromSequence;
      for (const block of acceptedBlocks) {
        if (cursor < block.startSequence) rawRanges.push({ from: cursor, to: block.startSequence - 1 });
        cursor = block.endSequence + 1;
      }
      if (cursor <= endSequence) rawRanges.push({ from: cursor, to: endSequence });
      const sourceBars: ReturnType<typeof serializeSourceBar>[] = [];
      for (let index = 0; index < rawRanges.length; index += 50) {
        const records = await prisma.marketBar.findMany({
          where: { datasetId: id, OR: rawRanges.slice(index, index + 50).map((range) => ({ sequence: { gte: range.from, lte: range.to } })) },
          orderBy: { sequence: "asc" },
          select: SOURCE_BAR_SELECT,
        });
        for (const record of records) sourceBars.push(serializeSourceBar(record));
      }
      const segments: AggregationSegment[] = [
        ...sourceBars.map((bar) => ({ firstSequence: bar.sequence, lastSequence: bar.sequence, timestamp: bar.timestamp, endTimestamp: bar.timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, sourceCount: 1 })),
        ...acceptedBlocks.map((block) => ({ firstSequence: block.startSequence, lastSequence: block.endSequence, timestamp: block.startTime.toISOString(), endTimestamp: block.endTime.toISOString(), open: block.open, high: block.high, low: block.low, close: block.close, volume: block.volumeCount ? block.volume : null, sourceCount: block.barCount })),
      ].sort((a, b) => a.firstSequence - b.firstSequence);
      aggregated = aggregateMarketSegments({
        segments, sourceSeconds, displaySeconds: parsed.data.displayIntervalSeconds, session,
        currentSequence: endSequence, finalSequence: dataset.barCount - 1,
      });
      if (aggregated.length >= wanted || fromSequence === 0) break;
      sourceTake = Math.min(endSequence + 1, sourceTake * 2);
    }
  }
  const window = aggregated.slice(-wanted);
  const visibleFrom = Math.max(0, window.length - parsed.data.visibleCount);
  return NextResponse.json({
    warmupBars: window.slice(0, visibleFrom),
    visibleBars: window.slice(visibleFrom),
    lastSourceBar,
  });
}
