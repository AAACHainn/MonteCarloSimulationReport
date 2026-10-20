import type { AggregatedMarketBarData, AggregateBarPhase, AggregateBarQuality, BarEmissionMode } from "./types";

/** Display classification changes do not invalidate or rebuild OHLCV generations. */
export const BAR_QUALITY_RULE_VERSION = 1;

/** Exhausting a file is not a time boundary. A planner may also probe only the
 * timestamp of the following source record, without revealing its price data.
 */
export function isAggregationBucketClosed(bucketEnd: number, revealedThrough: number, nextSourceTime?: number) {
  return revealedThrough >= bucketEnd || (nextSourceTime !== undefined && nextSourceTime >= bucketEnd);
}

export function barEmissionMode(value?: string | null): BarEmissionMode {
  return value === "DENSE" || value === "TRADE_DRIVEN" ? value : "UNKNOWN";
}

/** Closing a time bucket and verifying its source coverage are independent. */
export function setAggregateState(bar: AggregatedMarketBarData, phase: AggregateBarPhase, mode: BarEmissionMode) {
  const quality: AggregateBarQuality = bar.confirmedGap || bar.sourceCount > bar.expectedCount
    || (phase === "CLOSED" && mode === "DENSE" && bar.sourceCount < bar.expectedCount) ? "GAP"
    : mode === "UNKNOWN" && bar.sourceCount < bar.expectedCount ? "UNKNOWN" : "NORMAL";
  bar.phase = phase;
  bar.quality = quality;
  bar.emissionMode = mode;
  // Kept for existing export/annotation consumers. COMPLETE means closed, not verified feed integrity.
  bar.status = quality === "GAP" ? "INCOMPLETE" : phase === "CLOSED" ? "COMPLETE" : "FORMING";
  return bar;
}

export function closeAggregatedBar(bar: AggregatedMarketBarData) {
  return setAggregateState({ ...bar }, "CLOSED", barEmissionMode(bar.emissionMode));
}

export function aggregateHasGap(bar: AggregatedMarketBarData) {
  return bar.quality === "GAP" || (bar.quality === undefined && bar.status === "INCOMPLETE");
}

export function aggregatePhase(bar: AggregatedMarketBarData): AggregateBarPhase {
  return bar.phase ?? (bar.status === "FORMING" ? "FORMING" : "CLOSED");
}
