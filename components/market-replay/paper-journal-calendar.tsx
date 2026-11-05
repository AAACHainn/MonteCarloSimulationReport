"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CalendarPicker } from "@/components/ui/calendar-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInteger, formatMoney } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { journalCalendarWeeks, sumJournalDays } from "@/lib/paper-trading/journal-calendar";
import type { JournalDayTotals } from "@/lib/paper-trading/journal-calendar";
import { replayJournalExpressionFilterKeys, type ReplayJournalFilters } from "@/lib/paper-trading/journal-filters";
import { replayJournalTradeHref } from "@/lib/paper-trading/journal-links";
import { useReplayFetch, useReplaySession } from "./replay-session-context";

type CalendarDay = JournalDayTotals & { date: string; firstTradeNo: number | null };
type Calendar = {
  month: string;
  monthRange: { first: string; last: string } | null;
  timezone: string;
  currency: string | null;
  journalSessionId: string | null;
  days: CalendarDay[];
};
const t = copy.paperTrading.journalCalendar;

function TradeCount({ count }: { count: number }) {
  return <span className="shrink-0 text-xs tabular-nums text-slate-600 dark:text-secondary-text">{t.count(formatInteger(count))}</span>;
}

function OutcomeCounts({ results }: { results: JournalDayTotals["results"] }) {
  return <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-xs tabular-nums text-slate-600 dark:text-secondary-text">
    <span className="whitespace-nowrap">{copy.paperTrading.journalTakeProfitTrades} <strong className="font-semibold text-emerald-700 dark:text-positive">{t.count(formatInteger(results.W))}</strong></span>
    <span className="whitespace-nowrap">{copy.paperTrading.journalStopLossTrades} <strong className="font-semibold text-red-700 dark:text-negative">{t.count(formatInteger(results.L))}</strong></span>
    <span className="whitespace-nowrap">{copy.paperTrading.journalBreakEvenTrades} <strong className="font-semibold">{t.count(formatInteger(results.BE))}</strong></span>
  </div>;
}

function NetPnl({ totals, currency }: { totals: JournalDayTotals; currency: string | null }) {
  if (!currency) return null;
  const rawNet = totals.profit + totals.loss;
  const net = Math.abs(rawNet) < 0.005 ? 0 : rawNet;
  const tone = net > 0 ? "text-emerald-700 dark:text-positive" : net < 0 ? "text-red-700 dark:text-negative" : "text-slate-950 dark:text-foreground";
  return <p className="mt-2 text-xs text-slate-600 dark:text-secondary-text">{t.net}{" "}
    <span className={`break-words text-sm font-semibold tabular-nums ${tone}`}>{net > 0 ? "+" : ""}{formatMoney(net, currency)}</span>
  </p>;
}

function dayTone(net: number, muted: boolean) {
  if (net >= 0.005) return "bg-emerald-50 dark:bg-positive-background";
  if (net <= -0.005) return "bg-red-50 dark:bg-negative-background";
  return muted ? "bg-slate-50 dark:bg-muted" : "bg-white dark:bg-card";
}

