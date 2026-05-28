import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber } from "@/lib/format";
import { copy } from "@/lib/i18n";

type TradeRow = {
  id: string;
  date: Date | null;
  symbol: string | null;
  direction: string | null;
  pnl: number | null;
  riskAmount: number | null;
  rMultiple: number;
  note: string | null;
};

export function TradeTable({ trades }: { trades: TradeRow[] }) {
  if (trades.length === 0) {
    return <p className="rounded-lg border bg-white p-6 text-sm text-slate-600">{copy.datasets.noTrades}</p>;
  }

  return (
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
        {trades.map((trade) => (
          <TableRow key={trade.id}>
            <TableCell>{trade.date ? trade.date.toISOString().slice(0, 10) : copy.common.dash}</TableCell>
            <TableCell>{trade.symbol ?? copy.common.dash}</TableCell>
            <TableCell>{trade.direction ?? copy.common.dash}</TableCell>
            <TableCell className="text-right">{trade.pnl === null ? copy.common.dash : formatMoney(trade.pnl)}</TableCell>
            <TableCell className="text-right">
              {trade.riskAmount === null ? copy.common.dash : formatMoney(trade.riskAmount)}
            </TableCell>
            <TableCell className="text-right font-mono">{formatNumber(trade.rMultiple)}</TableCell>
            <TableCell className="max-w-64 truncate">{trade.note ?? copy.common.dash}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
