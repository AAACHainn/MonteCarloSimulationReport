"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copy } from "@/lib/i18n";
import { isHistoricalPlaybackBarReady } from "@/lib/market-replay/historical-playback";
import { boundedHistoricalPlaybackWindow, mergeHistoricalBars, readLaterHistoryWindow } from "@/lib/market-replay/historical-window";
import { REPLAY_HISTORY_BAR_LIMIT, type DisplaySession, type MarketDatasetSummary } from "@/lib/market-replay/types";
import { replayWindowRequest, type WindowPayload } from "./replay-client-shared";
import type { ReplayVisibleSequenceRange } from "./replay-chart-shared";
import type { createPaneReader } from "./use-replay-pane-bars";
import { prepareHistoricalFormingBar, type HistoricalFormingSnapshot } from "./use-historical-pane-forming-bar";

const pageSize = 300;
export type HistoricalPaneWindow = Pick<WindowPayload, "visibleBars" | "warmupBars"> & { key: string };
export type HistoricalPanePreparation = { window: HistoricalPaneWindow; forming?: HistoricalFormingSnapshot };
type Direction = "left" | "right";
type HistoricalPaneRead = {
  dataset: MarketDatasetSummary; period: number; session: DisplaySession; warmup: number;
  reader: ReturnType<typeof createPaneReader>; end: number;
};

async function readPanePage({ dataset, period, session, warmup, reader, end }: HistoricalPaneRead,
  cutoff: number, focus: number | null, signal: AbortSignal): Promise<HistoricalPaneWindow> {
  signal.throwIfAborted();
  const { cacheKey: key, params } = replayWindowRequest(dataset, cutoff, period, session, warmup, focus, pageSize);
  const pending = reader("/api/market-datasets/" + dataset.id + "/bars/window?" + params, key);
  signal.addEventListener("abort", pending.release, { once: true });
  try {
    const { visibleBars, warmupBars } = await pending.result;
    signal.throwIfAborted();
    // Only the history endpoint may retain a candle that was truncated by the window cutoff.
    return { key, warmupBars, visibleBars: visibleBars.filter(bar => isHistoricalPlaybackBarReady(bar, end)) };
  } finally {
    signal.removeEventListener("abort", pending.release);
  }
}

export async function readInitialHistoricalPaneWindow(config: HistoricalPaneRead, focus: number, signal: AbortSignal) {
  const { end, period, dataset } = config;
  const focused = await readPanePage(config, end, focus, signal);
  if (focused.visibleBars.length || !dataset.sourceIntervalSeconds) return focused;
  // A filtered session may begin beyond the initial page. Find its first available page
  // so playback can reveal it when the shared cursor reaches it.
  const later = await readLaterHistoryWindow({ afterSequence: focus, endSequence: end, sourceSeconds: dataset.sourceIntervalSeconds,
    displaySeconds: period, visibleCount: pageSize, shouldContinue: () => !signal.aborted,
    readWindow: target => readPanePage(config, end, target, signal) });
  if (!later) return focused;
  // The earliest probe can end at the first available candle. Center a full page
  // on that candle so the view has room to browse and reveal subsequent bars.
  const available = await readPanePage(config, end, later.visibleBars[0].firstSequence, signal);
  return { ...available, key: focused.key };
}

export async function prepareHistoricalPaneWindow(config: HistoricalPaneRead, focus: number, formingCursor: number | null, signal: AbortSignal):
  Promise<HistoricalPanePreparation> {
  const window = await readInitialHistoricalPaneWindow(config, focus, signal);
  const forming = await prepareHistoricalFormingBar(config, window.visibleBars, formingCursor, signal);
  return { window, forming };
}

