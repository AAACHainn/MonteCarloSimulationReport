"use client";

import type { ReplayViewportSnapshot } from "@/lib/market-replay/chart-range";
import { canReuseAnnotations } from "@/lib/market-replay/advance-display";
import { startTransition, useCallback, useEffect, useMemo } from "react";
import { type ReplayVisibleSequenceRange } from "@/components/market-replay/replay-chart";
import { copy } from "@/lib/i18n";
import { runDrawingWrite } from "@/lib/market-replay/drawing-write-queue";
import { createReplayState } from "@/lib/market-replay/engine";
import { aggregateMarketBars } from "@/lib/market-replay/aggregation";
import { closeAggregatedBar } from "@/lib/market-replay/bar-quality";
import { mergeRefreshedReplayWindow, replayDisplayMetadataKey } from "@/lib/market-replay/dataset-refresh";
import { canAdvanceFlatAccount } from "@/lib/paper-trading/flat-advance";
import type { ReplayChartVisibility } from "@/lib/market-replay/chart-visibility";
import { tradingDayForTimestamp } from "@/lib/market-replay/chunks";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { EMA_LENGTH_MAX, REPLAY_HISTORY_BAR_LIMIT, REPLAY_HISTORY_PREFETCH_THRESHOLD, REPLAY_HISTORY_RAW_SOURCE_BUDGET, type AggregatedMarketBarData, type DisplaySession } from "@/lib/market-replay/types";
import { contiguousCachedHistoryBefore, mergeReplayHistory, nextHistoryEndSequence, replayHistoryPageSize } from "@/lib/market-replay/history";
import { readLaterHistoryWindow } from "@/lib/market-replay/historical-window";
import type { PaperSessionSnapshot } from "@/lib/paper-trading/types";
import { DRAWING_TYPE_FIB_RETRACEMENT, DRAWING_TYPE_TREND_LINE, DRAWING_TYPE_RECTANGLE, DRAWING_TYPE_TEXT, drawingGeometryMatchesType, type TwoPointDrawingTool, type DrawingGeometry, drawingStyleMatchesType, type DrawingTool, type MarketDrawing, type MarketDrawingStyle, type TrendLineGeometry } from "@/lib/market-replay/chart-drawings";
import { WindowPayload, TradeAnnotationsPayload, replayWindowRequest, createLocalDrawingId, cloneFibonacciStyle } from "./replay-client-shared";
import type { useReplayCore } from "./use-replay-core";
import { useReplayIndicatorWarmup } from "./use-replay-indicator-warmup";

