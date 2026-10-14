import type { AggregatedMarketBarData } from "./types";
import { copy } from "@/lib/i18n";

export type ChartRewindTarget = { sequence: number; timestamp: string };
export type ChartRewindRange = { minSequence: number; maxSequence: number };

/** Select a real display candle without snapping empty chart space to an endpoint. */
export function chartRewindTarget(
  bars: AggregatedMarketBarData[], logical: number | null, range: ChartRewindRange,
): ChartRewindTarget | null {
  if (logical === null || !Number.isFinite(logical) || logical < -0.5 || logical >= bars.length - 0.5) return null;
  const bar = bars[Math.round(logical)];
  if (!bar || !Number.isInteger(bar.lastSequence) || bar.lastSequence < range.minSequence || bar.lastSequence > range.maxSequence) return null;
  // Rewind to this candle's revealed close, including gaps and partially formed buckets.
  return { sequence: bar.lastSequence, timestamp: bar.timestamp };
}

/** Persist the visible progress before the server validates a newly revealed candle. */
export async function readChartRewindPoint(
  prepare: () => Promise<boolean>, locate: () => Promise<ChartRewindTarget>, signal: AbortSignal,
): Promise<ChartRewindTarget | null> {
  if (!await prepare()) throw new Error(copy.replaySessions.switchFailed);
  if (signal.aborted) return null;
  const point = await locate();
  return signal.aborted ? null : point;
}
