import { EMA_LENGTH_MAX, EMA_LENGTH_MIN, type MarketBarData } from "./types";

export type EmaPoint = {
  sequence: number;
  value: number;
};

function assertLength(length: number) {
  if (!Number.isInteger(length) || length < EMA_LENGTH_MIN || length > EMA_LENGTH_MAX) {
    throw new RangeError(`EMA length must be an integer between ${EMA_LENGTH_MIN} and ${EMA_LENGTH_MAX}.`);
  }
}

export function nextEma(previousValue: number, close: number, length: number) {
  assertLength(length);
  const alpha = 2 / (length + 1);
  return close * alpha + previousValue * (1 - alpha);
}

export function calculateEmaSeries(
  bars: Pick<MarketBarData, "close">[],
  length: number,
  throughSequence: number,
  fromSequence = 0,
) {
  assertLength(length);
  const lastSequence = Math.min(Math.trunc(throughSequence), bars.length - 1);
  if (lastSequence < length - 1) {
    return { points: [] as EmaPoint[], lastValue: null as number | null };
  }

  let value = 0;
  for (let sequence = 0; sequence < length; sequence += 1) {
    value += bars[sequence].close;
  }
  value /= length;

  const points: EmaPoint[] = [];
  if (length - 1 >= fromSequence) points.push({ sequence: length - 1, value });

  for (let sequence = length; sequence <= lastSequence; sequence += 1) {
    value = nextEma(value, bars[sequence].close, length);
    if (sequence >= fromSequence) points.push({ sequence, value });
  }

  return { points, lastValue: value };
}
