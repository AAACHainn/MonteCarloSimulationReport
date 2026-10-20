"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { DisplayBarCache, MarketBarCache, ReplayWindowMemoryCache } from "./bar-cache";
import type { DisplaySession, MarketDatasetSummary } from "./types";
import { BAR_QUALITY_RULE_VERSION } from "./bar-quality";

/** Owns all replaceable browser market-data caches and their connection lifecycle. */
export function useReplayWindowCaches<T>(dataset: MarketDatasetSummary) {
  const rawDataset = useMemo(() => ({ id: dataset.id, dataVersion: dataset.dataVersion,
    historyVersion: dataset.historyVersion, symbol: dataset.symbol, sourceIntervalSeconds: dataset.sourceIntervalSeconds }),
  [dataset.id, dataset.dataVersion, dataset.historyVersion, dataset.symbol, dataset.sourceIntervalSeconds]);
  const marketCache = useMemo(() => new MarketBarCache(rawDataset), [rawDataset]);
  const sessionFingerprint = useMemo(() => JSON.stringify({
    qualityVersion: BAR_QUALITY_RULE_VERSION,
    barEmissionMode: dataset.barEmissionMode,
    aggregationGenerationId: dataset.aggregationGenerationId,
    aggregationRuleVersion: dataset.aggregationRuleVersion,
    timezone: dataset.timezone,
    sessionMode: dataset.sessionMode,
    sessionOpenMinute: dataset.sessionOpenMinute,
    sessionCloseMinute: dataset.sessionCloseMinute,
    tradingWeekdays: dataset.tradingWeekdays,
  }), [dataset.barEmissionMode, dataset.aggregationGenerationId, dataset.aggregationRuleVersion, dataset.sessionCloseMinute, dataset.sessionMode, dataset.sessionOpenMinute, dataset.timezone, dataset.tradingWeekdays]);
  const displayCachesRef = useRef(new Map<string, DisplayBarCache>());
  const windowCache = useRef(new ReplayWindowMemoryCache<T>());

  const getDisplayCache = useCallback((displayIntervalSeconds: number, displaySession: DisplaySession) => {
    const key = `${displayIntervalSeconds}:${displaySession}:${sessionFingerprint}`;
    let cache = displayCachesRef.current.get(key);
    if (!cache) {
      cache = new DisplayBarCache({
        datasetId: dataset.id,
        dataVersion: dataset.dataVersion,
        aggregationGenerationId: dataset.aggregationGenerationId,
        aggregationRuleVersion: dataset.aggregationRuleVersion,
        barEmissionMode: dataset.barEmissionMode,
        displayIntervalSeconds,
        displaySession,
        sessionFingerprint,
      });
      displayCachesRef.current.set(key, cache);
    }
    return cache;
  }, [dataset.barEmissionMode, dataset.aggregationGenerationId, dataset.aggregationRuleVersion, dataset.dataVersion, dataset.id, sessionFingerprint]);

  useEffect(() => () => marketCache.dispose(), [marketCache]);
  useEffect(() => () => {
    for (const cache of displayCachesRef.current.values()) cache.dispose();
    displayCachesRef.current.clear();
  }, [marketCache, sessionFingerprint]);

  return { marketCache, getDisplayCache, windowCache };
}

