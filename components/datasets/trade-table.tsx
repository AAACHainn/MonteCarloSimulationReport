import { TradeTableClient, type SerializableTradeRow } from "@/components/datasets/trade-table-client";
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

  const serializableTrades: SerializableTradeRow[] = trades.map((trade) => ({
    ...trade,
    date: trade.date ? trade.date.toISOString().slice(0, 10) : null,
  }));

  return <TradeTableClient trades={serializableTrades} />;
}
