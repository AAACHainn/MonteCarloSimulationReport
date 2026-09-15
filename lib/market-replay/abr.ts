import { ABR_LENGTH_MAX, ABR_LENGTH_MIN, type MarketBarData } from "./types";

export type AbrPoint = {
  sequence: number;
  value: number;
};

function assertLength(length: number) {
  if (!Number.isInteger(length) || length < ABR_LENGTH_MIN || length > ABR_LENGTH_MAX) {
    throw new RangeError(`ABR length must be an integer between ${ABR_LENGTH_MIN} and ${ABR_LENGTH_MAX}.`);
  }
}

/**
 * Average Bar Range: the arithmetic mean of |high - low| over the latest
 * `length` bars, including the bar at each returned sequence.
 */
export function calculateAbrSeries(
  bars: Pick<MarketBarData, "high" | "low">[],
  length: number,
  throughSequence: number,
  fromSequence = 0,
) {
  assertLength(length);
  const lastSequence = Math.min(Math.trunc(throughSequence), bars.length - 1);
  if (lastSequence < length - 1) {
    return { points: [] as AbrPoint[], lastValue: null as number | null };
  }

  const ranges: number[] = [];
  const points: AbrPoint[] = [];
  let rollingSum = 0;
  for (let sequence = 0; sequence <= lastSequence; sequence += 1) {
    const range = Math.abs(bars[sequence].high - bars[sequence].low);
    ranges.push(range);
    rollingSum += range;
    if (sequence >= length) rollingSum -= ranges[sequence - length];
    if (sequence >= length - 1 && sequence >= fromSequence) {
      points.push({ sequence, value: rollingSum / length });
    }
  }

  return { points, lastValue: rollingSum / length };
}

/** Latest ABR without allocating or scanning the complete replay history. */
export function calculateLatestAbr(
  warmupBars: Pick<MarketBarData, "high" | "low">[],
  bars: Pick<MarketBarData, "high" | "low">[],
  length: number,
) {
  assertLength(length);
  if (warmupBars.length + bars.length < length) return null;
  let sum = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const combinedIndex = warmupBars.length + bars.length - 1 - offset;
    const bar = combinedIndex < warmupBars.length
      ? warmupBars[combinedIndex]
      : bars[combinedIndex - warmupBars.length];
    sum += Math.abs(bar.high - bar.low);
  }
  return sum / length;
}
