"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/i18n";
import type { AggregatedMarketBarData, DisplaySession, MarketDatasetSummary } from "@/lib/market-replay/types";
import { replayWindowRequest } from "./replay-client-shared";
import type { createPaneReader } from "./use-replay-pane-bars";

type FormingBarRead = {
  dataset: MarketDatasetSummary;
  period: number;
  session: DisplaySession;
  reader: ReturnType<typeof createPaneReader>;
};
type Bucket = Pick<AggregatedMarketBarData, "firstSequence" | "lastSequence" | "timestamp">;
export type HistoricalFormingSnapshot = { key: string; through: number; bar: AggregatedMarketBarData };
type FormingResult = { key: string; through: number; bar: AggregatedMarketBarData | null; error?: string; retry?: true };

function formingBucket(bars: AggregatedMarketBarData[], cursor: number | null) {
  return cursor === null ? null : bars.find(bar => bar.firstSequence <= cursor && bar.lastSequence > cursor) ?? null;
}

function formingBucketKey({ dataset, period, session }: FormingBarRead, bucket: Bucket) {
  return replayWindowRequest(dataset, bucket.firstSequence, period, session, 0, null, 1).cacheKey;
}

export async function readHistoricalFormingBar({ dataset, period, session, reader }: FormingBarRead,
  bucket: Bucket, sequence: number, signal: AbortSignal) {
  if (sequence < bucket.firstSequence || sequence >= bucket.lastSequence) return null;
  signal.throwIfAborted();
  const { cacheKey, params } = replayWindowRequest(dataset, sequence, period, session, 0, null, 1);
  const read = reader("/api/market-datasets/" + dataset.id + "/bars/window?" + params, cacheKey);
  signal.addEventListener("abort", read.release, { once: true });
  try {
    const { visibleBars } = await read.result;
    signal.throwIfAborted();
    const bar = visibleBars.at(-1);
    return bar?.firstSequence === bucket.firstSequence && bar.timestamp === bucket.timestamp && bar.lastSequence <= sequence ? bar : null;
  } finally {
    signal.removeEventListener("abort", read.release);
  }
}

export async function prepareHistoricalFormingBar(config: FormingBarRead, bars: AggregatedMarketBarData[], cursor: number | null, signal: AbortSignal):
  Promise<HistoricalFormingSnapshot | undefined> {
  const bucket = formingBucket(bars, cursor);
  if (cursor === null || !bucket) return undefined;
  const bar = await readHistoricalFormingBar(config, bucket, cursor, signal);
  if (!bar) throw new Error(copy.marketReplay.multiPane.loadFailed);
  return { key: formingBucketKey(config, bucket), through: cursor, bar };
}

export function useHistoricalPaneFormingBar({ dataset, period, session, reader, bars, cursor, revision, prepared }:
  FormingBarRead & { bars: AggregatedMarketBarData[]; cursor: number | null; revision: number; prepared?: HistoricalFormingSnapshot }) {
  const bucket = formingBucket(bars, cursor);
  const bucketKey = bucket && formingBucketKey({ dataset, period, session, reader }, bucket);
  const key = bucketKey && bucketKey + ":" + revision;
  const [result, setResult] = useState<FormingResult | null>(null);
  const pending = useRef<AbortController | null>(null);
  const current = cursor !== null && result?.key === key && result.through <= cursor ? result : null;
  const seed = cursor !== null && prepared?.key === bucketKey && prepared.through <= cursor ? prepared : null;
  const bar = current ? current.bar : seed?.bar ?? null;
  const through = current?.through ?? seed?.through;
  const retrying = current?.retry;
  const error = current?.error ?? null;

  useEffect(() => () => {
    pending.current?.abort();
    pending.current = null;
  }, [key]);

  useEffect(() => {
    if (cursor === null || !bucket || !key || pending.current || error || (through === cursor && !retrying)) return;
    const controller = new AbortController();
    pending.current = controller;
    // Finish the current bounded read during fast playback, then catch up to the latest cursor.
    void (async () => {
      let next: FormingResult;
      try {
        const updated = await readHistoricalFormingBar({ dataset, period, session, reader }, bucket, cursor, controller.signal);
        next = { key, through: cursor, bar: updated ?? bar };
      } catch (cause) {
        next = {
          key, through: cursor, bar,
          error: cause instanceof Error && cause.message ? cause.message : copy.marketReplay.multiPane.loadFailed,
        };
      }
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setResult(next);
    })();
  }, [bar, bucket, cursor, dataset, error, key, period, reader, retrying, session, through]);

  return {
    bar,
    error,
    retry: () => setResult(previous => previous?.error ? { ...previous, error: undefined, retry: true } : previous),
  };
}
