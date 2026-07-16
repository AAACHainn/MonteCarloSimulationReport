import { parse } from "csv-parse/sync";
import { copy } from "@/lib/i18n";
import { validateStrategyCode } from "@/lib/trade-journal/strategy-code";

export type ParsedTrade = {
  date: Date | null;
  symbol: string | null;
  direction: string | null;
  pnl: number | null;
  riskAmount: number | null;
  rMultiple: number;
  note: string | null;
  strategyCode: string | null;
};

export type ParseTradesResult = {
  trades: ParsedTrade[];
  rejectedRows: Array<{ row: number; reason: string }>;
};

type CsvRow = Record<string, string | undefined>;

function normalizeKey(key: string) {
  return key.trim().toLowerCase();
}

function get(row: CsvRow, key: string) {
  const foundKey = Object.keys(row).find((candidate) => normalizeKey(candidate) === key.toLowerCase());
  return foundKey ? row[foundKey]?.trim() : undefined;
}

function parseNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseTradesCsv(csv: string): ParseTradesResult {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as CsvRow[];

  const trades: ParsedTrade[] = [];
  const rejectedRows: ParseTradesResult["rejectedRows"] = [];

  rows.forEach((row, index) => {
    const strategyCodeValidation = validateStrategyCode(get(row, "strategyCode") ?? "");
    if (!strategyCodeValidation.valid) {
      rejectedRows.push({
        row: index + 2,
        reason: strategyCodeValidation.error,
      });
      return;
    }

    const pnl = parseNumber(get(row, "pnl"));
    const riskAmount = parseNumber(get(row, "riskAmount"));
    const providedRMultiple = parseNumber(get(row, "rMultiple"));
    const rMultiple =
      providedRMultiple ?? (pnl !== null && riskAmount !== null && riskAmount !== 0 ? pnl / riskAmount : null);

    if (rMultiple === null || !Number.isFinite(rMultiple)) {
      rejectedRows.push({
        row: index + 2,
        reason: copy.api.missingR,
      });
      return;
    }

    trades.push({
      date: parseDate(get(row, "date")),
      symbol: get(row, "symbol") || null,
      direction: get(row, "direction") || null,
      pnl,
      riskAmount,
      rMultiple,
      note: get(row, "note") || null,
      strategyCode: strategyCodeValidation.normalized || null,
    });
  });

  return { trades, rejectedRows };
}
