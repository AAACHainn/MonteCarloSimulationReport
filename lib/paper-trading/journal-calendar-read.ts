import { prisma } from "@/lib/db";
import { addCalendarDays, tradingDayForTimestamp, tradingDayLabelStart } from "@/lib/market-replay/chunks";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import type { MarketDataset } from "@prisma/client";
import type { ReplayScope } from "@/lib/replay-sessions/scope";
import { emptyJournalDayTotals, journalCalendarWeeks, type JournalDayTotals } from "./journal-calendar";
import type { ReplayJournalEntryData } from "./types";

async function readJournalReplayRanges(scope: ReplayScope) {
  const [progress, rounds] = await Promise.all([
    prisma.replayProgress.findUnique({ where: { replaySessionId: scope.id } }),
    scope.accountCategory !== "PROP_PRACTICE" ? [] : prisma.propPracticeRound.findMany({
      where: {
        replaySessionId: scope.id,
        projectionId: scope.journalProjectionIds ? { in: scope.journalProjectionIds } : scope.projectionId,
      },
      select: { startSequence: true, endSequence: true, projection: { select: { currentSequence: true } } },
    }),
  ]);
  if (!progress) return [];
  const ranges = scope.accountCategory === "PROP_PRACTICE" ? rounds.map(round => ({
    start: Math.max(progress.startSequence, round.startSequence),
    end: Math.min(progress.currentSequence, round.endSequence ?? round.projection.currentSequence),
  })) : [{ start: progress.startSequence, end: progress.currentSequence }];
  return ranges.filter(range => range.start <= range.end);
}

export async function readJournalCalendar(
  dataset: MarketDataset,
  scope: ReplayScope,
  requestedMonth: string | null,
  loadTrades: (from: Date, to: Date) => Promise<Array<Pick<ReplayJournalEntryData, "closedAt" | "globalNo" | "gainLoss" | "quantity" | "result">>>,
) {
  const session = resolveDisplaySession(dataset, "ETH")!;
  const ranges = await readJournalReplayRanges(scope);
  const [firstBar, lastBar] = ranges.length ? await Promise.all([
    Math.min(...ranges.map(range => range.start)),
    Math.max(...ranges.map(range => range.end)),
  ].map(sequence => prisma.marketBar.findUnique({
    where: { datasetId_sequence: { datasetId: dataset.id, sequence } },
    select: { timestamp: true },
  }))) : [null, null];
  const monthOf = (date: Date) => tradingDayForTimestamp(date, session).slice(0, 7);
  const monthRange = firstBar && lastBar ? { first: monthOf(firstBar.timestamp), last: monthOf(lastBar.timestamp) } : null;
  const month = monthRange && requestedMonth && requestedMonth >= monthRange.first && requestedMonth <= monthRange.last
    ? requestedMonth : monthRange?.last ?? monthOf(dataset.startTime);
  const dates = journalCalendarWeeks(month).flat();
  const start = tradingDayLabelStart(dates[0], session);
  const end = tradingDayLabelStart(addCalendarDays(dates.at(-1)!, 1), session);
  const trades = await loadTrades(new Date(start), new Date(end));
  const days: Array<JournalDayTotals & { date: string; firstTradeNo: number | null }> =
    dates.map(date => ({ date, firstTradeNo: null, ...emptyJournalDayTotals() }));
  const totals = new Map(days.map(day => [day.date, day]));
  for (const trade of trades) {
    const day = totals.get(tradingDayForTimestamp(trade.closedAt, session));
    if (!day) continue;
    const pnl = trade.gainLoss * trade.quantity;
    // The journal query orders by close time, then by stable journal number.
    day.firstTradeNo ??= trade.globalNo;
    day.count++;
    day.results[trade.result]++;
    day.profit += Math.max(0, pnl);
    day.loss += Math.min(0, pnl);
  }
  return { month, monthRange, timezone: session.mode === "TWENTY_FOUR_SEVEN" ? "UTC" : session.timezone, days };
}
