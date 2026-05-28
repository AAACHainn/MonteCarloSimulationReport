import type { HistogramBin, LosingStreakBin } from "./types";

export function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function percentile(sortedValues: number[], pct: number) {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (pct / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function median(values: number[]) {
  return percentile([...values].sort((a, b) => a - b), 50);
}

export function buildHistogram(values: number[], bins = 20): HistogramBin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    return [{ label: min.toFixed(2), start: min, end: max, count: values.length }];
  }

  const size = (max - min) / bins;
  const result = Array.from({ length: bins }, (_, index) => {
    const start = min + index * size;
    const end = index === bins - 1 ? max : start + size;
    return {
      label: `${start.toFixed(0)}-${end.toFixed(0)}`,
      start,
      end,
      count: 0,
    };
  });

  for (const value of values) {
    const index = Math.min(Math.floor((value - min) / size), bins - 1);
    result[index].count += 1;
  }

  return result;
}

export function buildStreakDistribution(values: number[]): LosingStreakBin[] {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([streak, count]) => ({ streak, count }));
}
