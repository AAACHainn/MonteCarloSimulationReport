import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber } from "@/lib/format";

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
    return <p className="rounded-lg border bg-white p-6 text-sm text-slate-600">No trades uploaded yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Symbol</TableHead>
          <TableHead>Direction</TableHead>
          <TableHead className="text-right">PnL</TableHead>
          <TableHead className="text-right">Risk</TableHead>
          <TableHead className="text-right">R</TableHead>
          <TableHead>Note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((trade) => (
          <TableRow key={trade.id}>
            <TableCell>{trade.date ? trade.date.toISOString().slice(0, 10) : "-"}</TableCell>
            <TableCell>{trade.symbol ?? "-"}</TableCell>
            <TableCell>{trade.direction ?? "-"}</TableCell>
            <TableCell className="text-right">{trade.pnl === null ? "-" : formatMoney(trade.pnl)}</TableCell>
            <TableCell className="text-right">
              {trade.riskAmount === null ? "-" : formatMoney(trade.riskAmount)}
            </TableCell>
            <TableCell className="text-right font-mono">{formatNumber(trade.rMultiple)}</TableCell>
            <TableCell className="max-w-64 truncate">{trade.note ?? "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
