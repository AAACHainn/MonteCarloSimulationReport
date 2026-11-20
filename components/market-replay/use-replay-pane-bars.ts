"use client";

import { useEffect, useRef, useState } from "react";
import { mergeSourceBarInto } from "@/lib/market-replay/aggregation";
import { copy } from "@/lib/i18n";
import { REPLAY_HISTORY_BAR_LIMIT, type DisplaySession, type MarketDatasetSummary, type MarketBarData, type TradingSessionConfig } from "@/lib/market-replay/types";
import { replayWindowRequest, type WindowPayload } from "./replay-client-shared";

const visibleCount = 300;
const maxPaneBars = 600;
type PaneWindow = Pick<WindowPayload, "visibleBars" | "warmupBars"> & { sequence: number; context: string };
type PaneWindows = { live: PaneWindow | null; history: PaneWindow | null };
type Pending = { abort: AbortController; users: number; result: Promise<WindowPayload> };

export function advancePaneWindow(windows: PaneWindows, next: PaneWindow, preserveHistory: boolean, warmup: number): PaneWindows {
  const previous = windows.live;
  const history = windows.history?.context === next.context && windows.history.sequence <= next.sequence ? windows.history : null;
  if (preserveHistory && !history && previous?.context === next.context && previous.sequence <= next.sequence && previous.visibleBars.length) {
    const first = next.visibleBars[0];
    if (!first) return { live: { ...previous, sequence: next.sequence }, history: null };
    if (first.timestamp <= previous.visibleBars.at(-1)!.timestamp) {
      const earlier = first.timestamp > previous.visibleBars[0].timestamp
        ? previous.visibleBars.filter(bar => bar.timestamp < first.timestamp) : [];
      if (earlier.length + next.visibleBars.length <= REPLAY_HISTORY_BAR_LIMIT) {
        return { live: earlier.length ? { ...next, visibleBars: [...earlier, ...next.visibleBars], warmupBars: previous.warmupBars } : next,
          history: null };
      }
    }
  }
  const excess = next.visibleBars.length - maxPaneBars;
  const live = excess > 0 ? {
    ...next, visibleBars: next.visibleBars.slice(excess),
    warmupBars: warmup ? [...next.warmupBars, ...next.visibleBars.slice(0, excess)].slice(-warmup) : [],
  } : next;
  // A disjoint tail belongs in a separate window. Joining it would hide the missing interval.
  const retained = preserveHistory && previous?.context === next.context && previous.sequence <= next.sequence && previous.visibleBars.length
    ? previous : null;
  return { live, history: preserveHistory ? history ?? retained : null };
}

export function createPaneReader() {
  const pending = new Map<string, Pending>();
  const completed = new Map<string, WindowPayload>();
  return (url: string, key: string) => {
    const cached = completed.get(key);
    if (cached) return { result: Promise.resolve(cached), release() {} };
    let entry = pending.get(key);
    if (!entry) {
      const abort = new AbortController();
      const result = fetch(url, { signal: abort.signal }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? copy.marketReplay.multiPane.loadFailed);
        const window = body as WindowPayload;
        if (!abort.signal.aborted) {
          if (completed.size >= 12) completed.delete(completed.keys().next().value!);
          completed.set(key, window);
        }
        return window;
      }).finally(() => { if (pending.get(key)?.abort === abort) pending.delete(key); });
      entry = { abort, users: 0, result };
      pending.set(key, entry);
    }
    const shared = entry;
    shared.users++;
    return { result: shared.result, release() {
      if (--shared.users === 0 && pending.get(key) === shared) {
        pending.delete(key);
        shared.abort.abort();
      }
    } };
  };
}