export function PaperJournalCalendar({ datasetId, month, onMonthChange, filters, journalSessionId }: {
  datasetId: string;
  month: string;
  onMonthChange: (month: string) => void;
  filters: ReplayJournalFilters;
  journalSessionId?: string;
}) {
  const fetch = useReplayFetch();
  const session = useReplaySession();
  const [retry, setRetry] = useState(0);
  const params = new URLSearchParams({ scope: "history", view: "calendar" });
  if (month) params.set("month", month);
  if (journalSessionId) params.set("sessionId", journalSessionId);
  for (const key of replayJournalExpressionFilterKeys) if (filters[key]) params.set(key, filters[key]);
  for (const key of ["directions", "setupOptionIds", "checklistUsed", "tradeReasonIds", "results"] as const) {
    for (const value of filters[key]) params.append(key, value);
  }
  const url = `/api/market-datasets/${datasetId}/paper-journal?${params}`;
  const request = useMemo(() => ({ url, fetch, retry }), [url, fetch, retry]);
  const [response, setResponse] = useState<{
    request: typeof request; data: Calendar | null; failed: boolean;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await request.fetch(request.url, { signal: controller.signal });
        if (!response.ok) throw new Error(t.failed);
        const data: Calendar = await response.json();
        if (controller.signal.aborted) return;
        setResponse({ request, data, failed: false });
      } catch {
        if (!controller.signal.aborted) {
          setResponse(previous => ({ request, data: previous?.data ?? null, failed: true }));
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [request]);

  const current = response?.request === request ? response : null;
  const loading = current === null;
  const error = current?.failed;
  const calendar = response?.data;
  const range = calendar?.monthRange;
  const selectedMonth = range && month >= range.first && month <= range.last ? month : calendar?.month ?? "";
  const data = current?.data;
  const days = new Map(data?.days.map(day => [day.date, day]));

  return <section className="space-y-3" aria-busy={loading}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CalendarPicker mode="month" value={selectedMonth} minMonth={range?.first} maxMonth={range?.last}
        disabled={!range} onChange={onMonthChange} />
      <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-secondary-text">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-emerald-200 dark:border-positive/40 bg-emerald-50 dark:bg-positive-background" aria-hidden="true" />{t.profit}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-red-200 dark:border-negative/40 bg-red-50 dark:bg-negative-background" aria-hidden="true" />{t.loss}</span>
      </div>
    </div>
    {calendar && <p className="flex items-start gap-2 text-xs text-slate-600 dark:text-secondary-text"><Info className="h-4 w-4 shrink-0" aria-hidden="true" />{t.description(calendar.timezone)}</p>}
    {loading && <p role="status" className="text-sm text-slate-600 dark:text-secondary-text">{t.loading}</p>}
    {error && <div className="flex items-center gap-3"><p role="alert" className="text-sm text-red-700 dark:text-negative">{t.failed}</p>
      <Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>{t.retry}</Button></div>}
    {data && !error && <>
      {!data.days.some(day => day.count) && <p className="text-sm text-slate-600 dark:text-secondary-text">{t.empty}</p>}
      <div className="overflow-hidden rounded-lg border bg-white dark:bg-card">
        <Table className="min-w-[60rem] table-fixed">
          <TableHeader className="bg-blue-50 dark:bg-info-background"><TableRow className="hover:bg-transparent">
            {t.weekdays.map(day => <TableHead key={day} scope="col">{day}</TableHead>)}
            <TableHead scope="col" className="border-l">{t.weekTotal}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{journalCalendarWeeks(selectedMonth).map(week => {
            const totals = sumJournalDays(week.flatMap(date => days.get(date) ?? []));
            return <TableRow key={week[0]} className="hover:bg-transparent">
              {week.map((date, index) => {
                const day = days.get(date);
                const href = data.journalSessionId && day?.firstTradeNo != null
                  ? replayJournalTradeHref(datasetId, data.journalSessionId, day.firstTradeNo, {
                      month: selectedMonth, allRounds: session?.propRoundNumber === 0,
                    })
                  : null;
                const inMonth = date.startsWith(selectedMonth);
                const dayNumber = inMonth ? date.slice(-2) : `${Number(date.slice(5, 7))}/${Number(date.slice(-2))}`;
                const className = inMonth ? "font-semibold text-slate-800 dark:text-foreground" : "font-medium text-slate-500 dark:text-muted-foreground";
                const dateButtonClass = `h-auto px-1 py-0.5 bg-white dark:bg-card underline underline-offset-4 ${className}`;
                return <TableCell key={date} className={`h-24 border-r p-2.5 align-top ${dayTone(day ? day.profit + day.loss : 0, !inMonth || index >= 5)}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    {href
                      ? <Button asChild variant="ghost" className={dateButtonClass}><Link href={href} prefetch={false} aria-label={t.openDay(date)}>{dayNumber}</Link></Button>
                      : <time dateTime={date} className={className}>{dayNumber}</time>}
                    {day && day.count > 0 && <TradeCount count={day.count} />}
                  </div>
                  {day && day.count > 0 && <>
                    <OutcomeCounts results={day.results} />
                    <NetPnl totals={day} currency={data.currency} />
                  </>}
                </TableCell>;
              })}
              <TableCell className={`p-2.5 align-top ${dayTone(totals.profit + totals.loss, true)}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-xs font-semibold tabular-nums">{week[0].slice(5)} – {week[6].slice(5)}</span>
                  <TradeCount count={totals.count} />
                </div>
                {totals.count > 0 && <OutcomeCounts results={totals.results} />}
                <NetPnl totals={totals} currency={data.currency} />
              </TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </div>
    </>}
  </section>;
}
