import type { AggregatedMarketBarData } from "@/lib/market-replay/types";

export type ChartMeasurementStats = {
  priceChange: number;
  percentageChange: number;
  tickChange: number;
  barCount: number;
  elapsedMilliseconds: number;
  volume: number | null;
};

export type ChartMeasurementGeometry = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  middleX: number;
  middleY: number;
};

export function calculateChartMeasurementGeometry({
  startX,
  startY,
  endX,
  endY,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}): ChartMeasurementGeometry {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const right = Math.max(startX, endX);
  const bottom = Math.max(startY, endY);

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    middleX: left + (right - left) / 2,
    middleY: top + (bottom - top) / 2,
  };
}

export function calculateChartMeasurement({
  bars,
  startIndex,
  endIndex,
  startPrice,
  endPrice,
  priceTickSize,
  displayIntervalSeconds,
}: {
  bars: AggregatedMarketBarData[];
  startIndex: number;
  endIndex: number;
  startPrice: number;
  endPrice: number;
  priceTickSize: number;
  displayIntervalSeconds: number;
}): ChartMeasurementStats {
  const priceChange = endPrice - startPrice;
  const percentageChange = startPrice === 0 ? 0 : (priceChange / startPrice) * 100;
  const tickChange = priceTickSize > 0 ? Math.round(priceChange / priceTickSize) : 0;
  const firstIndex = Math.min(startIndex, endIndex);
  const lastIndex = Math.max(startIndex, endIndex);
  const barCount = lastIndex - firstIndex;
  const startTime = Date.parse(bars[startIndex]?.timestamp ?? "");
  const endTime = Date.parse(bars[endIndex]?.timestamp ?? "");
  const elapsedMilliseconds = Number.isFinite(startTime) && Number.isFinite(endTime)
    ? Math.abs(endTime - startTime)
    : barCount * Math.max(0, displayIntervalSeconds) * 1_000;
  // The anchor bar marks the beginning of the range. Count the bars reached after
  // that boundary through the opposite endpoint so volume and barCount agree.
  const barsInRange = bars.slice(firstIndex + 1, lastIndex + 1);
  const completeDataRange = firstIndex >= -1 && lastIndex < bars.length && barsInRange.length === barCount;
  const volume = completeDataRange && barsInRange.length > 0 && barsInRange.every((bar) => bar.volume !== null)
    ? barsInRange.reduce((sum, bar) => sum + (bar.volume ?? 0), 0)
    : null;

  return {
    priceChange,
    percentageChange,
    tickChange,
    barCount,
    elapsedMilliseconds,
    volume,
  };
}

export function measurementDurationParts(milliseconds: number) {
  let remainingSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const days = Math.floor(remainingSeconds / 86_400);
  remainingSeconds %= 86_400;
  const hours = Math.floor(remainingSeconds / 3_600);
  remainingSeconds %= 3_600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return { days, hours, minutes, seconds };
}
