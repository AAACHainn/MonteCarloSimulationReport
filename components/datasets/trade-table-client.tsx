"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber } from "@/lib/format";
import { copy } from "@/lib/i18n";

export type SerializableTradeRow = {
  id: string;
  date: string | null;
  symbol: string | null;
  direction: string | null;
  pnl: number | null;
  riskAmount: number | null;
  rMultiple: number;
  note: string | null;
};

const pageSizeOptions = Array.from({ length: 10 }, (_, index) => (index + 1) * 10);

export function TradeTableClient({ trades }: { trades: SerializableTradeRow[] }) {
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(trades.length / pageSize));

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  const pagedTrades = useMemo(() => {
    const start = (page - 1) * pageSize;
    return trades.slice(start, start + pageSize);
  }, [page, pageSize, trades]);

  const startRow = (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, trades.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600">
          {copy.datasets.pagination.range
            .replace("{start}", startRow.toLocaleString("zh-CN"))
            .replace("{end}", endRow.toLocaleString("zh-CN"))
            .replace("{total}", trades.length.toLocaleString("zh-CN"))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">{copy.datasets.pagination.rowsPerPage}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{copy.datasets.table.date}</TableHead>
            <TableHead>{copy.datasets.table.symbol}</TableHead>
            <TableHead>{copy.datasets.table.direction}</TableHead>
            <TableHead className="text-right">{copy.datasets.table.pnl}</TableHead>
            <TableHead className="text-right">{copy.datasets.table.risk}</TableHead>
            <TableHead className="text-right">{copy.datasets.table.r}</TableHead>
            <TableHead>{copy.datasets.table.note}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagedTrades.map((trade) => (
            <TableRow key={trade.id}>
              <TableCell>{trade.date ?? copy.common.dash}</TableCell>
              <TableCell>{trade.symbol ?? copy.common.dash}</TableCell>
              <TableCell>{trade.direction ?? copy.common.dash}</TableCell>
              <TableCell className="text-right">
                {trade.pnl === null ? copy.common.dash : formatMoney(trade.pnl)}
              </TableCell>
              <TableCell className="text-right">
                {trade.riskAmount === null ? copy.common.dash : formatMoney(trade.riskAmount)}
              </TableCell>
              <TableCell className="text-right font-mono">{formatNumber(trade.rMultiple)}</TableCell>
              <TableCell className="max-w-64 truncate">{trade.note ?? copy.common.dash}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600">
          {copy.datasets.pagination.page
            .replace("{page}", page.toLocaleString("zh-CN"))
            .replace("{totalPages}", totalPages.toLocaleString("zh-CN"))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            {copy.datasets.pagination.previous}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
          >
            {copy.datasets.pagination.next}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
