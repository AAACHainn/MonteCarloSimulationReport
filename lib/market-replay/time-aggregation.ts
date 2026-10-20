import { getAggregationBucket, getAdjacentAggregationBucketStart } from "./aggregation";
import { availableDisplaySessions, resolveDisplaySession } from "./chart-sessions";
import { datasetSourceInterval, type DatasetAggregationRecord } from "./dataset";
import type { TradingSessionConfig } from "./types";

export const AGGREGATION_RULE_VERSION = 1;
export const BASE_AGGREGATION_INTERVALS = [60, 300, 900] as const;
export type AggregationDataset = DatasetAggregationRecord & { symbol: string };
export type AggregationLayer = { scope: string; seconds: number; session: TradingSessionConfig };
export type AggregationInput = { sequence: number; timestamp: Date; open: number; high: number; low: number; close: number; volume: number | null };
export type TimeSummary = {
  scope: string; intervalSeconds: number; bucketStart: string; bucketEnd: string;
  firstSequence: number; lastSequence: number; firstTime: string; lastTime: string;
  open: number; high: number; low: number; close: number; volume: number | null;
  volumeCount: number; sourceCount: number; expectedCount: number;
};
export type AggregationTail = Record<string, TimeSummary>;

export function aggregationSessionKey(session: TradingSessionConfig) {
  return JSON.stringify([session.mode, session.timezone, session.openMinute, session.closeMinute, [...session.weekdays].sort((a, b) => a - b)]);
}

export function aggregationFingerprint(dataset: AggregationDataset) {
  return JSON.stringify({ source: datasetSourceInterval(dataset), layers: aggregationLayers(dataset) });
}

export function aggregationLayers(dataset: AggregationDataset): AggregationLayer[] {
  const source = datasetSourceInterval(dataset);
  if (!source) return [];
  const continuous: TradingSessionConfig = { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1, 2, 3, 4, 5, 6, 7] };
  const layers: AggregationLayer[] = BASE_AGGREGATION_INTERVALS.map((seconds) => ({ scope: "BASE", seconds, session: continuous }));
  for (const scope of availableDisplaySessions(dataset.symbol)) {
    const session = resolveDisplaySession(dataset, scope)!;
    for (const seconds of scope === "ETH" ? [3600, 14400] : [3600]) layers.push({ scope, seconds, session });
  }
  return layers.filter((layer) => layer.seconds > source && layer.seconds % source === 0);
}

/** Streaming, checkpointable OHLC aggregation. A shortened session tail is never a full-size summary. */
export function aggregateTimeChunk(dataset: AggregationDataset, input: readonly AggregationInput[], previous: AggregationTail = {}) {
  const source = datasetSourceInterval(dataset)!;
  const layers = aggregationLayers(dataset);
  const tail: AggregationTail = structuredClone(previous);
  const completed: TimeSummary[] = [];
  const skipUntil = new Map<string, number>();
  const finish = (key: string) => {
    const item = tail[key];
    if (item && Date.parse(item.bucketEnd) - Date.parse(item.bucketStart) === item.intervalSeconds * 1000) completed.push(item);
    delete tail[key];
  };
  for (const bar of input) {
    const time = bar.timestamp.getTime();
    for (const layer of layers) {
      const key = `${layer.scope}:${layer.seconds}`;
      if (time < (skipUntil.get(key) ?? -Infinity)) continue;
      if (tail[key] && time >= Date.parse(tail[key].bucketEnd)) finish(key);
      const pending = tail[key];
      const bucket = pending ? { start: Date.parse(pending.bucketStart), end: Date.parse(pending.bucketEnd), expectedCount: pending.expectedCount }
        : getAggregationBucket(time, source, layer.seconds, layer.session);
      if (!bucket) {
        const next = getAdjacentAggregationBucketStart(time, 1, layer.seconds, layer.session);
        if (next !== null && next > time) skipUntil.set(key, next);
        continue;
      }
      if ((time - bucket.start) % (source * 1000) !== 0) continue;
      let item = tail[key];
      if (item && Date.parse(item.bucketStart) !== bucket.start) { finish(key); item = undefined!; }
      if (!item) {
        item = tail[key] = {
          scope: layer.scope, intervalSeconds: layer.seconds,
          bucketStart: new Date(bucket.start).toISOString(), bucketEnd: new Date(bucket.end).toISOString(),
          firstSequence: bar.sequence, lastSequence: bar.sequence, firstTime: bar.timestamp.toISOString(), lastTime: bar.timestamp.toISOString(),
          open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
          volumeCount: bar.volume === null ? 0 : 1, sourceCount: 1, expectedCount: bucket.expectedCount,
        };
      } else {
        item.lastSequence = bar.sequence; item.lastTime = bar.timestamp.toISOString();
        item.high = Math.max(item.high, bar.high); item.low = Math.min(item.low, bar.low); item.close = bar.close; item.sourceCount++;
        if (bar.volume !== null) { item.volume = (item.volume ?? 0) + bar.volume; item.volumeCount++; }
      }
      if (time + source * 1000 >= bucket.end) finish(key);
    }
  }
  return { completed, tail };
}