export function useHistoricalPaneWindow({ visible, dataset, period, session, warmup, reader, start, end, focus, revision, prepared, cursor, following }:
  HistoricalPaneRead & { visible: boolean; start: number; focus: number; revision: number; prepared?: HistoricalPaneWindow;
    cursor: number | null; following: () => boolean }) {
  const config = useMemo(() => ({ dataset, period, session, warmup, reader, end }), [dataset, period, session, warmup, reader, end]);
  const { cacheKey } = replayWindowRequest(dataset, end, period, session, warmup, focus, pageSize);
  const key = cacheKey + ":" + revision;
  const [window, setWindow] = useState<HistoricalPaneWindow | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string; direction?: Direction } | null>(null);
  const [exhausted, setExhausted] = useState<Partial<Record<Direction, string>>>({});
  const active = useRef<AbortController | null>(null);
  const data = window?.key === key ? window : prepared?.key === cacheKey ? prepared : null;
  const error = failure?.key === key ? failure.message : null;

  const run = useCallback(async (load: (signal: AbortSignal) => Promise<void>, direction?: Direction) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    try { await load(controller.signal); }
    catch (cause) {
      if (!controller.signal.aborted) setFailure({ key, direction, message: cause instanceof Error ? cause.message : copy.marketReplay.multiPane.loadFailed });
    } finally { if (active.current === controller) active.current = null; }
  }, [key]);

  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
  }, [key, visible]);

  useEffect(() => {
    if (!visible || data || error) return;
    void run(async signal => {
      const result = await readInitialHistoricalPaneWindow(config, focus, signal);
      if (!signal.aborted) setWindow({ ...result, key });
    });
  }, [config, data, error, focus, key, run, visible]);

  const page = useCallback((direction: Direction, retry = false) => {
    const first = data?.visibleBars[0];
    const last = data?.visibleBars.at(-1);
    if (!visible || error && !retry || !first || !last || !dataset.sourceIntervalSeconds) return false;
    if (direction === "left" ? first.firstSequence <= start : last.lastSequence >= end) return false;
    const follow = direction === "right" && cursor !== null && following();
    if (!follow && data.visibleBars.length + pageSize > REPLAY_HISTORY_BAR_LIMIT) return false;
    const edge = [key, direction, direction === "left" ? first.firstSequence : last.lastSequence].join(":");
    if (exhausted[direction] === edge) return false;
    const sourceSeconds = dataset.sourceIntervalSeconds;
    void run(async signal => {
      const result = direction === "left" ? await readPanePage(config, first.firstSequence - 1, null, signal)
        : await readLaterHistoryWindow({ afterSequence: last.lastSequence, endSequence: end, sourceSeconds, displaySeconds: period,
          visibleCount: pageSize, shouldContinue: () => !signal.aborted, readWindow: target => readPanePage(config, end, target, signal) });
      if (signal.aborted) return;
      const addsBars = result?.visibleBars.some(bar => direction === "left" ? bar.firstSequence < first.firstSequence : bar.lastSequence > last.lastSequence);
      if (!result || !addsBars) { setExhausted(current => ({ ...current, [direction]: edge })); return; }
      if (direction === "left") {
        setWindow({ key, visibleBars: mergeHistoricalBars(data.visibleBars, result.visibleBars), warmupBars: result.warmupBars });
      } else {
        const next = boundedHistoricalPlaybackWindow(data.visibleBars, result.visibleBars, warmup, data.warmupBars);
        setWindow({ key, visibleBars: next.visibleBars, warmupBars: next.warmupBars ?? data.warmupBars });
      }
    }, direction);
    return true;
  }, [config, cursor, data, dataset.sourceIntervalSeconds, end, error, exhausted, following, key, period, run, start, visible, warmup]);

  useEffect(() => {
    const last = data?.visibleBars.at(-1);
    if (cursor !== null && last && cursor >= last.lastSequence && following()) page("right");
  }, [cursor, data, following, page]);

  function updateViewport(range: ReplayVisibleSequenceRange) {
    if (cursor !== null && cursor >= (data?.visibleBars.at(-1)?.lastSequence ?? end) && following() && page("right")) return;
    if (range.barsBefore < 35 && page("left")) return;
    if (cursor === null && range.barsAfter < 35) page("right");
  }

  function retry() {
    setFailure(null);
    if (failure?.key === key && failure.direction) page(failure.direction, true);
  }

  return { data, error, updateViewport, retry };
}
