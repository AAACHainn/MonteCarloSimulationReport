"use client";

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { copy, defaultLocale } from "@/lib/i18n";
import { formatInteger, formatMoney } from "@/lib/format";
import type { PropStage } from "@/lib/prop-practice/rules";

const PAGE_SIZE = 10;
const t = copy.propPractice;

export function PropDailyLedger({ stages, currency, timeZone, busy = false }: {
  stages: PropStage[]; currency: string; timeZone: string; busy?: boolean;
}) {
  const [requestedPage, setPage] = useState(1);
  const rows = useMemo(() => stages.flatMap((stage, stageIndex) => stage.days.map((day, dayIndex) => ({
    day, kind: stage.kind, stageIndex, dayIndex,
  }))).sort((a, b) => new Date(b.day.day).getTime() - new Date(a.day.day).getTime()
    || b.stageIndex - a.stageIndex || b.dayIndex - a.dayIndex), [stages]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.max(1, Math.min(requestedPage, totalPages));
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return <section className="space-y-4" aria-label={t.dailyLedger}>
    <p className="text-xs text-slate-500 dark:text-muted-foreground">{t.dailyLedgerSummary(formatInteger(rows.length), formatInteger(PAGE_SIZE))}</p>
    {visible.length ? <Table>
      <TableHeader><TableRow><TableHead aria-sort="descending">{t.day}</TableHead><TableHead>{t.pause}</TableHead><TableHead className="text-right">{t.dayProfit}</TableHead><TableHead className="text-right">{t.balance}</TableHead></TableRow></TableHeader>
      <TableBody>{visible.map(({ day, kind, stageIndex, dayIndex }) => <TableRow key={`${stageIndex}:${dayIndex}`}>
        <TableCell className="whitespace-nowrap py-2 tabular-nums">{new Date(day.day).toLocaleString(defaultLocale, { timeZone })} · {kind === "EVALUATION" ? t.evaluation : t.funded}</TableCell>
        <TableCell className="py-2">{day.stageEnded && !day.settled ? t.stageEnded : day.settled ? t.settled : t.pendingSettlement}</TableCell>
        <TableCell className="whitespace-nowrap py-2 text-right tabular-nums">{formatMoney(day.endRawNet - day.startRawNet, currency)}</TableCell>
        <TableCell className="whitespace-nowrap py-2 text-right tabular-nums">{formatMoney(day.balance, currency)}</TableCell>
      </TableRow>)}</TableBody>
    </Table> : <p className="rounded-md border bg-slate-50 dark:bg-muted p-5 text-sm text-slate-500 dark:text-muted-foreground">{t.noDailyLedger}</p>}
    {rows.length > PAGE_SIZE ? <TablePagination page={page} totalPages={totalPages} onPageChange={setPage} label={t.dailyLedgerPagination} busy={busy} /> : null}
  </section>;
}
