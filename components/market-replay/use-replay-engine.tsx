"use client";

import { advancedDisplayBars, manualAdvanceBatchSize, mergeDisplayAdvanceWindow } from "@/lib/market-replay/advance-display";
import { createUuid } from "@/lib/uuid";
import { selectedTimeToTimestamp } from "@/lib/market-replay/start-time";
import { useCallback, useEffect } from "react";
import { DEFAULT_REPLAY_MAX_VISIBLE_BARS } from "@/lib/market-replay/chart-range";
import { isReplayPlaybackShortcut, hasVisibleReplayDialog, isReplayShortcutInputTarget, replayDrawingShortcutKey } from "@/lib/market-replay/keyboard-shortcuts";
import { copy } from "@/lib/i18n";
import { createReplayState, calculatePlaybackAdvance } from "@/lib/market-replay/engine";
import { getAggregationBucket, mergeSourceBarInto } from "@/lib/market-replay/aggregation";
import { replayDatasetUpdate, replayDisplayMetadataKey, startDisplayMetadataRefresh } from "@/lib/market-replay/dataset-refresh";
import { canAdvanceFlatAccount } from "@/lib/paper-trading/flat-advance";
import { calculateLatestAbr } from "@/lib/market-replay/abr";
import { tradingDayForTimestamp } from "@/lib/market-replay/chunks";
import { MAX_REPLAY_BULK_SOURCE_BARS, REPLAY_HISTORY_BAR_LIMIT, REPLAY_HISTORY_COMPACT_TO, type MarketDatasetSummary, type ReplayState } from "@/lib/market-replay/types";
import type { PaperSessionSnapshot } from "@/lib/paper-trading/types";
import type { ReplayServerRequest } from "@/lib/market-replay/server-sync-types";
import { requestReplayAdvance, retryReplayOperation, assertForwardReplayResult, ReplayRequestError } from "@/lib/market-replay/server-request";
import { appendContextRun, type ReplayContextRun } from "@/lib/replay-sessions/context-runs";
import { type ReplayPlaybackIntent, type ReplaySuspension } from "@/lib/market-replay/playback-lifecycle";
import { HistoryVersionConflict } from "@/lib/market-replay/history-version";
import { resolveReplayServerResponse } from "@/lib/market-replay/server-response";
import type { ReplayServerResponse } from "@/lib/market-replay/server-sync-types";
import { ServerAdvancePayload, REPLAY_SYNC_BATCH_SIZE, JournalFocus } from "./replay-client-shared";
import type { useReplayCore } from "./use-replay-core";
import type { useReplayDrawingWindow } from "./use-replay-drawing-window";

