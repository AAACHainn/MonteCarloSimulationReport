import { TZDate } from "@date-fns/tz";
import type { TradingSessionConfig } from "./types";

const TRADING_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseTradingDate(value: string) {
  const match = TRADING_DATE.exec(value);
  if (!match) throw new RangeError("Invalid trading date.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  if (normalized !== value) throw new RangeError("Invalid trading date.");
  return { year, month, day };
}

export function addCalendarDays(value: string, count: number) {
  const { year, month, day } = parseTradingDate(value);
  return new Date(Date.UTC(year, month - 1, day + count)).toISOString().slice(0, 10);
}

export function chunkRequestDates(startDate: string, sourceIntervalSeconds: number) {
  parseTradingDate(startDate);
  const count = sourceIntervalSeconds < 300 ? 1 : 7;
  return Array.from({ length: count }, (_, index) => addCalendarDays(startDate, index));
}

export function tradingDayBounds(tradingDay: string, session: TradingSessionConfig) {
  const { year, month, day } = parseTradingDate(tradingDay);
  if (session.mode === "TWENTY_FOUR_SEVEN") {
    const start = Date.UTC(year, month - 1, day);
    return { start, end: start + 86_400_000 };
  }
  if (session.openMinute === null || session.closeMinute === null || session.openMinute >= session.closeMinute) {
    throw new RangeError("Invalid daily trading session.");
  }
  const openHour = Math.floor(session.openMinute / 60);
  const openMinute = session.openMinute % 60;
  const closeHour = Math.floor(session.closeMinute / 60);
  const closeMinute = session.closeMinute % 60;
  return {
    start: new TZDate(year, month - 1, day, openHour, openMinute, 0, session.timezone).getTime(),
    end: new TZDate(year, month - 1, day, closeHour, closeMinute, 0, session.timezone).getTime(),
  };
}

export function tradingDayForTimestamp(timestamp: string | number | Date, session: TradingSessionConfig) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid market timestamp.");
  if (session.mode === "TWENTY_FOUR_SEVEN") return date.toISOString().slice(0, 10);
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: session.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function chunkRequestBounds(startDate: string, sourceIntervalSeconds: number, session: TradingSessionConfig) {
  const dates = chunkRequestDates(startDate, sourceIntervalSeconds);
  const first = tradingDayBounds(dates[0], session);
  const last = tradingDayBounds(dates.at(-1)!, session);
  return { dates, start: first.start, end: last.end };
}
