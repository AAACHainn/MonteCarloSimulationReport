import { datasetSession, type DatasetAggregationRecord } from "./dataset";
import type { DisplaySession, TradingSessionConfig } from "./types";

const CME_EQUITY_INDEX_ROOTS = ["MES", "MNQ", "MYM", "M2K", "RTY", "ES", "NQ", "YM"] as const;
const QUARTERLY_CONTRACT = /^[HMUZ]\d{1,4}$/;

export function cmeEquityIndexRoot(symbol: string) {
  const normalized = symbol.trim().toUpperCase().split(":").at(-1) ?? "";
  for (const root of CME_EQUITY_INDEX_ROOTS) {
    if (!normalized.startsWith(root)) continue;
    const suffix = normalized.slice(root.length);
    if (normalized === root || /^[12]!$/.test(suffix) || QUARTERLY_CONTRACT.test(suffix)) return root;
  }
  return null;
}

export function availableDisplaySessions(symbol: string): DisplaySession[] {
  return cmeEquityIndexRoot(symbol) ? ["ETH", "RTH"] : ["ETH"];
}

export function resolveDisplaySession(
  dataset: DatasetAggregationRecord & { symbol: string },
  displaySession: DisplaySession,
): TradingSessionConfig | null {
  if (!cmeEquityIndexRoot(dataset.symbol)) {
    return displaySession === "RTH" ? null : datasetSession(dataset);
  }
  return displaySession === "RTH"
    ? {
        mode: "DAILY_SESSION",
        timezone: "America/Chicago",
        openMinute: 8 * 60 + 30,
        closeMinute: 15 * 60 + 15,
        weekdays: [1, 2, 3, 4, 5],
      }
    : {
        mode: "OVERNIGHT_SESSION",
        timezone: "America/Chicago",
        openMinute: 17 * 60,
        closeMinute: 16 * 60,
        weekdays: [1, 2, 3, 4, 5],
      };
}
