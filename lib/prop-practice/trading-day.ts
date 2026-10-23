import { TZDate } from "@date-fns/tz";
import { getAggregationBucket } from "@/lib/market-replay/aggregation";
import type { TradingSessionConfig } from "@/lib/market-replay/types";

export type PropCalendar = { session: TradingSessionConfig; sourceSeconds: number };
/** The authoritative source session is snapshotted at creation, independent of chart settings. */
function resolveTradingDay(timestamp: string | Date, calendar: PropCalendar) {
  const ms = new Date(timestamp).getTime(), { session, sourceSeconds } = calendar;
  let bounds: { start: number; end: number } | null;
  if (session.mode === "TWENTY_FOUR_SEVEN") {
    const local = new TZDate(ms, session.timezone);
    bounds = { start: new TZDate(local.getFullYear(), local.getMonth(), local.getDate(), 0, 0, 0, session.timezone).getTime(),
      end: new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + 1, 0, 0, 0, session.timezone).getTime() };
  } else bounds = getAggregationBucket(ms, sourceSeconds, 86400, session);
  if (!bounds || ms + sourceSeconds * 1000 > bounds.end) return null;
  return { day: new Date(bounds.start).toISOString(), end: bounds.end, eod: ms + sourceSeconds * 1000 === bounds.end };
}
export function propTradingDay(timestamp: string | Date, calendar: PropCalendar) {
  try { return resolveTradingDay(timestamp, calendar); }
  catch { return null; }
}
