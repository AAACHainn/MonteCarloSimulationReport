"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { copy, defaultLocale } from "@/lib/i18n";
import { formatInteger, formatMoney } from "@/lib/format";
import { netMinor, type StatisticsRound } from "@/lib/prop-practice/user-statistics";

const t = copy.propPractice.statistics;
const date = new Intl.DateTimeFormat(defaultLocale, { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
const time = new Intl.DateTimeFormat(defaultLocale, { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const money = (minor: bigint) => formatMoney(Number(minor) / 100, copy.userWallet.currency);
const colors = {
  passed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  notPassed: "border-red-200 bg-red-50 text-red-700",
  pending: "border-blue-200 bg-blue-50 text-blue-700",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
};

export function PropStatisticsTable({ rows }: { rows: StatisticsRound[] }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * size;
  const visible = rows.slice(start, start + size);
  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2"><CardTitle>{t.details}</CardTitle><CardDescription className="text-xs text-slate-600">{t.detailsHint}</CardDescription></div>
        <div className="rounded-md border bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-600">{t.count}</p>
          <p className="font-semibold tabular-nums">{t.countValue(formatInteger(rows.length))}</p>
        </div>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      {rows.length ? <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs tabular-nums text-slate-600">{t.range(formatInteger(start + 1), formatInteger(start + visible.length), formatInteger(rows.length))}</p>
          <div className="flex items-center gap-2">
            <Label htmlFor="prop-statistics-page-size" className="text-xs text-slate-600">{t.pageSize}</Label>
            <Select value={String(size)} onValueChange={value => { setSize(Number(value)); setPage(1); }}>
              <SelectTrigger id="prop-statistics-page-size" className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{[10, 20, 50, 100].map(option => <SelectItem key={option} value={String(option)}>{option}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-hidden rounded-md border">
          <Table className="min-w-[980px]">
            <TableHeader className="bg-slate-50 text-xs [&_th]:text-slate-600">
              <TableRow>
                <TableHead aria-sort="descending">{t.purchaseTime}</TableHead><TableHead>{t.session}</TableHead>
                <TableHead>{copy.propPractice.round}</TableHead><TableHead>{t.evaluation}</TableHead><TableHead>{t.phase}</TableHead>
                {[t.purchase, t.activation, t.received, t.rowNet].map(label => <TableHead key={label} className="text-right">{label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>{visible.map(row => {
              const purchaseDate = row.purchaseAt ?? row.createdAt;
              const net = netMinor(row);
              const funded = row.evaluation === "passed";
              const statusNote = row.status === "deleted" ? t.deleted : row.status === "fundedFailed" ? t.fundedFailed
                : row.status === "ended" ? t.ended : null;
              return <TableRow key={row.key}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {purchaseDate ? <>{date.format(purchaseDate)}<p className="text-xs text-slate-600">{time.format(purchaseDate)}</p></> : copy.common.dash}
                  {!row.purchaseAt && row.createdAt && <p className="text-xs text-slate-600">{t.creationTime}</p>}
                </TableCell>
                <TableCell className="max-w-48 break-words font-medium">{row.name || copy.common.dash}</TableCell>
                <TableCell className="whitespace-nowrap">{copy.propPractice.roundLabel(row.number)}</TableCell>
                <TableCell className="whitespace-nowrap"><Badge className={colors[row.evaluation]}>{t.evaluations[row.evaluation]}</Badge></TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge className={funded ? colors.passed : colors.neutral}>{funded ? t.fundedPhase : t.evaluationPhase}</Badge>
                  {statusNote && <p className="mt-1 text-xs text-slate-600">{statusNote}</p>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{money(row.purchase)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {money(row.activation)}
                  {row.activationAt && <p className="text-xs text-slate-600">{t.chargedAt(date.format(row.activationAt))}</p>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {money(row.received)}
                  {row.latestPayoutAt && <p className="text-xs text-slate-600">{t.payoutDetail(formatInteger(row.payoutCount), date.format(row.latestPayoutAt))}</p>}
                </TableCell>
                <TableCell className={`whitespace-nowrap text-right font-semibold tabular-nums ${net > 0 ? "text-emerald-700" : net < 0 ? "text-red-700" : ""}`}>{net > 0 ? "+" : ""}{money(net)}</TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </div>
        <TablePagination page={currentPage} totalPages={totalPages} onPageChange={setPage} label={t.pagination} />
      </> : <p className="rounded-md border bg-slate-50 p-6 text-sm text-slate-600">{t.empty}</p>}
    </CardContent>
  </Card>;
}