export function useReplayEngine(core: ReturnType<typeof useReplayCore>, drawingWindow: ReturnType<typeof useReplayDrawingWindow>) {
  const {
    fetch, replaySession, router, dateDialogOpen, dateDialogOpening, dateForwarding,
    correctionPending, dataset, setLiveDataset, displayedMetadataRef, historyConflictRef, requestRetryingRef,
    setRetrying, serverLifetimeRef, shortcuts, setBars,
    setWarmupBars, setCurrentSourceBar, isLoading, replay, setReplay,
    latestReplayRef, pauseReason, playPlayback, pausePlayback, autoPausePlayback, suspendPlayback,
    restorePlayback, finishPlayback, capturePlaybackIntent, wantsPlayback, startPickerRef, setStartValue,
    startDialogOpen, startDialogSuspensionRef, setStartError, setSaveStatus, confirmAction,
    settingsDialog, paperSnapshot, confirmedPaperSnapshotRef, paperSessionLoadedRef, paperSessionLoadRef, paperMutationActiveRef,
    paperMutationChainRef, commitConfirmedPaperSnapshot, setPaperError, journalReview, setJournalReview, setChartFocusSequence,
    chartWindowDetachedRef, setReviewReturning, setRecoveryNotice, gateDialogOpen, setGateNotice, checkingOrder,
    preparingEntryCheckRef, gateSeenRef, rectangleStyleId, styleDrawingId, abrLength, displayUtcOffsetMinutes,
    textDrawing, indicatorWarmupCountRef, manualStepsRef, stepShortcutRef, marketSession, displayMarketSession,
    marketCache, getDisplayCache, barsRef, warmupBarsRef, currentSourceBarRef, recoveryRequiredRef,
    viewChangingRef, windowRequestRef, windowAbortRef, historyAbortRef, historyEpochRef, pendingSaveRef,
    saveTimerRef, lastSaveAtRef, saveChainRef, advancingRef, advanceCompletionRef, playbackAccumulatorRef,
    playbackClockRef, playbackEpochRef, initialJournalFocusAppliedRef, beginBuffering, endBuffering, initialJournalFocus,
  } = core;
  const {
    armDrawing, loadTradeAnnotations, loadWindow,
  } = drawingWindow;
  const reloadPaper = useCallback(async () => {
    const response = await fetch(`/api/market-datasets/${dataset.id}/paper-session`);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error ?? copy.paperTrading.requestFailed);
    if (data.projectionId && data.projectionId !== replaySession?.activeProjectionId) { historyConflictRef.current = true; pausePlayback(); throw new Error(copy.replaySessions.projectionChanged); }
    commitConfirmedPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
    paperSessionLoadedRef.current = true;
    return data.snapshot as PaperSessionSnapshot | null;
  }, [commitConfirmedPaperSnapshot, dataset.id, paperSessionLoadedRef, fetch, pausePlayback, replaySession?.activeProjectionId, historyConflictRef]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const next = pendingSaveRef.current;
    if (!next) return;
    pendingSaveRef.current = null;
    lastSaveAtRef.current = Date.now();
    setSaveStatus("saving");
    saveChainRef.current = saveChainRef.current.catch(() => undefined).then(async () => {
      const response = await fetch(`/api/market-datasets/${dataset.id}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startSequence: next.startSequence,
          currentSequence: next.currentSequence,
          playbackRate: next.playbackRate,
          displayIntervalSeconds: next.displayIntervalSeconds,
          displaySession: next.displaySession,
        }),
      });
      if (!response.ok) throw new Error(copy.marketReplay.saveError);
      setSaveStatus("saved");
    }).catch(() => setSaveStatus("error"));
  }, [dataset.id, fetch, lastSaveAtRef, pendingSaveRef, saveChainRef, saveTimerRef, setSaveStatus]);

  const queueSave = useCallback((next: ReplayState, immediate: boolean) => {
    pendingSaveRef.current = next;
    if (immediate) {
      flushSave();
      return;
    }
    if (saveTimerRef.current) return;
    const delay = Math.max(0, 1_000 - (Date.now() - lastSaveAtRef.current));
    saveTimerRef.current = setTimeout(flushSave, delay);
  }, [flushSave, lastSaveAtRef, pendingSaveRef, saveTimerRef]);

  const readReplayData = useCallback(async <T,>(read: () => Promise<T>) => {
    const signal = serverLifetimeRef.current!.signal;
    let suspension: ReplaySuspension | null = null;
    try {
      return await retryReplayOperation(read, { signal, onRetry: () => {
        suspension ??= suspendPlayback(); requestRetryingRef.current = true; setRetrying(true);
        setRecoveryNotice(copy.marketReplay.advanceRetrying);
      } });
    } finally {
      if (!signal.aborted && suspension) {
        requestRetryingRef.current = false; setRetrying(false); setRecoveryNotice(null);
        playbackAccumulatorRef.current = 0; playbackClockRef.current = performance.now(); restorePlayback(suspension);
      }
    }
  }, [restorePlayback, suspendPlayback, playbackAccumulatorRef, playbackClockRef, requestRetryingRef, serverLifetimeRef, setRecoveryNotice, setRetrying]);

  const executeServerAdvance = useCallback(async (
    url: string, body: { requestId: string; [key: string]: unknown }, accept: (data: ServerAdvancePayload) => void | Promise<void>,
  ) => {
    const signal = serverLifetimeRef.current?.signal;
    if (!signal || signal.aborted || historyConflictRef.current || recoveryRequiredRef.current || confirmedPaperSnapshotRef.current?.propAccount?.state.result) return false;
    let suspension: ReplaySuspension | null = null;
    setSaveStatus("saving");
    try {
      const wire = await requestReplayAdvance<Omit<ServerAdvancePayload, "snapshot"> & ReplayServerResponse>({
        fetch, url, body: JSON.stringify({ ...body, snapshotMode: "LIVE" }), signal,
        onRetry: () => {
          suspension ??= suspendPlayback();
          requestRetryingRef.current = true; setRetrying(true);
          setRecoveryNotice(copy.marketReplay.advanceRetrying);
        },
      });
      if (signal.aborted) return false;
      if (wire.flatAdvanceUnavailable) { setSaveStatus("saved"); return false; }
      const data = resolveReplayServerResponse(wire, confirmedPaperSnapshotRef.current,
        (body.expectedPaperVersion ?? body.expectedVersion ?? null) as number | null);
      const current = latestReplayRef.current;
      if (!current) return false;
      if (!(data.propStopped && data.currentSequence === current.currentSequence)) assertForwardReplayResult(current, data);
      if (data.requestId !== body.requestId || data.fromSequence !== current.currentSequence
        || data.historyVersion !== (dataset.historyVersion ?? 1)
        || (data.snapshot && data.snapshot.session.lastProcessedSequence !== data.currentSequence)) {
        throw new ReplayRequestError(copy.marketReplay.advanceConflict, 409, "STATE_CONFLICT");
      }
      await accept(data);
      if (data.propStopped) { pausePlayback(); manualStepsRef.current.cancel(); }
      setSaveStatus("saved"); setPaperError(null);
      return true;
    } catch (error) {
      if (signal.aborted) return false;
      recoveryRequiredRef.current = true;
      if (error instanceof HistoryVersionConflict || (error instanceof ReplayRequestError && error.code === "HISTORY_CHANGED")) historyConflictRef.current = true;
      setPaperError(error instanceof ReplayRequestError && error.status === 409
        ? (error.code === "HISTORY_CHANGED" ? copy.marketSync.historyChanged : copy.marketReplay.advanceConflict)
        : error instanceof Error ? error.message : copy.paperTrading.advanceFailed);
      setSaveStatus("error"); autoPausePlayback("sync-conflict");
      return false;
    } finally {
      if (!signal.aborted) {
        requestRetryingRef.current = false; setRetrying(false); setRecoveryNotice(null);
        if (suspension) { playbackAccumulatorRef.current = 0; playbackClockRef.current = performance.now(); }
        restorePlayback(suspension);
      }
    }
  }, [autoPausePlayback, confirmedPaperSnapshotRef, dataset.historyVersion, fetch, latestReplayRef, restorePlayback, suspendPlayback, historyConflictRef, playbackAccumulatorRef, playbackClockRef, recoveryRequiredRef, requestRetryingRef, serverLifetimeRef, setPaperError, setRecoveryNotice, setRetrying, setSaveStatus, pausePlayback, manualStepsRef]);

  const flushVisible = useCallback(async () => {
    await advanceCompletionRef.current;
    return !historyConflictRef.current && !recoveryRequiredRef.current;
  }, [advanceCompletionRef, historyConflictRef, recoveryRequiredRef]);

  const propResult = paperSnapshot?.propAccount?.state.result;
  useEffect(() => {
    if (propResult) { pausePlayback(); manualStepsRef.current.cancel(); }
  }, [propResult, pausePlayback, manualStepsRef]);

  useEffect(() => {
    if (isLoading) return;
    let stopped = false; let checking = false;
    const refreshTail = async () => {
      if (checking || stopped || paperMutationActiveRef.current) return;
      checking = true;
      let suspension: ReplaySuspension | null = null;
      try {
        const response = await fetch(`/api/market-datasets/${dataset.id}`, { cache: "no-store" });
        if (!response.ok || stopped) return;
        const next = await response.json() as MarketDatasetSummary;
        if (replayDatasetUpdate(dataset, next) === "none") return;
        suspension = suspendPlayback();
        await advanceCompletionRef.current;
        if ((next.historyVersion ?? 1) !== (dataset.historyVersion ?? 1)) {
          historyConflictRef.current = true;
          setPaperError(copy.marketSync.historyChanged);
          autoPausePlayback("sync-conflict"); return;
        }
        if (!await flushVisible() || stopped) return;
        setLiveDataset(next);
        setReplay((value) => value ? { ...value, barCount: next.barCount, status: value.status === "finished" && value.currentSequence < next.barCount - 1 ? "paused" : value.status } : value);
      } catch { /* Retry later while preserving the current replay. */ }
      finally { if (suspension && !stopped) restorePlayback(suspension); checking = false; }
    };
    const timer = window.setInterval(() => void refreshTail(), 15000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [autoPausePlayback, dataset, flushVisible, isLoading, paperMutationActiveRef, restorePlayback, setReplay, suspendPlayback, fetch, advanceCompletionRef, historyConflictRef, setLiveDataset, setPaperError]);

  useEffect(() => {
    const metadata = replayDisplayMetadataKey(dataset);
    if (isLoading || metadata === displayedMetadataRef.current) return;
    // Fence responses requested with the old display semantics immediately.
    windowRequestRef.current += 1;
    windowAbortRef.current?.abort();
    historyEpochRef.current += 1;
    historyAbortRef.current?.abort();
    let refreshError: string | null = null;
    return startDisplayMetadataRefresh({
      shouldRetry: () => !historyConflictRef.current,
      load: async isActive => {
        const suspension = suspendPlayback();
        try {
          await advanceCompletionRef.current;
          await paperMutationChainRef.current;
          const current = latestReplayRef.current;
          if (!isActive() || !current || historyConflictRef.current) return false;
          const reviewOnly = chartWindowDetachedRef.current || journalReview !== null;
          const end = reviewOnly ? barsRef.current.at(-1)?.lastSequence ?? current.currentSequence : current.currentSequence;
          return await loadWindow(end, current.displayIntervalSeconds, current.displaySession, indicatorWarmupCountRef.current,
            null, null, reviewOnly, journalReview?.globalNo ?? null, true, isActive);
        } finally { restorePlayback(suspension); }
      },
      applied: () => {
        displayedMetadataRef.current = metadata;
        if (refreshError !== null) setPaperError(current => current === refreshError ? null : current);
      },
      failed: error => {
        refreshError = error instanceof Error ? error.message : copy.marketReplay.loadError;
        setPaperError(refreshError);
        autoPausePlayback("operation-failed");
      },
    });
  }, [autoPausePlayback, dataset, isLoading, journalReview, latestReplayRef, loadWindow, paperMutationChainRef, restorePlayback, suspendPlayback, advanceCompletionRef, barsRef, chartWindowDetachedRef, displayedMetadataRef, historyAbortRef, historyConflictRef, historyEpochRef, indicatorWarmupCountRef, setPaperError, windowAbortRef, windowRequestRef]);

  useEffect(() => {
    const gate = paperSnapshot?.session.trainingGate;
    if (!gate) return;
    const previous = gateSeenRef.current;
    gateSeenRef.current = gate.activationCount;
    if (previous !== null && gate.activationCount > previous && gate.source === "LOSS_STREAK") {
      pausePlayback(); manualStepsRef.current.cancel();
      setGateNotice(`${copy.trainingGate.automatic} ${copy.trainingGate.cancelled(gate.cancelledOrderCount)}`);
    }
  }, [paperSnapshot?.session.trainingGate, pausePlayback, gateSeenRef, manualStepsRef, setGateNotice]);

  const fastForwardToNextVisibleBar = useCallback(async (
    shouldContinue: () => boolean = () => true,
    playbackIntent?: ReplayPlaybackIntent,
    flatOnly = false,
  ) => {
    let current = latestReplayRef.current;
    if (!current || viewChangingRef.current || advancingRef.current || paperMutationActiveRef.current) return false;
    viewChangingRef.current = true;
    beginBuffering();
    let resolveAdvance: () => void = () => undefined;
    let ownsAdvance = false;
    try {
      await advanceCompletionRef.current;
      await paperMutationChainRef.current;
      if (!(await flushVisible())) return false;
      advancingRef.current = true; ownsAdvance = true;
      advanceCompletionRef.current = new Promise<void>(resolve => { resolveAdvance = resolve; });
      current = latestReplayRef.current;
      if (!current) return false;
      let next = current;
      let snapshot = confirmedPaperSnapshotRef.current;
      let lastSourceBar = currentSourceBarRef.current;
      let reachedVisibleBucket = false;
      let propStopped = false;
      for (let attempt = 0; attempt < 64 && next.currentSequence < next.barCount - 1; attempt += 1) {
        const abrValue = calculateLatestAbr(warmupBarsRef.current, barsRef.current, abrLength);
        const historyIndex = Math.max(0, warmupBarsRef.current.length + barsRef.current.length - abrLength);
        const historyFirst = historyIndex < warmupBarsRef.current.length ? warmupBarsRef.current[historyIndex]
          : barsRef.current[historyIndex - warmupBarsRef.current.length];
        const ok = await executeServerAdvance(`/api/market-datasets/${dataset.id}/replay/advance`, {
          requestId: createUuid(), expectedCurrentSequence: next.currentSequence,
          historyVersion: dataset.historyVersion ?? 1, expectedVersion: snapshot?.session.version ?? null,
          count: 1, displayIntervalSeconds: next.displayIntervalSeconds, displaySession: next.displaySession,
          ...(flatOnly ? { flatOnly: true, abrHistoryStartSequence: historyFirst?.firstSequence ?? next.currentSequence + 1 } : {}),
          abrValue: abrValue !== null && abrValue > 0 ? abrValue : null, abrLength, displayUtcOffsetMinutes,
        }, async (data) => {
          if (!Array.isArray(data.aggregatedBars) || data.aggregatedBars.some(bar => bar.lastSequence > data.currentSequence)) {
            throw new ReplayRequestError(copy.marketReplay.advanceConflict, 409);
          }
          next = { ...next, currentSequence: data.currentSequence, confirmedSequence: data.currentSequence,
            syncVersion: data.syncVersion, status: data.currentSequence >= next.barCount - 1 ? "finished" : (latestReplayRef.current?.status ?? next.status) };
          snapshot = data.snapshot; lastSourceBar = data.lastSourceBar ?? lastSourceBar;
          propStopped = Boolean(data.propStopped);
          reachedVisibleBucket = data.reachedVisibleBucket ?? false;
          commitConfirmedPaperSnapshot(snapshot);
          setReplay(next); currentSourceBarRef.current = lastSourceBar; setCurrentSourceBar(lastSourceBar);
          const previousTail = barsRef.current.at(-1);
          const window = mergeDisplayAdvanceWindow(barsRef.current, warmupBarsRef.current, data.aggregatedBars,
            indicatorWarmupCountRef.current, next.currentSequence >= next.barCount - 1);
          barsRef.current = window.bars; warmupBarsRef.current = window.warmupBars;
          setBars(window.bars); setWarmupBars(window.warmupBars);
          getDisplayCache(next.displayIntervalSeconds, next.displaySession).schedulePersist(
            advancedDisplayBars(window.bars, data.fromSequence, previousTail));
          if (data.fills.length) void loadTradeAnnotations(window.bars.slice(-DEFAULT_REPLAY_MAX_VISIBLE_BARS));
        });
        if (!ok) return false;
        if (propStopped || reachedVisibleBucket || !shouldContinue()) break;
      }
      return reachedVisibleBucket || (flatOnly && next.currentSequence > current.currentSequence);
    } catch (error) {
      if (error instanceof HistoryVersionConflict) {
        historyConflictRef.current = true;
        setPaperError(copy.marketSync.historyChanged); autoPausePlayback("operation-failed"); return false;
      }
      setPaperError(error instanceof Error ? error.message : copy.paperTrading.advanceFailed);
      autoPausePlayback("operation-failed", playbackIntent);
      return false;
    } finally {
      endBuffering();
      viewChangingRef.current = false;
      if (ownsAdvance) { advancingRef.current = false; resolveAdvance(); }
    }
  }, [abrLength, autoPausePlayback, beginBuffering, commitConfirmedPaperSnapshot, confirmedPaperSnapshotRef, dataset.id,
    dataset.historyVersion, displayUtcOffsetMinutes, endBuffering, executeServerAdvance, flushVisible, latestReplayRef,
    getDisplayCache, loadTradeAnnotations, paperMutationActiveRef, paperMutationChainRef, setReplay, advanceCompletionRef, advancingRef, barsRef, currentSourceBarRef, historyConflictRef, indicatorWarmupCountRef, setBars, setCurrentSourceBar, setPaperError, setWarmupBars, viewChangingRef, warmupBarsRef]);

  const processServerBars = useCallback(async (
    requestedCount: number,
    shouldContinue: () => boolean = () => true,
    playbackIntent?: ReplayPlaybackIntent,
    bulk = false,
  ) => {
    const frameStartedAt = performance.now();
    const current = latestReplayRef.current;
    if (
      historyConflictRef.current || !shouldContinue() || !current || advancingRef.current || paperMutationActiveRef.current || viewChangingRef.current
      || current.currentSequence >= current.barCount - 1 || !dataset.sourceIntervalSeconds
    ) return 0;
    const count = Math.min(requestedCount, bulk ? MAX_REPLAY_BULK_SOURCE_BARS : REPLAY_SYNC_BATCH_SIZE, current.barCount - 1 - current.currentSequence);
    if (count <= 0) return 0;
    advancingRef.current = true;
    let resolveAdvance: () => void = () => undefined;
    advanceCompletionRef.current = new Promise<void>((resolve) => { resolveAdvance = resolve; });
    try {
      if (!paperSessionLoadedRef.current) {
        beginBuffering();
        await paperSessionLoadRef.current;
        endBuffering();
        if (!shouldContinue()) return 0;
      }
      if (recoveryRequiredRef.current) return 0;
      const anchor = tradingDayForTimestamp(
        currentSourceBarRef.current?.timestamp ?? dataset.startTime,
        marketSession,
      );
      const sourceCursor = current.currentSequence;
      const previousDisplayTail = barsRef.current.at(-1);
      let sourceBars = marketCache.readMemoryBarsAfter(sourceCursor, count);
      if (sourceBars.length < count) {
        beginBuffering();
        try {
          sourceBars = await readReplayData(() => (
            marketCache.getBarsAfter(sourceCursor, count, anchor)
          ));
        } finally {
          endBuffering();
        }
      }
      if (!shouldContinue()) return 0;
      if (!sourceBars.length) {
        if (current.currentSequence >= current.barCount - 1) {
          setReplay((value) => value ? { ...value, status: "finished" } : value);
        }
        return 0;
      }
      if (sourceBars[0].sequence !== current.currentSequence + 1) {
        throw new Error(copy.marketReplay.cacheGap);
      }
      sourceBars = sourceBars.slice(0, count);
      let aggregates = barsRef.current.length >= REPLAY_HISTORY_BAR_LIMIT
        ? barsRef.current.slice(-REPLAY_HISTORY_COMPACT_TO)
        : barsRef.current.slice();
      let nextWarmup = warmupBarsRef.current;
      if (aggregates.length !== barsRef.current.length) {
        const dropped = barsRef.current.slice(0, barsRef.current.length - aggregates.length);
        nextWarmup = [...warmupBarsRef.current, ...dropped].slice(-indicatorWarmupCountRef.current);
      }
      const contextRuns: ReplayContextRun[] = [];
      for (const source of sourceBars) {
        const abrValue = calculateLatestAbr(nextWarmup, aggregates, abrLength);
        mergeSourceBarInto(aggregates, source, {
          emissionMode: dataset.barEmissionMode,
          sourceSeconds: dataset.sourceIntervalSeconds,
          displaySeconds: current.displayIntervalSeconds,
          session: displayMarketSession,
          finalSequence: dataset.barCount - 1,
        });
        appendContextRun(contextRuns, source.sequence, {
          abrValue: abrValue !== null && abrValue > 0 ? abrValue : null, abrLength,
          displayIntervalSeconds: current.displayIntervalSeconds, displaySession: current.displaySession,
          displayUtcOffsetMinutes, priceTickSize: dataset.priceTickSize,
        }, current.generation);
      }
      if (aggregates.length > REPLAY_HISTORY_BAR_LIMIT) {
        const dropped = aggregates.slice(0, aggregates.length - REPLAY_HISTORY_COMPACT_TO);
        nextWarmup = [...nextWarmup, ...dropped].slice(-indicatorWarmupCountRef.current);
        aggregates = aggregates.slice(-REPLAY_HISTORY_COMPACT_TO);
      }
      const lastSourceBar = sourceBars.at(-1)!;
      const body: ReplayServerRequest = {
        ...(bulk && count > REPLAY_SYNC_BATCH_SIZE ? { batchMode: "BULK" as const } : {}),
        requestId: createUuid(), generation: current.generation, confirmedSequence: current.currentSequence,
        syncVersion: current.syncVersion, dataVersion: dataset.dataVersion, historyVersion: dataset.historyVersion ?? 1,
        expectedPaperVersion: confirmedPaperSnapshotRef.current?.session.version ?? null,
        targetSequence: lastSourceBar.sequence, contextRuns,
      };
      let processedCount = 0;
      const ok = await executeServerAdvance(`/api/market-datasets/${dataset.id}/replay/sync`, body, (data) => {
        if (data.currentSequence !== lastSourceBar.sequence) {
          if (!data.propStopped || data.currentSequence < sourceCursor || data.currentSequence > lastSourceBar.sequence) throw new ReplayRequestError(copy.marketReplay.advanceConflict, 409);
          aggregates = barsRef.current.slice(); nextWarmup = warmupBarsRef.current;
          for (const source of sourceBars.filter(bar => bar.sequence <= data.currentSequence)) mergeSourceBarInto(aggregates, source, {
            emissionMode: dataset.barEmissionMode, sourceSeconds: dataset.sourceIntervalSeconds!, displaySeconds: current.displayIntervalSeconds,
            session: displayMarketSession, finalSequence: dataset.barCount - 1,
          });
        }
        const acknowledgedLast = sourceBars.find(bar => bar.sequence === data.currentSequence) ?? currentSourceBarRef.current;
        processedCount = data.currentSequence - sourceCursor;
        barsRef.current = aggregates; warmupBarsRef.current = nextWarmup; currentSourceBarRef.current = acknowledgedLast;
        setBars(aggregates); setWarmupBars(nextWarmup); setCurrentSourceBar(acknowledgedLast);
        commitConfirmedPaperSnapshot(data.snapshot);
        setReplay(value => value ? { ...value, currentSequence: data.currentSequence, confirmedSequence: data.currentSequence,
          syncVersion: data.syncVersion, status: data.currentSequence >= value.barCount - 1 ? "finished" : value.status } : value);
        getDisplayCache(current!.displayIntervalSeconds, current!.displaySession).schedulePersist(advancedDisplayBars(aggregates, sourceCursor, previousDisplayTail));
        if (data.fills.length) void loadTradeAnnotations(aggregates.slice(-DEFAULT_REPLAY_MAX_VISIBLE_BARS));
      });
      return ok ? processedCount : 0;
    } catch (error) {
      endBuffering();
      if (error instanceof HistoryVersionConflict) {
        historyConflictRef.current = true;
        setPaperError(copy.marketSync.historyChanged); autoPausePlayback("source-failed"); return 0;
      }
      recoveryRequiredRef.current = true;
      setPaperError(error instanceof Error ? error.message : copy.paperTrading.advanceFailed);
      autoPausePlayback("source-failed", playbackIntent);
      return 0;
    } finally {
      performance.measure("market-replay-source-frame", { start: frameStartedAt, end: performance.now() });
      performance.clearMeasures("market-replay-source-frame");
      advancingRef.current = false;
      resolveAdvance();
    }
  }, [abrLength, autoPausePlayback, beginBuffering, commitConfirmedPaperSnapshot, confirmedPaperSnapshotRef, dataset.barCount,
    dataset.barEmissionMode, dataset.dataVersion, dataset.historyVersion, dataset.id, dataset.priceTickSize, dataset.sourceIntervalSeconds, dataset.startTime,
    displayMarketSession, displayUtcOffsetMinutes, endBuffering, executeServerAdvance, getDisplayCache, latestReplayRef,
    loadTradeAnnotations, marketCache, marketSession, paperMutationActiveRef, paperSessionLoadedRef, paperSessionLoadRef, readReplayData, setReplay, advanceCompletionRef, advancingRef, barsRef, currentSourceBarRef, historyConflictRef, indicatorWarmupCountRef, recoveryRequiredRef, setBars, setCurrentSourceBar, setPaperError, setWarmupBars, viewChangingRef, warmupBarsRef]);

  const replayStatus = replay?.status;
  useEffect(() => {
    if (replayStatus === "finished" && pauseReason !== "finished") finishPlayback();
  }, [finishPlayback, pauseReason, replayStatus]);

  useEffect(() => {
    if (replayStatus !== "playing") return;
    let cancelled = false;
    const epoch = ++playbackEpochRef.current;
    const playbackIntent = capturePlaybackIntent();
    const isCurrentPlayback = () => !cancelled
      && playbackEpochRef.current === epoch
      && latestReplayRef.current?.status === "playing";
    let frame = 0;
    playbackClockRef.current = performance.now();
    const tick = async (now: number) => {
      try {
        const current = latestReplayRef.current;
        if (!isCurrentPlayback() || !current || !dataset.sourceIntervalSeconds) return;
        const maximum = REPLAY_SYNC_BATCH_SIZE;
        const elapsedMs = now - playbackClockRef.current;
        const advance = calculatePlaybackAdvance(playbackAccumulatorRef.current, elapsedMs,
          current.playbackRate, dataset.sourceIntervalSeconds, maximum);
        playbackClockRef.current = now;
        playbackAccumulatorRef.current = advance.accumulator;
        if (advance.count > 0) {
          let nextSource = marketCache.readMemoryBarsAfter(current.currentSequence, 1)[0];
          if (!nextSource) {
            const anchor = tradingDayForTimestamp(
              currentSourceBarRef.current?.timestamp ?? dataset.startTime,
              marketSession,
            );
            beginBuffering();
            nextSource = (await readReplayData(() => (
              marketCache.getBarsAfter(current.currentSequence, 1, anchor)
            )))[0];
            endBuffering();
            playbackClockRef.current = performance.now();
          }
          if (!isCurrentPlayback()) return;
          const nextBucket = nextSource ? getAggregationBucket(
            new Date(nextSource.timestamp).getTime(),
            dataset.sourceIntervalSeconds,
            current.displayIntervalSeconds,
            displayMarketSession,
          ) : undefined;
          if (nextSource && !nextBucket) {
            await fastForwardToNextVisibleBar(isCurrentPlayback, playbackIntent);
            playbackAccumulatorRef.current = 0;
            playbackClockRef.current = performance.now();
          } else {
            const processed = await processServerBars(advance.count, isCurrentPlayback, playbackIntent);
            playbackAccumulatorRef.current += Math.max(0, advance.count - processed);
          }
        }
      } catch (error) {
        endBuffering();
        setPaperError(error instanceof Error ? error.message : copy.marketReplay.loadError);
        autoPausePlayback("source-failed", playbackIntent);
      } finally {
        if (isCurrentPlayback()) frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (playbackEpochRef.current === epoch) playbackEpochRef.current += 1;
      cancelAnimationFrame(frame);
    };
  }, [autoPausePlayback, beginBuffering, capturePlaybackIntent, dataset.sourceIntervalSeconds, dataset.startTime, displayMarketSession, endBuffering, fastForwardToNextVisibleBar, latestReplayRef, marketCache, marketSession, processServerBars, readReplayData, replayStatus, currentSourceBarRef, playbackAccumulatorRef, playbackClockRef, playbackEpochRef, setPaperError]);

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.visibilityState !== "hidden") return;
      playbackEpochRef.current += 1;
      manualStepsRef.current.cancel();
      autoPausePlayback("page-hidden");
      void advanceCompletionRef.current.then(() => flushVisible());
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, [autoPausePlayback, flushVisible, latestReplayRef, advanceCompletionRef, manualStepsRef, playbackEpochRef]);

  useEffect(() => {
    const manualSteps = manualStepsRef.current;
    const persistLatest = () => {
      const current = latestReplayRef.current;
      if (!current) return;
      void fetch(`/api/market-datasets/${dataset.id}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startSequence: current.startSequence, currentSequence: current.currentSequence, playbackRate: current.playbackRate, displayIntervalSeconds: current.displayIntervalSeconds, displaySession: current.displaySession }),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", persistLatest);
    return () => {
      window.removeEventListener("pagehide", persistLatest);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      manualSteps.cancel();
      windowRequestRef.current += 1;
      persistLatest();
    };
  }, [dataset.id, latestReplayRef, fetch, manualStepsRef, saveTimerRef, windowRequestRef]);

  async function startReplayAt(value: string) {
    if (!dataset.sourceIntervalSeconds) return setStartError(copy.marketReplay.invalidDisplayInterval);
    const timestamp = selectedTimeToTimestamp(value, dataset.timezone);
    if (!Number.isFinite(timestamp)) {
      setStartError(copy.marketReplay.invalidStart);
      return false;
    }
    const response = await fetch(`/api/market-datasets/${dataset.id}/replay/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp: new Date(timestamp).toISOString(), playbackRate: 1, displayIntervalSeconds: dataset.sourceIntervalSeconds, displaySession: "ETH" }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      setStartError(data?.error ?? copy.marketReplay.startError);
      return false;
    }
    if (data.replaySessionId && data.replaySessionId !== replaySession?.id) {
      pausePlayback();
      router.push(`/market-replay/${dataset.id}?sessionId=${encodeURIComponent(data.replaySessionId)}`);
      return true;
    }
    const next = createReplayState(dataset.barCount, data.startSequence, data.playbackRate, data.displayIntervalSeconds, data.currentSequence, data.generation, data.syncVersion, data.displaySession ?? "ETH");
    next.confirmedSequence = data.currentSequence;
    recoveryRequiredRef.current = false;
    setStartValue(value);
    const startSuspension = startDialogSuspensionRef.current;
    startDialogSuspensionRef.current = null;
    if (latestReplayRef.current) pausePlayback();
    restorePlayback(startSuspension);
    setStartError(null); setReplay(next);
    commitConfirmedPaperSnapshot(null);
    await loadWindow(next.currentSequence, next.displayIntervalSeconds, next.displaySession, indicatorWarmupCountRef.current);
    return true;
  }

  async function beginReplay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = startPickerRef.current?.validate();
    if (!selected) return;
    try {
      await startReplayAt(selected);
    } catch (error) {
      setStartError(error instanceof Error && error.message ? error.message : copy.marketReplay.loadError);
    }
  }

  const returnToLiveWindow = useCallback(async () => {
    const current = latestReplayRef.current;
    if (!current || viewChangingRef.current) return false;
    viewChangingRef.current = true;
    setReviewReturning(true);
    try {
      await loadWindow(current.currentSequence, current.displayIntervalSeconds, current.displaySession, indicatorWarmupCountRef.current);
      const latest = latestReplayRef.current;
      if (!latest || latest.generation !== current.generation || latest.currentSequence !== current.currentSequence) return false;
      setJournalReview(null);
      setChartFocusSequence(null);
      return true;
    } catch (error) {
      setPaperError(error instanceof Error ? error.message : copy.marketReplay.loadError);
      return false;
    } finally {
      viewChangingRef.current = false;
      setReviewReturning(false);
    }
  }, [latestReplayRef, loadWindow, indicatorWarmupCountRef, setChartFocusSequence, setJournalReview, setPaperError, setReviewReturning, viewChangingRef]);

  const togglePlayback = useCallback(async () => {
    if (confirmedPaperSnapshotRef.current?.propAccount?.state.result) return;
    if (requestRetryingRef.current) {
      if (wantsPlayback()) pausePlayback(); else playPlayback();
      return;
    }
    if (checkingOrder || preparingEntryCheckRef.current || correctionPending || dateForwarding || dateDialogOpen || dateDialogOpening || viewChangingRef.current) return;
    if ((journalReview || chartWindowDetachedRef.current) && !await returnToLiveWindow()) return;
    const current = latestReplayRef.current;
    if (!current || current.status === "finished") return;
    manualStepsRef.current.cancel();
    playbackEpochRef.current += 1;
    if (current.status === "playing") {
      pausePlayback();
      const next = latestReplayRef.current ?? current;
      void advanceCompletionRef.current.then(async () => {
        await flushVisible();
        queueSave(latestReplayRef.current ?? next, true);
      });
      return;
    }

    if (recoveryRequiredRef.current) return;
    playPlayback(); playbackClockRef.current = performance.now();
  }, [checkingOrder, flushVisible, journalReview, latestReplayRef, pausePlayback, playPlayback, queueSave,
    returnToLiveWindow, wantsPlayback, correctionPending, dateDialogOpen, dateDialogOpening, dateForwarding, advanceCompletionRef, chartWindowDetachedRef, manualStepsRef, playbackClockRef, playbackEpochRef, preparingEntryCheckRef, recoveryRequiredRef, requestRetryingRef, viewChangingRef, confirmedPaperSnapshotRef]);

  const revealNextBar = useCallback(async (canStart: () => boolean = () => true) => {
    if (confirmedPaperSnapshotRef.current?.propAccount?.state.result) return;
    if (!canStart() || checkingOrder || preparingEntryCheckRef.current || requestRetryingRef.current || correctionPending || dateForwarding || dateDialogOpen || dateDialogOpening || viewChangingRef.current) return;
    if ((journalReview || chartWindowDetachedRef.current) && !await returnToLiveWindow()) return;
    const current = latestReplayRef.current;
    if (!current || current.status === "playing" || current.status === "finished") return;
    void manualStepsRef.current.enqueue(async (isCancelled) => {
      await advanceCompletionRef.current;
      await paperMutationChainRef.current;
      if (isCancelled()) return;
      const latest = latestReplayRef.current;
      if (!latest || latest.status !== "paused" || viewChangingRef.current) return;
      if (!(await flushVisible())) return;
      if (isCancelled()) return;
      const snapshot = confirmedPaperSnapshotRef.current;
      if (paperSessionLoadedRef.current && (!snapshot || canAdvanceFlatAccount(snapshot.session, snapshot.activeOrders.length, snapshot.openLots?.length ?? 0))) {
        if (await fastForwardToNextVisibleBar(() => !isCancelled(), undefined, true)) return;
        if (isCancelled() || recoveryRequiredRef.current || historyConflictRef.current) return;
      }
      const anchor = tradingDayForTimestamp(
        currentSourceBarRef.current?.timestamp ?? dataset.startTime,
        marketSession,
      );
      const first = (await marketCache.getBarsAfter(latest.currentSequence, 1, anchor))[0];
      if (isCancelled()) return;
      if (!first || !dataset.sourceIntervalSeconds) return;
      const targetBucket = getAggregationBucket(
        new Date(first.timestamp).getTime(),
        dataset.sourceIntervalSeconds,
        latest.displayIntervalSeconds,
        displayMarketSession,
      );
      if (!targetBucket) {
        await fastForwardToNextVisibleBar(() => !isCancelled());
        return;
      }
      while (true) {
        const current = latestReplayRef.current;
        if (!current || current.currentSequence >= current.barCount - 1) break;
        const currentAnchor = tradingDayForTimestamp(
          currentSourceBarRef.current?.timestamp ?? first.timestamp,
          marketSession,
        );
        const candidates = await marketCache.getBarsAfter(current.currentSequence,
          manualAdvanceBatchSize(dataset.sourceIntervalSeconds, current.displayIntervalSeconds), currentAnchor);
        if (isCancelled()) break;
        const inBucket = candidates.filter((bar) => {
          const bucket = getAggregationBucket(
            new Date(bar.timestamp).getTime(),
            dataset.sourceIntervalSeconds!,
            current.displayIntervalSeconds,
            displayMarketSession,
          );
          return bucket?.start === targetBucket.start;
        });
        if (!inBucket.length) break;
        const processed = await processServerBars(inBucket.length, () => !isCancelled(), undefined, true);
        if (!processed || !(await flushVisible())) break;
        if (processed < inBucket.length || inBucket.length < candidates.length) break;
      }
    }, canStart);
  }, [checkingOrder, dataset.sourceIntervalSeconds, dataset.startTime, displayMarketSession, fastForwardToNextVisibleBar, flushVisible, journalReview, latestReplayRef, marketCache, marketSession, paperMutationChainRef, processServerBars, returnToLiveWindow, correctionPending, dateDialogOpen, dateDialogOpening, dateForwarding, confirmedPaperSnapshotRef, paperSessionLoadedRef, advanceCompletionRef, chartWindowDetachedRef, currentSourceBarRef, historyConflictRef, manualStepsRef, preparingEntryCheckRef, recoveryRequiredRef, requestRetryingRef, viewChangingRef]);

  const enterJournalReview = useCallback(async (focus: JournalFocus) => {
    const current = latestReplayRef.current;
    if (!current) return;
    if (focus.sequence > current.currentSequence) {
      setJournalReview(null);
      setChartFocusSequence(null);
      setRecoveryNotice(copy.paperTrading.journalFocusUnavailable);
      return;
    }
    setRecoveryNotice(null);
    manualStepsRef.current.cancel();
    pausePlayback();
    await advanceCompletionRef.current;
    if (!(await flushVisible())) return;
    setJournalReview(focus);
    await loadWindow(
      current.currentSequence,
      current.displayIntervalSeconds,
      current.displaySession,
      indicatorWarmupCountRef.current,
      null,
      focus.sequence,
      true,
      focus.globalNo || null,
    );
    setChartFocusSequence(focus.sequence);
  }, [flushVisible, latestReplayRef, loadWindow, pausePlayback, advanceCompletionRef, indicatorWarmupCountRef, manualStepsRef, setChartFocusSequence, setJournalReview, setRecoveryNotice]);

  useEffect(() => {
    if (!initialJournalFocus || !replay || initialJournalFocusAppliedRef.current) return;
    initialJournalFocusAppliedRef.current = true;
    void enterJournalReview(initialJournalFocus);
  }, [enterJournalReview, initialJournalFocus, replay, initialJournalFocusAppliedRef]);

  useEffect(() => {
    const stepShortcut = stepShortcutRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isReplayPlaybackShortcut(event, "ArrowRight", shortcuts.platform)) return;
      if (settingsDialog || gateDialogOpen || checkingOrder || startDialogOpen || confirmAction || isReplayShortcutInputTarget(event.target)) {
        stepShortcut.release();
        return;
      }
      const canStart = stepShortcut.keyDown(event, shortcuts.platform);
      if (!canStart) return;
      event.preventDefault();
      void revealNextBar(canStart);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      stepShortcut.keyUp(event, shortcuts.platform);
    };
    const onBlur = () => stepShortcut.release();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      stepShortcut.release();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [confirmAction, gateDialogOpen, checkingOrder, revealNextBar, settingsDialog, shortcuts.platform, startDialogOpen, stepShortcutRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isReplayPlaybackShortcut(event, "ArrowDown", shortcuts.platform)) return;
      if (
        settingsDialog || gateDialogOpen || checkingOrder || startDialogOpen || confirmAction
        || isReplayShortcutInputTarget(event.target)
      ) return;
      event.preventDefault();
      togglePlayback();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmAction, gateDialogOpen, checkingOrder, settingsDialog, shortcuts.platform, startDialogOpen, togglePlayback]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = replayDrawingShortcutKey(event);
      if (!key || hasVisibleReplayDialog()) return;
      if (
        settingsDialog || gateDialogOpen || checkingOrder || startDialogOpen || confirmAction || styleDrawingId
        || isReplayShortcutInputTarget(event.target)
      ) return;
      event.preventDefault();
      if (event.repeat || rectangleStyleId || textDrawing.editor) return;
      armDrawing(key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armDrawing, rectangleStyleId, textDrawing.editor, confirmAction, gateDialogOpen, checkingOrder, settingsDialog, startDialogOpen, styleDrawingId]);

  return {
    reloadPaper, queueSave, flushVisible, processServerBars, replayStatus, startReplayAt,
    beginReplay, returnToLiveWindow, togglePlayback, revealNextBar, enterJournalReview,
  };
}
