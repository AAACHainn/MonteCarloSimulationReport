"use client";

import { useEffect, useRef } from "react";
import { copy } from "@/lib/i18n";
import { replayDisplayMetadataKey } from "@/lib/market-replay/dataset-refresh";
import { mergeReplayHistory } from "@/lib/market-replay/history";
import { EMA_LENGTH_MAX, type AggregatedMarketBarData } from "@/lib/market-replay/types";
import type { WindowPayload } from "./replay-client-shared";
import type { useReplayCore } from "./use-replay-core";

type Core = Pick<ReturnType<typeof useReplayCore>,
  "dataset" | "replaySession" | "replay" | "bars" | "emaSettingsLoaded" | "abrSettingsLoaded"
  | "indicatorWarmupCount" | "previousIndicatorWarmupCountRef" | "skipNextIndicatorReloadRef"
  | "latestReplayRef" | "barsRef" | "warmupBarsRef" | "historyEpochRef" | "fetch"
  | "setWarmupBars" | "setEmaError">;

/** Supplement the loaded prefix without replacing candles, moving focus or pausing playback. */
export function useReplayIndicatorWarmup({
  dataset, replaySession, replay, bars, emaSettingsLoaded, abrSettingsLoaded,
  indicatorWarmupCount, previousIndicatorWarmupCountRef, skipNextIndicatorReloadRef,
  latestReplayRef, barsRef, warmupBarsRef, historyEpochRef, fetch, setWarmupBars, setEmaError,
}: Core) {
  // Retain one bounded prefix, including a short response at the dataset boundary.
  const completedRef = useRef<{ key: string; count: number; bars: AggregatedMarketBarData[] } | null>(null);
  const firstTimestamp = bars[0]?.timestamp;
  const firstSequence = bars[0]?.firstSequence;
  const displayIntervalSeconds = replay?.displayIntervalSeconds;
  const displaySession = replay?.displaySession;
  const generation = replay?.generation;
  const scope = JSON.stringify([dataset.id, dataset.dataVersion, dataset.historyVersion, replayDisplayMetadataKey(dataset),
    replaySession?.id, replaySession?.activeProjectionId, generation, displayIntervalSeconds, displaySession]);

  useEffect(() => {
    if (!emaSettingsLoaded || !abrSettingsLoaded) return;
    const previous = previousIndicatorWarmupCountRef.current;
    previousIndicatorWarmupCountRef.current = indicatorWarmupCount;
    // ABR's explicit update already loads its own authoritative window.
    if (previous !== indicatorWarmupCount && skipNextIndicatorReloadRef.current) {
      skipNextIndicatorReloadRef.current = false;
      return;
    }
    if (previous !== null && indicatorWarmupCount < previous) return;
    const count = Math.min(EMA_LENGTH_MAX, indicatorWarmupCount);
    if (firstSequence === undefined || firstSequence <= 0 || !firstTimestamp
      || !displayIntervalSeconds || !displaySession) return;
    if (count <= warmupBarsRef.current.length) {
      setEmaError(null);
      return;
    }
    const key = JSON.stringify([scope, firstTimestamp, firstSequence]);
    const cached = completedRef.current;
    if (cached?.key === key && cached.count >= count) {
      if (cached.bars.length > warmupBarsRef.current.length) {
        const warmup = cached.bars.slice(-count);
        warmupBarsRef.current = warmup;
        setWarmupBars(warmup);
      }
      setEmaError(null);
      return;
    }
    const epoch = historyEpochRef.current;
    const controller = new AbortController();
    const stillCurrent = () => {
      const current = latestReplayRef.current;
      return !controller.signal.aborted && epoch === historyEpochRef.current
        && current !== null && current.generation === generation && current.displayIntervalSeconds === displayIntervalSeconds
        && current.displaySession === displaySession && barsRef.current[0]?.timestamp === firstTimestamp
        && barsRef.current[0]?.firstSequence === firstSequence;
    };
    const params = new URLSearchParams({
      displayIntervalSeconds: String(displayIntervalSeconds), displaySession,
      endSequence: String(firstSequence - 1), visibleCount: String(count), warmupCount: "0",
    });
    void (async () => {
      try {
        const response = await fetch(`/api/market-datasets/${dataset.id}/bars/window?${params}`, { signal: controller.signal });
        const body = await response.json() as WindowPayload & { error?: string };
        if (!stillCurrent()) return;
        if (!response.ok) throw new Error(body.error ?? copy.marketReplay.loadError);
        const before = [...warmupBarsRef.current, ...body.warmupBars, ...body.visibleBars]
          .filter((bar) => bar.timestamp < firstTimestamp && bar.lastSequence < firstSequence);
        const warmup = mergeReplayHistory([before], 0, count).bars;
        completedRef.current = { key, count, bars: warmup };
        warmupBarsRef.current = warmup;
        setWarmupBars(warmup);
        setEmaError(null);
      } catch (error) {
        if (stillCurrent()) setEmaError(error instanceof Error ? error.message : copy.marketReplay.loadError);
      }
    })();
    return () => controller.abort();
  }, [abrSettingsLoaded, barsRef, dataset.id, displayIntervalSeconds, displaySession, emaSettingsLoaded,
    fetch, firstSequence, firstTimestamp, generation, historyEpochRef, indicatorWarmupCount, latestReplayRef,
    previousIndicatorWarmupCountRef, scope, setEmaError, setWarmupBars, skipNextIndicatorReloadRef, warmupBarsRef]);
}
