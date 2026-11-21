"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { displayIntervalOptions } from "@/lib/market-replay/display-interval";
import { paneIds, secondaryIntervals, type PaneId } from "@/lib/market-replay/multi-pane-layout";

export function useReplayPanePeriods(key: string, source: number | null, primary: number, panes: ReadonlyMap<PaneId, unknown>, ready: boolean) {
  const [stored, setStored] = useState<{ key: string; values: (number | null)[] } | null>(null);
  const [visited, setVisited] = useState<PaneId[]>([]);
  const visibleKey = [...panes.keys()].join(",");
  useEffect(() => {
    let values: (number | null)[] = [];
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      if (Array.isArray(value)) values = value.slice(0, 4).map(period => typeof period === "number" ? period : null);
    } catch { /* Use the default periods. */ }
    setStored({ key, values });
  }, [key]);

  const periodsForPrimary = useCallback((seconds: number) => [seconds, ...secondaryIntervals(source, seconds,
    displayIntervalOptions(source, seconds), stored?.key === key ? stored.values : [])], [key, source, stored]);
  const periods = useMemo(() => periodsForPrimary(primary), [periodsForPrimary, primary]);

  useEffect(() => {
    const visible = visibleKey.split(",");
    const secondary = paneIds.slice(1).filter(pane => visible.includes(String(pane)));
    setVisited(current => secondary.every(pane => current.includes(pane)) ? current : [...new Set([...current, ...secondary])]);
    if (!ready || stored?.key !== key || visible.length < 2) return;
    const values = periods.slice(1).map((period, index) => visible.includes(String(index + 2)) ? period : stored.values[index] ?? null);
    if (values.every((period, index) => period === (stored.values[index] ?? null))) return;
    setStored({ key, values });
    try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* Keep the in-memory periods. */ }
  }, [key, periods, ready, stored, visibleKey]);

  function setPeriod(pane: PaneId, seconds: number) {
    const values = Array.from({ length: 4 }, (_, index) => stored?.values[index] ?? null);
    values[pane - 2] = seconds;
    setStored({ key, values });
    try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* Keep the in-memory periods. */ }
  }

  return { periods, periodsForPrimary, setPeriod,
    mounted: stored?.key === key ? paneIds.slice(1).filter(pane => panes.has(pane) || visited.includes(pane)) : [] };
}
