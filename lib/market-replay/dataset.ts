import type { MarketBarData, TradingSessionConfig } from "./types";
import { parseSourceInterval } from "./types";

export type DatasetAggregationRecord = {
  timeframe: string;
  timezone: string;
  sourceIntervalSeconds: number | null;
  sessionMode: string;
  sessionOpenMinute: number | null;
  sessionCloseMinute: number | null;
  tradingWeekdays: string | number[];
};

export function datasetSourceInterval(dataset: Pick<DatasetAggregationRecord, "sourceIntervalSeconds" | "timeframe">) {
  return dataset.sourceIntervalSeconds ?? parseSourceInterval(dataset.timeframe);
}

export function datasetSession(dataset: DatasetAggregationRecord): TradingSessionConfig {
  return {
    mode: dataset.sessionMode === "DAILY_SESSION" ? "DAILY_SESSION" : "TWENTY_FOUR_SEVEN",
    timezone: dataset.timezone,
    openMinute: dataset.sessionOpenMinute,
    closeMinute: dataset.sessionCloseMinute,
    weekdays: (Array.isArray(dataset.tradingWeekdays) ? dataset.tradingWeekdays : dataset.tradingWeekdays.split(",").map(Number))
      .filter((value) => value >= 1 && value <= 7),
  };
}

export function serializeSourceBar(bar: {
  sequence: number; timestamp: Date; open: number; high: number; low: number; close: number; volume: number | null;
}): MarketBarData {
  return { ...bar, timestamp: bar.timestamp.toISOString() };
}
