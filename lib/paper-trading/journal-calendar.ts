import { addCalendarDays } from "@/lib/market-replay/chunks";
import type { ReplayJournalEntryData } from "./types";

export type JournalDayTotals = {
  count: number;
  profit: number;
  loss: number;
  results: Record<ReplayJournalEntryData["result"], number>;
};

export function emptyJournalDayTotals(): JournalDayTotals {
  return { count: 0, profit: 0, loss: 0, results: { W: 0, L: 0, BE: 0 } };
}

export function parseJournalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1000-01-01" || value > "9998-12-31") return null;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function journalCalendarWeeks(month: string) {
  const first = month + "-01";
  const date = parseJournalDate(first);
  if (!date) return [];
  const start = addCalendarDays(first, -((date.getUTCDay() + 6) % 7));
  const weeks: string[][] = [];
  for (let monday = start; monday.slice(0, 7) <= month; monday = addCalendarDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, day) => addCalendarDays(monday, day)));
  }
  return weeks;
}

export function sumJournalDays(days: Iterable<JournalDayTotals>): JournalDayTotals {
  const totals = emptyJournalDayTotals();
  for (const day of days) {
    totals.count += day.count;
    totals.profit += day.profit;
    totals.loss += day.loss;
    totals.results.W += day.results.W;
    totals.results.L += day.results.L;
    totals.results.BE += day.results.BE;
  }
  return totals;
}
