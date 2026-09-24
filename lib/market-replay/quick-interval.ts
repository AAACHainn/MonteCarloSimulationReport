import { MAX_DISPLAY_INTERVAL_SECONDS, isValidDisplayInterval } from "@/lib/market-replay/types";

export const QUICK_INTERVAL_UNITS = ["s", "m", "h"] as const;

export type QuickIntervalUnit = (typeof QUICK_INTERVAL_UNITS)[number];

export type QuickIntervalRange = {
  minimum: number;
  maximum: number;
  step: number;
};

const UNIT_SECONDS: Record<QuickIntervalUnit, number> = {
  s: 1,
  m: 60,
  h: 3_600,
};

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

export function quickIntervalUnitSeconds(unit: QuickIntervalUnit) {
  return UNIT_SECONDS[unit];
}

export function getQuickIntervalRange(
  sourceIntervalSeconds: number,
  unit: QuickIntervalUnit,
): QuickIntervalRange | null {
  if (!Number.isInteger(sourceIntervalSeconds) || sourceIntervalSeconds < 1) return null;
  const unitSeconds = quickIntervalUnitSeconds(unit);
  const step = sourceIntervalSeconds / greatestCommonDivisor(sourceIntervalSeconds, unitSeconds);
  const maximum = Math.floor(MAX_DISPLAY_INTERVAL_SECONDS / unitSeconds / step) * step;
  if (maximum < step) return null;
  return { minimum: step, maximum, step };
}

export function parseQuickInterval(
  value: string,
  unit: QuickIntervalUnit,
  sourceIntervalSeconds: number,
) {
  if (!/^\d+$/.test(value.trim())) return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 1) return null;
  const seconds = amount * quickIntervalUnitSeconds(unit);
  return isValidDisplayInterval(sourceIntervalSeconds, seconds) ? seconds : null;
}
