"use client";

import { useMemo, useState } from "react";
import { TablePagination } from "@/components/ui/table-pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { copy, defaultLocale } from "@/lib/i18n";
import { formatInteger, formatMoney } from "@/lib/format";

type PayoutRecord = { id: string; amount: number; share: number; received: number; evidence: string; createdAt: string | Date };
const PAGE_SIZE = 10;
const t = copy.propPractice;

/** Evidence stores the source account's day-start instant, not the browser's local date. */
export function formatPayoutTradingDay(evidence: string, timeZone: string) {
  try {
    const value: unknown = JSON.parse(evidence)?.day;
    if (typeof value !== "string" || !value) return copy.common.dash;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return copy.common.dash;
    return new Intl.DateTimeFormat(defaultLocale, { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch { return copy.common.dash; }
}

export function PropPayoutHistory({ payouts, currency, timeZone, busy = false }: {
  payouts: PayoutRecord[]; currency: string; timeZone: string; busy?: boolean;
}) {
  const [requestedPage, setPage] = useState(1);
  const sorted = useMemo(() => [...payouts].sort((a, b) =>
    (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) || b.id.localeCompare(a.id)), [payouts]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.max(1, Math.min(requestedPage, totalPages));
  const visible = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const money = (value: number) => formatMoney(value, currency);
  return <section className="space-y-4" aria-label={t.payouts}>
    <p className="text-xs text-slate-500 dark:text-muted-foreground">{t.payoutHistorySummary(formatInteger(sorted.length), formatInteger(PAGE_SIZE))}</p>
    {visible.length ? <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader><TableRow><TableHead>{t.day}</TableHead><TableHead className="text-right">{t.requested}</TableHead><TableHead className="text-right">{t.share}</TableHead><TableHead className="text-right">{t.received}</TableHead></TableRow></TableHeader>
        <TableBody>{visible.map(payout => <TableRow key={payout.id}>
          <TableCell className="whitespace-nowrap py-2 tabular-nums">{formatPayoutTradingDay(payout.evidence, timeZone)}</TableCell>
          <TableCell className="whitespace-nowrap py-2 text-right tabular-nums">{money(payout.amount)}</TableCell>
          <TableCell className="whitespace-nowrap py-2 text-right tabular-nums">{money(payout.share)}</TableCell>
          <TableCell className="whitespace-nowrap py-2 text-right tabular-nums">{money(payout.received)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div> : <p className="rounded-md border bg-slate-50 dark:bg-muted p-5 text-sm text-slate-500 dark:text-muted-foreground">{t.noPayouts}</p>}
    {sorted.length > PAGE_SIZE ? <TablePagination page={page} totalPages={totalPages} onPageChange={setPage} label={t.payoutHistoryPagination} busy={busy} /> : null}
  </section>;
}