export function useReplayPaneBars({ visible, dataset, sequence, period, session, calendar, warmup, scope, reader, readSource }: {
  visible: boolean; dataset: MarketDatasetSummary; sequence: number; period: number; session: DisplaySession;
  calendar: TradingSessionConfig; warmup: number; scope: string; reader: ReturnType<typeof createPaneReader>;
  readSource: (after: number, count: number) => MarketBarData[];
}) {
  const [windows, setWindows] = useState<PaneWindows>({ live: null, history: null });
  const current = windows.live;
  const [error, setError] = useState<{ context: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const active = useRef<{ release(): void } | null>(null);
  const paging = useRef<{ release(): void } | null>(null);
  const historyMode = useRef(false);
  const lastHistoryRequest = useRef<string | null>(null);
  const context = [scope, dataset.id, dataset.dataVersion, dataset.historyVersion, dataset.aggregationGenerationId, period, session, warmup].join(":");
  const target = useRef(sequence);
  target.current = sequence;
  useEffect(() => () => {
    active.current?.release(); active.current = null;
    paging.current?.release(); paging.current = null;
    lastHistoryRequest.current = null;
  }, [visible, context]);
  useEffect(() => {
    if (!visible || sequence < 0 || !dataset.sourceIntervalSeconds || error?.context === context) return;
    const previous = current?.context === context && current.sequence <= sequence ? current : null;
    if (previous?.sequence === sequence || active.current) return;
    if (previous?.visibleBars.length && sequence - previous.sequence <= maxPaneBars) {
      const count = sequence - previous.sequence;
      const sources = readSource(previous.sequence, count);
      if (sources.length === count && sources[0]?.sequence === previous.sequence + 1 && sources.at(-1)?.sequence === sequence) {
        const bars = [...previous.visibleBars];
        for (const source of sources) mergeSourceBarInto(bars, source, { sourceSeconds: dataset.sourceIntervalSeconds,
          displaySeconds: period, session: calendar, emissionMode: dataset.barEmissionMode, finalSequence: dataset.barCount - 1 });
        setWindows(value => advancePaneWindow(value, { context, sequence, visibleBars: bars, warmupBars: previous.warmupBars }, historyMode.current, warmup));
        return;
      }
    }
    const { cacheKey, params } = replayWindowRequest(dataset, sequence, period, session, warmup, null, visibleCount);
    const request = reader(`/api/market-datasets/${dataset.id}/bars/window?${params}`, cacheKey);
    active.current = request;
    void request.result.then(window => {
      if (active.current === request && sequence <= target.current) {
        setWindows(value => advancePaneWindow(value, { context, sequence, visibleBars: window.visibleBars, warmupBars: window.warmupBars }, historyMode.current, warmup));
      }
    }).catch(cause => {
      if (active.current === request && sequence <= target.current) {
        setError({ context, message: cause instanceof Error ? cause.message : copy.marketReplay.multiPane.loadFailed });
      }
    }).finally(() => {
      if (active.current !== request) return;
      active.current = null;
      // Catch up to the latest acknowledged cursor after a bounded read.
      if (target.current !== sequence) setRevision(value => value + 1);
    });
  }, [calendar, context, current, dataset, error, period, readSource, reader, revision, sequence, session, visible, warmup]);

  const display = windows.history?.context === context && windows.history.sequence <= sequence ? windows.history : current;
  const data = display?.context === context && display.sequence <= sequence ? display : null;
  function resumeFollowing() {
    if (!historyMode.current) return;
    historyMode.current = false;
    paging.current?.release(); paging.current = null;
    lastHistoryRequest.current = null;
    setWindows(value => value.history ? { ...value, history: null } : value);
  }
  function updateViewport(history: boolean, barsBefore: number) {
    if (!history) { resumeFollowing(); return; }
    historyMode.current = true;
    const head = data?.visibleBars[0];
    if (!visible || barsBefore > 50 || !head?.firstSequence || paging.current || !data
      || data.visibleBars.length + visibleCount > REPLAY_HISTORY_BAR_LIMIT) return;
    const { params, cacheKey } = replayWindowRequest(dataset, head.firstSequence - 1, period, session, warmup, null, visibleCount);
    if (lastHistoryRequest.current === cacheKey) return;
    lastHistoryRequest.current = cacheKey;
    const request = reader(`/api/market-datasets/${dataset.id}/bars/window?${params}`, cacheKey);
    paging.current = request;
    void request.result.then(window => {
      if (paging.current !== request || !window.visibleBars.length) return;
      setWindows(value => {
        const key = value.history?.context === context ? "history" : "live";
        const page = value[key];
        if (page?.context !== context || page.visibleBars[0]?.timestamp !== head.timestamp) return value;
        const earlier = window.visibleBars.filter(bar => bar.timestamp < head.timestamp);
        if (earlier.length + page.visibleBars.length > REPLAY_HISTORY_BAR_LIMIT) return value;
        return { ...value, [key]: { ...page, warmupBars: window.warmupBars, visibleBars: [...earlier, ...page.visibleBars] } };
      });
    }).catch(() => {
      if (paging.current === request) lastHistoryRequest.current = null;
    }).finally(() => { if (paging.current === request) paging.current = null; });
  }
  return { data, error: error?.context === context ? error.message : null, retry: () => setError(null), updateViewport, resumeFollowing };
}
