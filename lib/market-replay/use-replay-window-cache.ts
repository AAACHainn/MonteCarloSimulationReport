"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { DisplayBarCache, MarketBarCache, ReplayWindowMemoryCache } from "./bar-cache";
import type { DisplaySession, MarketDatasetSummary } from "./types";

/** Owns all replaceable browser market-data caches and their connection lifecycle. */
export function useReplayWindowCaches<T>(dataset: MarketDatasetSummary) {
  const marketCache = useMemo(() => new MarketBarCache(dataset), [dataset]);
  const sessionFingerprint = useMemo(() => JSON.stringify({
    timezone: dataset.timezone,
    sessionMode: dataset.sessionMode,
    sessionOpenMinute: dataset.sessionOpenMinute,
    sessionCloseMinute: dataset.sessionCloseMinute,
    tradingWeekdays: dataset.tradingWeekdays,
  }), [dataset.sessionCloseMinute, dataset.sessionMode, dataset.sessionOpenMinute, dataset.timezone, dataset.tradingWeekdays]);
  const displayCachesRef = useRef(new Map<string, DisplayBarCache>());
  const windowCache = useRef(new ReplayWindowMemoryCache<T>());

  const getDisplayCache = useCallback((displayIntervalSeconds: number, displaySession: DisplaySession) => {
    const key = `${displayIntervalSeconds}:${displaySession}:${sessionFingerprint}`;
    let cache = displayCachesRef.current.get(key);
    if (!cache) {
      cache = new DisplayBarCache({
        datasetId: dataset.id,
        dataVersion: dataset.dataVersion,
        displayIntervalSeconds,
        displaySession,
        sessionFingerprint,
      });
      displayCachesRef.current.set(key, cache);
    }
    return cache;
  }, [dataset.dataVersion, dataset.id, sessionFingerprint]);

  useEffect(() => () => {
    marketCache.dispose();
    for (const cache of displayCachesRef.current.values()) cache.dispose();
    displayCachesRef.current.clear();
  }, [marketCache]);

  return { marketCache, getDisplayCache, windowCache };
}