export function useReplayDrawingWindow(core: ReturnType<typeof useReplayCore>) {
  const {
    fetch, replaySession, registerAiScope, aiChartOwner, dataset, initializedDatasetRef,
    setBars, setChartDisplay, setChartDataRevision, setWarmupBars, setCurrentSourceBar,
    setIsLoading, setLoadError, setReplay, latestReplayRef,
    confirmedPaperSnapshotRef, paperSessionLoadedRef, paperSessionLoadRef, commitConfirmedPaperSnapshot,
    setTradeAnnotations, setTradeAnnotationsTruncated, setPaperError, setChartFocusSequence, chartWindowDetachedRef, setMeasurementArmed,
    setDrawingToolOpen, setDrawingTool, drawings, setDrawings, setClearingDrawings, clearingDrawingsRef,
    setDrawingError, setSelectedDrawingId, setDrawingObjectsOpen, setRectangleStyleId, styleDrawingId, setStyleDrawingId,
    styleDraft, setStyleDraft, pendingDrawingIds, setPendingDrawingIds, emaSettingsLoaded, abrSettingsLoaded,
    chartVisibility, setChartVisibility, defaultRectangleStyle, defaultTrendLineStyle, defaultFibonacciStyle, openTextDrawing,
    finishText, discardText, requestTextSettings, drawingWriteScope, drawingScopeGuard, drawingsLive,
    indicatorWarmupCountRef, marketSession, marketCache,
    getDisplayCache, windowCache, barsRef, warmupBarsRef, playbackDisplayRef, currentSourceBarRef, viewChangingRef,
    windowRequestRef, windowAbortRef, windowPrefetchAbortRef, annotationAbortRef, annotationRequestRef, annotationCoverageRef,
    annotationTimerRef, historyAbortRef, historyLoadingRef, historyHasEarlierRef, historyLaterExhaustedThroughRef, historyLastBarsBeforeRef,
    historyEpochRef, beginBuffering, endBuffering,
  } = core;
  const setDrawingPending = useCallback((id: string, pending: boolean) => {
    setPendingDrawingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(id); else next.delete(id);
      return next;
    });
  }, [setPendingDrawingIds]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/market-datasets/${dataset.id}/drawings`, { signal: controller.signal });
        const data = await response.json() as { drawings?: MarketDrawing[]; error?: string };
        if (!response.ok || !Array.isArray(data.drawings)) throw new Error(data.error);
        setDrawings(data.drawings);
        setDrawingError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setDrawingError(error instanceof Error && error.message ? error.message : copy.marketReplay.drawingLoadError);
      }
    })();
    return () => controller.abort();
  }, [dataset.id, fetch, setDrawingError, setDrawings]);

  const armDrawing = useCallback(async (tool: DrawingTool) => {
    if (!await finishText()) return;
    setMeasurementArmed(false);
    setChartVisibility((current) => current.drawings ? current : { ...current, drawings: true });
    setDrawingTool(tool);
    setDrawingToolOpen(false);
    setSelectedDrawingId(null);
    setDrawingError(null);
  }, [setChartVisibility, finishText, setDrawingError, setDrawingTool, setDrawingToolOpen, setMeasurementArmed, setSelectedDrawingId]);

  const changeChartVisibility = useCallback(async (next: ReplayChartVisibility) => {
    if (!next.drawings && !await finishText()) return;
    setChartVisibility(next);
    if (!next.drawings) {
      setDrawingTool(null);
      setDrawingToolOpen(false);
      setDrawingObjectsOpen(false);
      setSelectedDrawingId(null);
    }
  }, [setChartVisibility, finishText, setDrawingObjectsOpen, setDrawingTool, setDrawingToolOpen, setSelectedDrawingId]);
  const armTrendLine = useCallback(() => armDrawing(DRAWING_TYPE_TREND_LINE), [armDrawing]);
  const armFibonacciRetracement = useCallback(() => armDrawing(DRAWING_TYPE_FIB_RETRACEMENT), [armDrawing]);

  const createDrawing = useCallback(async (type: TwoPointDrawingTool, geometry: TrendLineGeometry) => runDrawingWrite(drawingWriteScope, async () => {
    if (clearingDrawingsRef.current) return;
    const temporaryId = createLocalDrawingId("temporary");
    const now = new Date().toISOString();
    const style = type === DRAWING_TYPE_RECTANGLE ? { ...defaultRectangleStyle } : type === DRAWING_TYPE_TREND_LINE
      ? { ...defaultTrendLineStyle }
      : cloneFibonacciStyle(defaultFibonacciStyle);
    const optimistic = {
      id: temporaryId, datasetId: dataset.id, type, geometry, style, createdAt: now, updatedAt: now,
    } as MarketDrawing;
    setDrawings((current) => [...current, optimistic]);
    setSelectedDrawingId(temporaryId);
    setDrawingPending(temporaryId, true);
    try {
      const response = await fetch(`/api/market-datasets/${dataset.id}/drawings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, geometry, style }),
      });
      const data = await response.json() as { drawing?: MarketDrawing; error?: string };
      if (!response.ok || !data.drawing) throw new Error(data.error);
      setDrawings((current) => current.map((drawing) => drawing.id === temporaryId ? data.drawing! : drawing));
      setSelectedDrawingId((current) => current === temporaryId ? data.drawing!.id : current);
      setDrawingError(null);
    } catch {
      setDrawings((current) => current.filter((drawing) => drawing.id !== temporaryId));
      setSelectedDrawingId((current) => current === temporaryId ? null : current);
      setDrawingError(copy.marketReplay.drawingSaveError);
    } finally {
      setDrawingPending(temporaryId, false);
    }
  }), [dataset.id, drawingWriteScope, defaultRectangleStyle, defaultFibonacciStyle, defaultTrendLineStyle, setDrawingPending, fetch, clearingDrawingsRef, setDrawingError, setDrawings, setSelectedDrawingId]);

  const updateDrawing = useCallback(async (
    id: string,
    patch: { geometry?: DrawingGeometry; style?: MarketDrawingStyle },
  ) => {
    const currentScope = drawingScopeGuard();
    return runDrawingWrite(drawingWriteScope, async () => {
      if (!currentScope()) return false;
      const previous = drawingsLive.current.find((drawing) => drawing.id === id);
      if (clearingDrawingsRef.current || !previous || id.startsWith("temporary-") || pendingDrawingIds.has(id)) return false;
      if (patch.style && !drawingStyleMatchesType(previous.type, patch.style)) return false;
      if (patch.geometry && !drawingGeometryMatchesType(previous.type, patch.geometry)) return false;
      if ((!patch.geometry || JSON.stringify(patch.geometry) === JSON.stringify(previous.geometry))
        && (!patch.style || JSON.stringify(patch.style) === JSON.stringify(previous.style))) return true;
      const optimistic = { ...previous, ...patch, updatedAt: new Date().toISOString() } as MarketDrawing;
      setDrawings((current) => current.map((drawing) => drawing.id === id ? optimistic : drawing));
      setDrawingPending(id, true);
      try {
        const response = await fetch(`/api/market-datasets/${dataset.id}/drawings/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await response.json() as { drawing?: MarketDrawing; error?: string };
        if (!currentScope()) return false;
        if (!response.ok || !data.drawing) throw new Error(data.error);
        setDrawings((current) => current.map((drawing) => drawing.id === id ? data.drawing! : drawing));
        setDrawingError(null);
        return true;
      } catch {
        if (!currentScope()) return false;
        setDrawings((current) => current.map((drawing) => drawing.id === id ? previous : drawing));
        setDrawingError(copy.marketReplay.drawingSaveError);
        return false;
      } finally {
        if (currentScope()) setDrawingPending(id, false);
      }
    });
  }, [dataset.id, drawingWriteScope, pendingDrawingIds, setDrawingPending, fetch, drawingScopeGuard, clearingDrawingsRef, drawingsLive, setDrawingError, setDrawings]);

  const deleteDrawing = useCallback(async (id: string) => {
    await discardText(id);
    return runDrawingWrite(drawingWriteScope, async () => {
    const index = drawingsLive.current.findIndex((drawing) => drawing.id === id);
    if (clearingDrawingsRef.current || index < 0 || id.startsWith("temporary-") || pendingDrawingIds.has(id)) return;
    const previous = drawingsLive.current[index];
    setDrawings((current) => current.filter((drawing) => drawing.id !== id));
    setSelectedDrawingId((current) => current === id ? null : current);
    if (styleDrawingId === id) {
      setStyleDrawingId(null);
      setStyleDraft(null);
    }
    setDrawingPending(id, true);
    try {
      const response = await fetch(`/api/market-datasets/${dataset.id}/drawings/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setDrawingError(null);
    } catch {
      setDrawings((current) => {
        const next = [...current];
        next.splice(Math.min(index, next.length), 0, previous);
        return next;
      });
      setDrawingError(copy.marketReplay.drawingDeleteError);
    } finally {
      setDrawingPending(id, false);
    }
    });
  }, [dataset.id, drawingWriteScope, discardText, pendingDrawingIds, setDrawingPending, styleDrawingId, fetch, clearingDrawingsRef, drawingsLive, setDrawingError, setDrawings, setSelectedDrawingId, setStyleDraft, setStyleDrawingId]);

  const clearDrawings = async () => {
    await discardText();
    return runDrawingWrite(drawingWriteScope, async () => {
    if (clearingDrawingsRef.current || pendingDrawingIds.size || !drawingsLive.current.length) return;
    const previous = drawingsLive.current;
    clearingDrawingsRef.current = true; setClearingDrawings(true); setDrawingError(null);
    setDrawingTool(null); setDrawings([]); setSelectedDrawingId(null);
    try {
      const response = await fetch(`/api/market-datasets/${dataset.id}/drawings`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: previous.map(drawing => drawing.id) }),
      });
      const data = await response.json() as { drawings?: MarketDrawing[]; error?: string };
      if (!response.ok || !data.drawings) throw new Error(data.error);
      setDrawings(data.drawings);
    } catch { setDrawings(previous); setDrawingError(copy.marketReplay.drawingDeleteError); }
    finally { clearingDrawingsRef.current = false; setClearingDrawings(false); }
    });
  };

  const openDrawingStyle = useCallback(async (id: string, inlineText = false) => {
    if (!inlineText && await requestTextSettings(id)) return;
    if (!await finishText()) return;
    const drawing = drawingsLive.current.find((item) => item.id === id);
    if (!drawing) return;
    setSelectedDrawingId(id);
    if (drawing.type === DRAWING_TYPE_TEXT) { openTextDrawing(drawing, inlineText); return; }
    if (drawing.type === DRAWING_TYPE_RECTANGLE) { setRectangleStyleId(id); return; }
    setStyleDrawingId(id);
    setStyleDraft(drawing.type === DRAWING_TYPE_TREND_LINE
      ? { ...drawing.style }
      : cloneFibonacciStyle(drawing.style));
  }, [finishText, requestTextSettings, openTextDrawing, drawingsLive, setRectangleStyleId, setSelectedDrawingId, setStyleDraft, setStyleDrawingId]);

  const displayedDrawings = useMemo(() => (
    styleDrawingId && styleDraft
      ? drawings.map((drawing) => drawing.id === styleDrawingId && drawingStyleMatchesType(drawing.type, styleDraft)
        ? { ...drawing, style: styleDraft } as MarketDrawing
        : drawing)
      : drawings
  ), [drawings, styleDraft, styleDrawingId]);
  const visibleDrawings = useMemo(
    () => chartVisibility.drawings ? displayedDrawings : [],
    [chartVisibility.drawings, displayedDrawings],
  );

  const loadTradeAnnotations = useCallback(async (
    visibleBars: AggregatedMarketBarData[],
    journalNo: number | null = null,
    force = true,
  ) => {
    const from = visibleBars[0]?.firstSequence;
    const to = visibleBars.at(-1)?.lastSequence;
    const revealedSequence = latestReplayRef.current?.currentSequence ?? -1;
    const journalEntryCount = confirmedPaperSnapshotRef.current?.stats.journalEntryCount;
    if (!force && journalNo === null && from !== undefined && to !== undefined
      && canReuseAnnotations(annotationCoverageRef.current, from, to, revealedSequence, journalEntryCount)) return;
    annotationCoverageRef.current = null;
    const requestId = ++annotationRequestRef.current;
    annotationAbortRef.current?.abort();
    annotationAbortRef.current = null;
    if (!visibleBars.length && journalNo === null) {
      setTradeAnnotations([]);
      setTradeAnnotationsTruncated(false);
      return;
    }
    const params = new URLSearchParams();
    if (journalNo !== null) {
      params.set("journalNo", String(journalNo));
    } else {
      params.set("fromSequence", String(visibleBars[0].firstSequence));
      params.set("toSequence", String(visibleBars.at(-1)!.lastSequence));
    }
    const controller = new AbortController();
    annotationAbortRef.current = controller;
    try {
      const response = await fetch(`/api/market-datasets/${dataset.id}/paper-journal/annotations?${params}`, {
        signal: controller.signal,
      });
      const data = await response.json() as TradeAnnotationsPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? copy.paperTrading.journalLoadFailed);
      if (requestId !== annotationRequestRef.current) return;
      setTradeAnnotations(data.items);
      setTradeAnnotationsTruncated(data.truncated);
      if (!data.truncated && journalNo === null && from !== undefined && to !== undefined && journalEntryCount !== undefined) {
        annotationCoverageRef.current = { fromSequence: from, toSequence: to, revealedSequence, journalEntryCount };
      }
    } catch {
      if (controller.signal.aborted || requestId !== annotationRequestRef.current) return;
      setTradeAnnotations([]);
      setTradeAnnotationsTruncated(false);
    } finally {
      if (annotationAbortRef.current === controller) annotationAbortRef.current = null;
    }
  }, [dataset.id, fetch, latestReplayRef, confirmedPaperSnapshotRef, annotationAbortRef, annotationCoverageRef, annotationRequestRef, setTradeAnnotations, setTradeAnnotationsTruncated]);

  const loadWindow = useCallback(async (
    endSequence: number,
    displayIntervalSeconds: number,
    displaySession: DisplaySession,
    warmupCount: number,
    completedDisplayBucketStart: string | null = null,
    focusSequence: number | null = null,
    reviewOnly = false,
    focusJournalNo: number | null = null,
    preserveHistory = false,
    canApply: () => boolean = () => true,
    viewport: ReplayViewportSnapshot | null = null,
  ): Promise<boolean> => {
    const windowStartedAt = performance.now();
    const expectedGeneration = latestReplayRef.current?.generation ?? null;
    historyEpochRef.current += 1;
    historyAbortRef.current?.abort();
    historyAbortRef.current = null;
    historyLoadingRef.current = false;
    historyLastBarsBeforeRef.current = null;
    historyLaterExhaustedThroughRef.current = null;
    const requestId = ++windowRequestRef.current;
    windowAbortRef.current?.abort();
    windowAbortRef.current = null;
    const { cacheKey, params } = replayWindowRequest(
      dataset, endSequence, displayIntervalSeconds, displaySession, warmupCount, focusSequence,
      viewport ? Math.min(2000, Math.max(300, Math.ceil(viewport.logicalSpan) + 4)) : undefined,
    );
    let data = windowCache.current.get(cacheKey);
    const cacheHit = Boolean(data);
    if (!data) {
      const controller = new AbortController();
      windowAbortRef.current = controller;
      try {
        const response = await fetch(`/api/market-datasets/${dataset.id}/bars/window?${params}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? copy.marketReplay.loadError);
        data = body as WindowPayload;
        windowCache.current.set(cacheKey, data);
      } catch (error) {
        if (controller.signal.aborted) return false;
        throw error;
      } finally {
        if (windowAbortRef.current === controller) windowAbortRef.current = null;
      }
    }
    performance.measure(cacheHit ? "market-replay-window-cache" : "market-replay-window-network", {
      start: windowStartedAt,
      end: performance.now(),
    });
    performance.clearMeasures(cacheHit ? "market-replay-window-cache" : "market-replay-window-network");
    // A focused chart may omit the live tail. Keep a separate bounded calculation
    // window so playback/ABR never bridges the unloaded history between the two.
    let playbackWindow: WindowPayload | null = null;
    if (viewport?.mode === "history" && (data.lastSourceBar?.sequence ?? -1) < endSequence) {
      const liveRequest = replayWindowRequest(dataset, endSequence, displayIntervalSeconds, displaySession, warmupCount);
      playbackWindow = windowCache.current.get(liveRequest.cacheKey) ?? null;
      if (!playbackWindow) {
        const controller = new AbortController();
        windowAbortRef.current = controller;
        try {
          const response = await fetch(`/api/market-datasets/${dataset.id}/bars/window?${liveRequest.params}`, { signal: controller.signal });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? copy.marketReplay.loadError);
          playbackWindow = body as WindowPayload;
          windowCache.current.set(liveRequest.cacheKey, playbackWindow);
        } catch (error) {
          if (controller.signal.aborted) return false;
          throw error;
        } finally {
          if (windowAbortRef.current === controller) windowAbortRef.current = null;
        }
      }
      if (playbackWindow.lastSourceBar?.sequence !== endSequence) throw new Error(copy.marketReplay.loadError);
    }
    if (!canApply() || requestId !== windowRequestRef.current) return false;
    if (!reviewOnly || viewport) {
      const live = latestReplayRef.current;
      if (!live
        || live.generation !== expectedGeneration
        || live.currentSequence !== endSequence
        || live.displayIntervalSeconds !== displayIntervalSeconds
        || live.displaySession !== displaySession) return false;
    }
    const closeCompletedBucket = (bar: AggregatedMarketBarData) => (
      bar.timestamp === completedDisplayBucketStart
        ? closeAggregatedBar(bar)
        : bar
    );
    const freshVisible = data.visibleBars.map(closeCompletedBucket);
    const refreshed = preserveHistory ? mergeRefreshedReplayWindow(barsRef.current, warmupBarsRef.current,
      freshVisible, data.warmupBars, warmupCount, dataset.barEmissionMode, endSequence)
      : { bars: freshVisible, warmupBars: data.warmupBars };
    const visible = refreshed.bars;
    barsRef.current = visible;
    warmupBarsRef.current = refreshed.warmupBars;
    if (!reviewOnly || viewport) playbackDisplayRef.current = playbackWindow
      ? { bars: playbackWindow.visibleBars, warmupBars: playbackWindow.warmupBars } : null;
    setBars(visible);
    setChartDisplay({ displayIntervalSeconds, displaySession, viewport });
    if (viewport) chartWindowDetachedRef.current = (data.lastSourceBar?.sequence ?? -1) < endSequence;
    setChartDataRevision(replayDisplayMetadataKey(dataset));
    setWarmupBars(refreshed.warmupBars);
    void loadTradeAnnotations(visible, focusJournalNo);
    historyHasEarlierRef.current = data.hasEarlierBars ?? nextHistoryEndSequence(visible) !== null;
    if (!reviewOnly) {
      chartWindowDetachedRef.current = false;
      currentSourceBarRef.current = data.lastSourceBar;
      setCurrentSourceBar(data.lastSourceBar);
      void getDisplayCache(displayIntervalSeconds, displaySession).persist([...refreshed.warmupBars, ...visible]);
    }
    const account = confirmedPaperSnapshotRef.current;
    const needsSourcePlayback = latestReplayRef.current?.status === "playing" || !paperSessionLoadedRef.current
      || (account && !canAdvanceFlatAccount(account.session, account.activeOrders.length, account.openLots?.length ?? 0));
    if (dataset.sourceIntervalSeconds && needsSourcePlayback) {
      const anchor = tradingDayForTimestamp(data.lastSourceBar?.timestamp ?? dataset.startTime, marketSession);
      marketCache.prefetch(anchor);
    }
    return true;
  }, [dataset, getDisplayCache, latestReplayRef, loadTradeAnnotations, marketCache, marketSession, windowCache, fetch, confirmedPaperSnapshotRef, paperSessionLoadedRef, barsRef, chartWindowDetachedRef, currentSourceBarRef, historyAbortRef, historyEpochRef, historyHasEarlierRef, historyLastBarsBeforeRef, historyLaterExhaustedThroughRef, historyLoadingRef, setBars, setChartDisplay, setChartDataRevision, setCurrentSourceBar, setWarmupBars, warmupBarsRef, playbackDisplayRef, windowAbortRef, windowRequestRef]);

  const primeWindow = useCallback(async (
    endSequence: number,
    displayIntervalSeconds: number,
    displaySession: DisplaySession,
    warmupCount: number,
  ) => {
    const { cacheKey, params } = replayWindowRequest(
      dataset, endSequence, displayIntervalSeconds, displaySession, warmupCount,
    );
    if (windowCache.current.get(cacheKey)) return;
    const startedAt = performance.now();
    const controller = new AbortController();
    windowPrefetchAbortRef.current?.abort();
    windowPrefetchAbortRef.current = controller;
    try {
      const response = await fetch(`/api/market-datasets/${dataset.id}/bars/window?${params}`, { signal: controller.signal });
      const body = await response.json();
      if (response.ok) windowCache.current.set(cacheKey, body as WindowPayload);
    } finally {
      if (windowPrefetchAbortRef.current === controller) windowPrefetchAbortRef.current = null;
      performance.measure("market-replay-window-prefetch", { start: startedAt, end: performance.now() });
      performance.clearMeasures("market-replay-window-prefetch");
    }
  }, [dataset, windowCache, fetch, windowPrefetchAbortRef]);

  const hydrateCachedHistory = useCallback(async (
    currentSequence: number,
    displayIntervalSeconds: number,
    displaySession: DisplaySession,
    requirePaused = true,
  ) => {
    if (historyLoadingRef.current || !dataset.sourceIntervalSeconds) return false;
    const epoch = historyEpochRef.current;
    const stillCurrent = () => {
      const current = latestReplayRef.current;
      return epoch === historyEpochRef.current
        && current?.currentSequence === currentSequence
        && current.displayIntervalSeconds === displayIntervalSeconds
        && current.displaySession === displaySession
        && (!requirePaused || current.status !== "playing");
    };
    if (!stillCurrent()) return false;
    historyLoadingRef.current = true;
    try {
      const warmupCount = Math.min(EMA_LENGTH_MAX, indicatorWarmupCountRef.current);
      const currentBars = barsRef.current;
      const pageSize = Math.min(
        REPLAY_HISTORY_BAR_LIMIT - currentBars.length,
        replayHistoryPageSize(dataset.sourceIntervalSeconds, displayIntervalSeconds),
      );
      if (!currentBars.length || pageSize <= 0) return false;
      const session = resolveDisplaySession(dataset, displaySession) ?? marketSession;
      const cache = getDisplayCache(displayIntervalSeconds, displaySession);
      const cached = await cache.readBefore(
        currentBars.at(-1)!.lastSequence,
        Math.min(REPLAY_HISTORY_BAR_LIMIT + warmupCount, currentBars.length + pageSize + warmupCount),
      );
      if (!stillCurrent()) return false;
      let cachedPage = contiguousCachedHistoryBefore(
        cached,
        currentBars,
        pageSize,
        session,
      );
      if (!cachedPage.length) {
        const cursor = nextHistoryEndSequence(currentBars);
        if (cursor !== null) {
          const oldestTimestamp = currentBars[0]?.timestamp ?? dataset.startTime;
          const startDate = tradingDayForTimestamp(oldestTimestamp, marketSession);
          const sourceBars = await marketCache.readCachedBarsBefore(cursor, startDate, {
            maxBars: REPLAY_HISTORY_RAW_SOURCE_BUDGET,
          });
          if (sourceBars.length && stillCurrent()) {
            const aggregated = aggregateMarketBars({
              emissionMode: dataset.barEmissionMode,
              bars: sourceBars,
              sourceSeconds: dataset.sourceIntervalSeconds,
              displaySeconds: displayIntervalSeconds,
              session,
              currentSequence: cursor,
              finalSequence: dataset.barCount - 1,
            }).map((bar, index, all) => index === all.length - 1 && bar.status === "FORMING"
              ? closeAggregatedBar(bar)
              : bar);
            cachedPage = contiguousCachedHistoryBefore(
              aggregated,
              currentBars,
              pageSize,
              session,
            );
            void cache.persist(aggregated);
          }
        }
      }
      if (!cachedPage.length || !stillCurrent()) return false;
      const merged = mergeReplayHistory(
        [cachedPage, warmupBarsRef.current, currentBars],
        warmupCount,
      );
      barsRef.current = merged.bars;
      warmupBarsRef.current = merged.warmupBars;
      startTransition(() => {
        setBars(merged.bars);
        setWarmupBars(merged.warmupBars);
        setChartFocusSequence(null);
      });
      historyHasEarlierRef.current = nextHistoryEndSequence(merged.bars) !== null;
      return merged.bars.length > currentBars.length;
    } finally {
      if (epoch === historyEpochRef.current) historyLoadingRef.current = false;
    }
  }, [dataset, getDisplayCache, latestReplayRef, marketCache, marketSession, barsRef, historyEpochRef, historyHasEarlierRef, historyLoadingRef, indicatorWarmupCountRef, setBars, setChartFocusSequence, setWarmupBars, warmupBarsRef]);

  const loadEarlierHistory = useCallback(async () => {
    const current = latestReplayRef.current;
    if (!current || viewChangingRef.current || historyLoadingRef.current || !historyHasEarlierRef.current
      || barsRef.current.length >= REPLAY_HISTORY_BAR_LIMIT || !dataset.sourceIntervalSeconds) return;
    const startingEpoch = historyEpochRef.current;
    const addedFromCache = await hydrateCachedHistory(
      current.currentSequence, current.displayIntervalSeconds, current.displaySession, false,
    );
    if (addedFromCache) return;
    if (startingEpoch !== historyEpochRef.current || historyLoadingRef.current) return;
    const endSequence = nextHistoryEndSequence(barsRef.current);
    if (endSequence === null) {
      historyHasEarlierRef.current = false;
      return;
    }
    historyLoadingRef.current = true;
    const epoch = historyEpochRef.current;
    const controller = new AbortController();
    historyAbortRef.current?.abort();
    historyAbortRef.current = controller;
    beginBuffering();
    try {
      const visibleCount = Math.min(
        REPLAY_HISTORY_BAR_LIMIT - barsRef.current.length,
        replayHistoryPageSize(dataset.sourceIntervalSeconds, current.displayIntervalSeconds),
      );
      const params = new URLSearchParams({
        displayIntervalSeconds: String(current.displayIntervalSeconds),
        displaySession: current.displaySession,
        endSequence: String(endSequence),
        visibleCount: String(visibleCount),
        warmupCount: String(Math.min(EMA_LENGTH_MAX, indicatorWarmupCountRef.current)),
      });
      const response = await fetch(`/api/market-datasets/${dataset.id}/bars/window?${params}`, { signal: controller.signal });
      const body = await response.json() as WindowPayload & { error?: string };
      if (!response.ok) throw new Error(body.error ?? copy.marketReplay.loadError);
      const live = latestReplayRef.current;
      if (controller.signal.aborted || epoch !== historyEpochRef.current || !live
        || live.displayIntervalSeconds !== current.displayIntervalSeconds || live.displaySession !== current.displaySession) return;
      const merged = mergeReplayHistory(
        [body.warmupBars, body.visibleBars, warmupBarsRef.current, barsRef.current],
        Math.min(EMA_LENGTH_MAX, indicatorWarmupCountRef.current),
      );
      barsRef.current = merged.bars;
      warmupBarsRef.current = merged.warmupBars;
      setBars(merged.bars);
      setWarmupBars(merged.warmupBars);
      setChartFocusSequence(null);
      historyHasEarlierRef.current = body.hasEarlierBars ?? nextHistoryEndSequence(body.visibleBars) !== null;
      void getDisplayCache(current.displayIntervalSeconds, current.displaySession).persist([...body.warmupBars, ...body.visibleBars]);
    } catch (error) {
      if (!controller.signal.aborted) setPaperError(error instanceof Error ? error.message : copy.marketReplay.loadError);
    } finally {
      if (historyAbortRef.current === controller) {
        historyAbortRef.current = null;
        historyLoadingRef.current = false;
      }
      endBuffering();
    }
  }, [beginBuffering, dataset.id, dataset.sourceIntervalSeconds, endBuffering, getDisplayCache, hydrateCachedHistory, latestReplayRef, fetch, barsRef, historyAbortRef, historyEpochRef, historyHasEarlierRef, historyLoadingRef, indicatorWarmupCountRef, setBars, setChartFocusSequence, setPaperError, setWarmupBars, warmupBarsRef, viewChangingRef]);

  const loadLaterHistory = useCallback(async () => {
    const current = latestReplayRef.current;
    const last = barsRef.current.at(-1);
    if (!current || !last || !dataset.sourceIntervalSeconds || historyLoadingRef.current
      || viewChangingRef.current || last.lastSequence >= current.currentSequence
      || (historyLaterExhaustedThroughRef.current ?? -1) >= current.currentSequence) return;
    historyLoadingRef.current = true;
    const epoch = historyEpochRef.current;
    const controller = new AbortController();
    historyAbortRef.current?.abort();
    historyAbortRef.current = controller;
    beginBuffering();
    const stillCurrent = () => {
      const live = latestReplayRef.current;
      return !controller.signal.aborted && epoch === historyEpochRef.current
        && live?.generation === current.generation && live.currentSequence === current.currentSequence
        && live.displayIntervalSeconds === current.displayIntervalSeconds && live.displaySession === current.displaySession;
    };
    try {
      const visibleCount = replayHistoryPageSize(dataset.sourceIntervalSeconds, current.displayIntervalSeconds);
      const warmupCount = Math.min(EMA_LENGTH_MAX, indicatorWarmupCountRef.current);
      const data = await readLaterHistoryWindow({
        afterSequence: last.lastSequence, endSequence: current.currentSequence,
        sourceSeconds: dataset.sourceIntervalSeconds, displaySeconds: current.displayIntervalSeconds, visibleCount,
        shouldContinue: stillCurrent,
        readWindow: async (focusSequence) => {
          const params = new URLSearchParams({
            displayIntervalSeconds: String(current.displayIntervalSeconds), displaySession: current.displaySession,
            endSequence: String(current.currentSequence), focusSequence: String(focusSequence),
            visibleCount: String(visibleCount), warmupCount: String(warmupCount),
          });
          const response = await fetch(`/api/market-datasets/${dataset.id}/bars/window?${params}`, { signal: controller.signal });
          const body = await response.json() as WindowPayload & { error?: string };
          if (!response.ok) throw new Error(body.error ?? copy.marketReplay.loadError);
          return body;
        },
      });
      if (!stillCurrent()) return;
      if (!data) {
        historyLaterExhaustedThroughRef.current = current.currentSequence;
        chartWindowDetachedRef.current = false;
        return;
      }
      const merged = mergeReplayHistory([warmupBarsRef.current, barsRef.current, data.warmupBars, data.visibleBars], warmupCount);
      barsRef.current = merged.bars;
      warmupBarsRef.current = merged.warmupBars;
      setChartFocusSequence(null);
      setBars(merged.bars);
      setWarmupBars(merged.warmupBars);
      if (data.lastSourceBar?.sequence === current.currentSequence) chartWindowDetachedRef.current = false;
      void getDisplayCache(current.displayIntervalSeconds, current.displaySession).persist([...data.warmupBars, ...data.visibleBars]);
    } catch (error) {
      if (stillCurrent()) setPaperError(error instanceof Error ? error.message : copy.marketReplay.loadError);
    } finally {
      if (historyAbortRef.current === controller) {
        historyAbortRef.current = null;
        historyLoadingRef.current = false;
      }
      endBuffering();
    }
  }, [beginBuffering, dataset.id, dataset.sourceIntervalSeconds, endBuffering, getDisplayCache, latestReplayRef, fetch, barsRef, chartWindowDetachedRef, historyAbortRef, historyEpochRef, historyLaterExhaustedThroughRef, historyLoadingRef, indicatorWarmupCountRef, setBars, setChartFocusSequence, setPaperError, setWarmupBars, viewChangingRef, warmupBarsRef]);

  const handleVisibleSequenceRange = useCallback((range: ReplayVisibleSequenceRange) => {
    if (viewChangingRef.current) return;
    if (annotationTimerRef.current) clearTimeout(annotationTimerRef.current);
    annotationTimerRef.current = setTimeout(() => {
      const live = latestReplayRef.current;
      if (replaySession && live && range.fromSequence <= live.currentSequence) registerAiScope?.("chart", aiChartOwner, {
        replaySessionId: replaySession.id, projectionId: replaySession.activeProjectionId, sessionName: replaySession.name, includeCurrentChart: true,
        chartWindow: { fromSequence: range.fromSequence, toSequence: Math.min(range.toSequence, live.currentSequence), displayIntervalSeconds: live.displayIntervalSeconds, displaySession: live.displaySession },
      });
      const visible = barsRef.current.filter((bar) => (
        bar.lastSequence >= range.fromSequence && bar.firstSequence <= range.toSequence
      ));
      void loadTradeAnnotations(visible, null, false);
    }, 120);
    const previousBarsBefore = historyLastBarsBeforeRef.current;
    historyLastBarsBeforeRef.current = range.barsBefore;
    if (range.barsAfter <= REPLAY_HISTORY_PREFETCH_THRESHOLD
      && (barsRef.current.at(-1)?.lastSequence ?? -1) < (latestReplayRef.current?.currentSequence ?? -1)
      && (historyLaterExhaustedThroughRef.current ?? -1) < (latestReplayRef.current?.currentSequence ?? -1)) {
      void loadLaterHistory();
      return;
    }
    const movedLeft = previousBarsBefore !== null && range.barsBefore < previousBarsBefore - 1;
    if (movedLeft && range.barsBefore <= REPLAY_HISTORY_PREFETCH_THRESHOLD) {
      void loadEarlierHistory();
    }
  }, [latestReplayRef, loadEarlierHistory, loadLaterHistory, loadTradeAnnotations, registerAiScope, aiChartOwner, replaySession, annotationTimerRef, barsRef, historyLastBarsBeforeRef, historyLaterExhaustedThroughRef, viewChangingRef]);

  useEffect(() => {
    if (!emaSettingsLoaded || !abrSettingsLoaded || initializedDatasetRef.current === dataset.id) return;
    let cancelled = false;
    const initialize = async () => {
      const initializedAt = performance.now();
      if (!dataset.sourceIntervalSeconds) throw new Error(copy.marketReplay.invalidDisplayInterval);
      const hint = dataset.progress;
      const prefetch = hint
        ? primeWindow(
            hint.currentSequence,
            hint.displayIntervalSeconds ?? dataset.sourceIntervalSeconds,
            hint.displaySession ?? "ETH",
            indicatorWarmupCountRef.current,
          ).catch(() => undefined)
        : Promise.resolve();
      const response = await fetch(`/api/market-datasets/${dataset.id}/progress`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? copy.marketReplay.loadError);
      if (data.projectionId && data.projectionId !== replaySession?.activeProjectionId) throw new Error(copy.replaySessions.projectionChanged);
      if (!cancelled) {
        commitConfirmedPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
        paperSessionLoadedRef.current = true;
        paperSessionLoadRef.current = Promise.resolve();
      }
      const progress = data.progress;
      if (progress) {
        const hintMatches = hint
          && hint.generation === progress.generation
          && hint.currentSequence === progress.currentSequence
          && (hint.displayIntervalSeconds ?? dataset.sourceIntervalSeconds) === (progress.displayIntervalSeconds ?? dataset.sourceIntervalSeconds)
          && (hint.displaySession ?? "ETH") === (progress.displaySession ?? "ETH");
        if (hintMatches) await prefetch;
        const next = createReplayState(
          dataset.barCount, progress.startSequence, progress.playbackRate,
          progress.displayIntervalSeconds ?? dataset.sourceIntervalSeconds, progress.currentSequence,
          progress.generation, progress.syncVersion, progress.displaySession ?? "ETH",
        );
        if (!cancelled) setReplay(next);
        await loadWindow(next.currentSequence, next.displayIntervalSeconds, next.displaySession, indicatorWarmupCountRef.current);
      }
      performance.measure("market-replay-initialize", { start: initializedAt, end: performance.now() });
      performance.clearMeasures("market-replay-initialize");
    };
    initialize().then(() => { if (!cancelled) initializedDatasetRef.current = dataset.id; }).catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : copy.marketReplay.loadError); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [abrSettingsLoaded, commitConfirmedPaperSnapshot, dataset, emaSettingsLoaded, loadWindow, paperSessionLoadedRef, paperSessionLoadRef, primeWindow, setReplay, fetch, replaySession?.activeProjectionId, indicatorWarmupCountRef, initializedDatasetRef, setIsLoading, setLoadError]);

  useReplayIndicatorWarmup(core);

  return {
    armDrawing, changeChartVisibility, armTrendLine, armFibonacciRetracement, createDrawing, updateDrawing,
    deleteDrawing, clearDrawings, openDrawingStyle, visibleDrawings, loadTradeAnnotations, loadWindow,
    loadEarlierHistory, handleVisibleSequenceRange,
  };
}
