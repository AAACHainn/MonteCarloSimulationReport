import { TickMarkType, type Time, type UTCTimestamp } from "lightweight-charts";
import { utcDateParts } from "./display-timezone";
import type { AggregatedMarketBarData } from "./types";
import { aggregateHasGap } from "./bar-quality";

export function canUpdateReplayTail(previous: AggregatedMarketBarData[], next: AggregatedMarketBarData[],
  previousRevision: string, nextRevision: string) {
  return previousRevision === nextRevision && previous.length > 0 && next.length >= previous.length
    && previous[0].timestamp === next[0]?.timestamp
    && previous.at(-1)?.timestamp === next[previous.length - 1]?.timestamp;
}

export function formatChartTick(time: Time, type: TickMarkType, offset: number) {
  if (typeof time !== "number") return String(time);
  const p = utcDateParts(time * 1000, offset);
  if (type === TickMarkType.Year) return p.year;
  if (type === TickMarkType.Month) return `${p.year}/${p.month}`;
  if (type === TickMarkType.DayOfMonth) return `${p.month}/${p.day}`;
  return type === TickMarkType.TimeWithSeconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
}
export function chartCandleData(bar: AggregatedMarketBarData) {
  return { time: Math.floor(new Date(bar.timestamp).getTime() / 1000) as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    ...(aggregateHasGap(bar) ? { borderColor: "#f59e0b", wickColor: "#f59e0b" } : {}) };
}
export function chartVolumeData(bar: AggregatedMarketBarData, up = "rgba(22,163,74,.45)", down = "rgba(220,38,38,.45)") {
  return { time: Math.floor(new Date(bar.timestamp).getTime() / 1000) as UTCTimestamp, value: bar.volume ?? 0,
    color: aggregateHasGap(bar) ? "rgba(245,158,11,.5)" : bar.close >= bar.open ? up : down };
}
