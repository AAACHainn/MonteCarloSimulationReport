"use client";
import { useArrowPreferences } from "./use-arrow-preferences";
import { useAbcdPreferences } from "./use-abcd-preferences";

import { type AnnotationCoverage } from "@/lib/market-replay/advance-display";
import { dateTimeLocalValue } from "@/lib/market-replay/start-time";
import { useReplayFetch, useReplaySession } from "./replay-session-context";
import { useAiPageScope } from "@/components/ai/page-context";
import { useRouter } from "next/navigation";
import { type CorrectionTarget } from "./replay-correction-dialog";
import { defaultTrainingGate, type TrainingGateState } from "@/lib/paper-trading/training-gate";
import type { PaperOrderInput, OrderSubmitResult } from "@/lib/paper-trading/types";
import { type EntryCheckDraft } from "@/lib/paper-trading/entry-check-draft";
import type { ReplayViewportApi } from "@/lib/market-replay/chart-range";
import type { ReplayChartDisplay } from "./replay-client-shared";
import { useCallback, useEffect, useMemo, useRef, useState, useId } from "react";
import type { CandlestickStyle } from "@/lib/market-replay/candlestick-style";
import { useReplayShortcuts } from "@/components/market-replay/use-replay-shortcuts";
import { createReplayStepShortcut, hasVisibleReplayDialog } from "@/lib/market-replay/keyboard-shortcuts";
import { type DateTimePickerHandle } from "@/components/ui/date-time-picker";
import { useTextDrawingEditor } from "./use-text-drawing-editor";
import { useDrawingScopeGuard } from "./use-drawing-scope-guard";
import { replayDisplayMetadataKey } from "@/lib/market-replay/dataset-refresh";
import { datasetSession } from "@/lib/market-replay/dataset";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { type AggregatedMarketBarData, type MarketBarData, type MarketDatasetSummary, type ReplayState } from "@/lib/market-replay/types";
import type { PaperSessionSnapshot, ReplayTradeAnnotationData } from "@/lib/paper-trading/types";
import { useReplayState } from "@/lib/market-replay/use-replay-state";
import { useReplayPlayback } from "@/lib/market-replay/use-replay-playback";
import { type ReplaySuspension } from "@/lib/market-replay/playback-lifecycle";
import { useReplayWindowCaches } from "@/lib/market-replay/use-replay-window-cache";
import { useReplayAccountRuntime } from "@/lib/market-replay/use-replay-account-runtime";
import { createReplayStepQueue } from "@/lib/market-replay/step-queue";
import { type DrawingTool, type FibonacciRetracementStyle, type MarketDrawing, type TrendLineStyle } from "@/lib/market-replay/chart-drawings";
import { useReplayPreferences } from "@/components/market-replay/use-replay-preferences";
import { type ReplaySaveStatus } from "@/lib/market-replay/playback-status";
import { WindowPayload, JournalFocus } from "./replay-client-shared";

export function useReplayCore({ dataset: initialDataset, initialJournalFocus = null }: { dataset: MarketDatasetSummary; initialJournalFocus?: JournalFocus | null }) {
  const fetch = useReplayFetch();
  const replaySession = useReplaySession();
  const registerAiScope = useAiPageScope()?.register, aiChartOwner = useId();
  useEffect(() => () => registerAiScope?.("chart", aiChartOwner, null), [registerAiScope, aiChartOwner]);
  const router = useRouter();
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [dateDialogOpening, setDateDialogOpening] = useState(false);
  const [dateDialogMinimum, setDateDialogMinimum] = useState(initialDataset.startTime);
  const [dateForwarding, setDateForwarding] = useState(false);
  const [forwardProgress, setForwardProgress] = useState<{ current: number; target: number } | null>(null);
  const cancelForwardRef = useRef(false);
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);
  const [correctionPending, setCorrectionPending] = useState(Boolean(replaySession?.pendingCorrectionId));
  useEffect(() => { setCorrectionPending(Boolean(replaySession?.pendingCorrectionId)); }, [replaySession?.pendingCorrectionId]);
  const [dataset, setLiveDataset] = useState(initialDataset);
  const displayedMetadataRef = useRef(replayDisplayMetadataKey(initialDataset));
  const initializedDatasetRef = useRef<string | null>(null);
  const historyConflictRef = useRef(false);
  const requestRetryingRef = useRef(false);
  const [retrying, setRetrying] = useState(false);
  const serverLifetimeRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const lifetime = new AbortController(); serverLifetimeRef.current = lifetime;
    return () => lifetime.abort();
  }, []);
  const shortcuts = useReplayShortcuts();
  const [webFullscreen, setWebFullscreen] = useState(false);
  const [bars, setBars] = useState<AggregatedMarketBarData[]>([]);
  const [chartDataRevision, setChartDataRevision] = useState(replayDisplayMetadataKey(initialDataset));
  const [chartDisplay, setChartDisplay] = useState<ReplayChartDisplay | null>(null);
  const chartViewportRef = useRef<ReplayViewportApi | null>(null);
  const [warmupBars, setWarmupBars] = useState<AggregatedMarketBarData[]>([]);
  const [currentSourceBar, setCurrentSourceBar] = useState<MarketBarData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replay, setReplay, latestReplayRef] = useReplayState();
  const {
    pauseReason,
    autoPauseEvent,
    play: playPlayback,
    pause: pausePlayback,
    autoPause: autoPausePlayback,
    suspend: suspendPlayback,
    restore: restorePlayback,
    finish: finishPlayback,
    dismissAutoPause,
    captureIntent: capturePlaybackIntent,
    wantsToPlay: wantsPlayback,
  } = useReplayPlayback(latestReplayRef, setReplay);
  const startPickerRef = useRef<DateTimePickerHandle>(null);
  const [startValue, setStartValue] = useState(() => dateTimeLocalValue(dataset.startTime, dataset.timezone));
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [startDialogValue, setStartDialogValue] = useState(startValue);
  const [startDialogBusy, setStartDialogBusy] = useState(false);
  const startDialogSuspensionRef = useRef<ReplaySuspension | null>(null);
  const confirmationSuspensionRef = useRef<ReplaySuspension | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<ReplaySaveStatus>("idle");
  const [confirmAction, setConfirmAction] = useState<"reset" | "paper-clear" | null>(null);
  const [settingsDialog, setSettingsDialog] = useState<"candlesticks" | "indicators" | "paper" | null>(null);
  const [candlestickStyleDraft, setCandlestickStyleDraft] = useState<CandlestickStyle | null>(null);
  const [emaError, setEmaError] = useState<string | null>(null);
  const [abrError, setAbrError] = useState<string | null>(null);
  const [barCountError, setBarCountError] = useState<string | null>(null);
  const [repairInterval, setRepairInterval] = useState("");
  const [paperSnapshot, setPaperSnapshot] = useState<PaperSessionSnapshot | null>(null);
  const {
    paperSnapshotRef,
    confirmedPaperSnapshotRef,
    paperSessionLoadedRef,
    paperSessionLoadRef,
    paperMutationActiveRef,
    paperMutationChainRef,
    pendingPaperMutationsRef,
    commitConfirmedPaperSnapshot, growthNotice, growthNoticeKey,
  } = useReplayAccountRuntime(paperSnapshot, setPaperSnapshot);
  const [tradeAnnotations, setTradeAnnotations] = useState<ReplayTradeAnnotationData[]>([]);
  const [tradeAnnotationsTruncated, setTradeAnnotationsTruncated] = useState(false);
  const [paperBusy, setPaperBusy] = useState(false);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [journalReview, setJournalReview] = useState<JournalFocus | null>(null);
  const [chartFocusSequence, setChartFocusSequence] = useState<number | null>(null);
  const chartWindowDetachedRef = useRef(false);
  const [reviewReturning, setReviewReturning] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [draftActive, setDraftActive] = useState(false);
  const [gateSettings, setGateSettings] = useState<TrainingGateState>(defaultTrainingGate);
  const [gateDialogOpen, setGateDialogOpen] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  const [checkingOrder, setCheckingOrder] = useState<{ order: PaperOrderInput; draftId: string } | null>(null);
  const [entryCheckDraft, setEntryCheckDraft] = useState<EntryCheckDraft | null>(null);
  const chartDraftIdRef = useRef<string | null>(null);
  const preparingEntryCheckRef = useRef(false);
  const checkResolverRef = useRef<((result: OrderSubmitResult) => void) | null>(null);
  const gateSeenRef = useRef<number | null>(null);
  useEffect(() => () => { checkResolverRef.current?.("CANCELLED"); }, []);
  useEffect(() => {
    if (replaySession?.mode !== "TRAINING") return;
    const controller = new AbortController();
    void fetch(`/api/replay-sessions/${replaySession.id}/training-gate`, { signal: controller.signal }).then(async (response) => {
      if (response.ok) { const data = await response.json(); if (!controller.signal.aborted) setGateSettings(data.gate); }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [fetch, replaySession?.id, replaySession?.mode]);

  const [measurementArmed, setMeasurementArmed] = useState(false);
  const [drawingToolOpen, setDrawingToolOpen] = useState(false);
  const [drawingTool, setDrawingTool] = useState<DrawingTool | null>(null);
  const [drawings, setDrawings] = useState<MarketDrawing[]>([]);
  const [clearingDrawings, setClearingDrawings] = useState(false);
  const clearingDrawingsRef = useRef(false);
  const [drawingError, setDrawingError] = useState<string | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [drawingObjectsOpen, setDrawingObjectsOpen] = useState(false);
  const [rectangleStyleId, setRectangleStyleId] = useState<string | null>(null);
  const [arrowStyleId, setArrowStyleId] = useState<string | null>(null);
  const { arrowPreferences, setArrowPreferences } = useArrowPreferences();
  const { abcdPreferences, setAbcdPreferences } = useAbcdPreferences();
  const [styleDrawingId, setStyleDrawingId] = useState<string | null>(null);
  const [styleDraft, setStyleDraft] = useState<TrendLineStyle | FibonacciRetracementStyle | null>(null);
  const [pendingDrawingIds, setPendingDrawingIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!webFullscreen) return;
    // Lock the root independently of dialogs, which lock body scrolling.
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = previousOverflow; };
  }, [webFullscreen]);

  useEffect(() => {
    if (!webFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" || event.defaultPrevented || event.isComposing
        || drawingTool || selectedDrawingId || measurementArmed || draftActive
        || hasVisibleReplayDialog()
        || document.querySelector("[role='menu'], [role='listbox'], [data-context-menu], [data-radix-popper-content-wrapper]")
      ) return;
      event.preventDefault();
      setWebFullscreen(false);
    };
    // Check overlays before their Escape handlers remove them from the DOM.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [draftActive, drawingTool, measurementArmed, selectedDrawingId, webFullscreen]);

  const {
    candlestickStyle,
    setCandlestickStyle,
    emaEnabled,
    setEmaEnabled,
    emaIndicators,
    setEmaIndicators,
    emaSettingsLoaded,
    abrEnabled,
    setAbrEnabled,
    abrLength,
    setAbrLength,
    abrSettingsLoaded,
    gridVisible,
    setGridVisible,
    volumeVisible,
    setVolumeVisible,
    candleCountdownEnabled,
    setCandleCountdownEnabled,
    barCountConfig,
    setBarCountConfig,
    chartVisibility,
    setChartVisibility,
    defaultRectangleStyle, setDefaultRectangleStyle, rectangleTemplates, setRectangleTemplates,
    defaultTextStyle, setDefaultTextStyle, textTemplates, setTextTemplates,
    defaultTrendLineStyle,
    setDefaultTrendLineStyle,
    trendLineTemplates,
    setTrendLineTemplates,
    defaultFibonacciStyle,
    setDefaultFibonacciStyle,
    fibonacciTemplates,
    setFibonacciTemplates,
    displayUtcOffsetMinutes,
    setDisplayUtcOffsetMinutes,
  } = useReplayPreferences(dataset);
  const textDrawing = useTextDrawingEditor(
    dataset.id + ":" + replaySession?.id + ":" + replaySession?.activeProjectionId,
    chartVisibility.drawings, drawings, defaultTextStyle);
  const { open: openTextDrawing } = textDrawing;
  const { beforeExit: finishText, discard: discardText, requestSettings: requestTextSettings } = textDrawing;
  const drawingWriteScope = dataset.id + ":" + replaySession?.id + ":" + replaySession?.activeProjectionId;
  const drawingScopeGuard = useDrawingScopeGuard(drawingWriteScope);
  const drawingsLive = useRef(drawings); drawingsLive.current = drawings;
  const visibleBarCountConfig = useMemo(() => (
    chartVisibility.indicators ? barCountConfig : { ...barCountConfig, enabled: false }
  ), [barCountConfig, chartVisibility.indicators]);
  const emaWarmupCount = emaEnabled
    ? Math.max(0, ...emaIndicators.filter((indicator) => indicator.visible).map((indicator) => indicator.length))
    : 0;
  const indicatorWarmupCount = Math.max(emaWarmupCount, abrLength);
  const indicatorWarmupCountRef = useRef(indicatorWarmupCount);
  indicatorWarmupCountRef.current = indicatorWarmupCount;
  const previousIndicatorWarmupCountRef = useRef<number | null>(null);
  const skipNextIndicatorReloadRef = useRef(false);
  const manualStepsRef = useRef(createReplayStepQueue());
  const stepShortcutRef = useRef(createReplayStepShortcut());
  const marketSession = useMemo(() => datasetSession(dataset), [dataset]);
  const displayMarketSession = useMemo(() => (
    resolveDisplaySession(dataset, replay?.displaySession ?? "ETH") ?? marketSession
  ), [dataset, marketSession, replay?.displaySession]);
  const appliedChartSession = chartDisplay?.displaySession ?? replay?.displaySession ?? "ETH";
  const chartMarketSession = useMemo(() => resolveDisplaySession(dataset, appliedChartSession) ?? marketSession,
    [dataset, appliedChartSession, marketSession]);
  const { marketCache, getDisplayCache, windowCache } = useReplayWindowCaches<WindowPayload>(dataset);
  const barsRef = useRef<AggregatedMarketBarData[]>([]);
  const warmupBarsRef = useRef<AggregatedMarketBarData[]>([]);
  const playbackDisplayRef = useRef<{ bars: AggregatedMarketBarData[]; warmupBars: AggregatedMarketBarData[] } | null>(null);
  const currentSourceBarRef = useRef<MarketBarData | null>(null);
  const recoveryRequiredRef = useRef(false);
  const viewChangingRef = useRef(false);
  const windowRequestRef = useRef(0);
  const windowAbortRef = useRef<AbortController | null>(null);
  const windowPrefetchAbortRef = useRef<AbortController | null>(null);
  const annotationAbortRef = useRef<AbortController | null>(null);
  const annotationRequestRef = useRef(0);
  const annotationCoverageRef = useRef<AnnotationCoverage | null>(null);
  const annotationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyAbortRef = useRef<AbortController | null>(null);
  const historyLoadingRef = useRef(false);
  const historyHasEarlierRef = useRef(true);
  const historyLaterExhaustedThroughRef = useRef<number | null>(null);
  const historyLastBarsBeforeRef = useRef<number | null>(null);
  const historyEpochRef = useRef(0);
  const pendingSaveRef = useRef<ReplayState | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveAtRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const advancingRef = useRef(false);
  const advanceCompletionRef = useRef<Promise<void>>(Promise.resolve());
  const playbackAccumulatorRef = useRef(0);
  const playbackClockRef = useRef(0);
  const playbackEpochRef = useRef(0);
  const bufferingRef = useRef(false);
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialJournalFocusAppliedRef = useRef(false);

  const beginBuffering = useCallback(() => {
    if (bufferingRef.current || bufferingTimerRef.current) return;
    bufferingTimerRef.current = setTimeout(() => {
      bufferingTimerRef.current = null;
      if (bufferingRef.current) return;
      bufferingRef.current = true;
      setBuffering(true);
    }, 100);
  }, []);

  const endBuffering = useCallback(() => {
    if (bufferingTimerRef.current) {
      clearTimeout(bufferingTimerRef.current);
      bufferingTimerRef.current = null;
    }
    if (!bufferingRef.current) return;
    bufferingRef.current = false;
    setBuffering(false);
  }, []);

  useEffect(() => () => {
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    windowAbortRef.current?.abort();
    windowPrefetchAbortRef.current?.abort();
    annotationAbortRef.current?.abort();
    historyAbortRef.current?.abort();
    if (annotationTimerRef.current) clearTimeout(annotationTimerRef.current);
  }, []);

  useEffect(() => { barsRef.current = bars; }, [bars]);
  useEffect(() => { currentSourceBarRef.current = currentSourceBar; }, [currentSourceBar]);

  return {
    fetch, replaySession, registerAiScope, aiChartOwner, router, dateDialogOpen,
    setDateDialogOpen, dateDialogOpening, setDateDialogOpening, dateDialogMinimum, setDateDialogMinimum, dateForwarding,
    setDateForwarding, forwardProgress, setForwardProgress, cancelForwardRef, correctionTarget, setCorrectionTarget,
    correctionPending, setCorrectionPending, dataset, setLiveDataset, displayedMetadataRef, initializedDatasetRef,
    historyConflictRef, requestRetryingRef, retrying, setRetrying, serverLifetimeRef, shortcuts,
    webFullscreen, setWebFullscreen, bars, setBars, chartDataRevision, setChartDataRevision, chartDisplay, setChartDisplay, chartViewportRef,
    warmupBars, setWarmupBars, currentSourceBar, setCurrentSourceBar, isLoading, setIsLoading,
    loadError, setLoadError, replay, setReplay, latestReplayRef, pauseReason,
    autoPauseEvent, playPlayback, pausePlayback, autoPausePlayback, suspendPlayback, restorePlayback,
    finishPlayback, dismissAutoPause, capturePlaybackIntent, wantsPlayback, startPickerRef, startValue,
    setStartValue, startDialogOpen, setStartDialogOpen, startDialogValue, setStartDialogValue, startDialogBusy,
    setStartDialogBusy, startDialogSuspensionRef, confirmationSuspensionRef, startError, setStartError, saveStatus,
    setSaveStatus, confirmAction, setConfirmAction, settingsDialog, setSettingsDialog, candlestickStyleDraft,
    setCandlestickStyleDraft, emaError, setEmaError, abrError, setAbrError, barCountError,
    setBarCountError, repairInterval, setRepairInterval, paperSnapshot, paperSnapshotRef, confirmedPaperSnapshotRef,
    paperSessionLoadedRef, paperSessionLoadRef, paperMutationActiveRef, paperMutationChainRef, pendingPaperMutationsRef, commitConfirmedPaperSnapshot, growthNotice, growthNoticeKey,
    tradeAnnotations, setTradeAnnotations, tradeAnnotationsTruncated, setTradeAnnotationsTruncated, paperBusy, setPaperBusy,
    paperError, setPaperError, journalReview, setJournalReview, chartFocusSequence, setChartFocusSequence,
    chartWindowDetachedRef, reviewReturning, setReviewReturning, buffering, recoveryNotice, setRecoveryNotice,
    draftActive, setDraftActive, gateSettings, setGateSettings, gateDialogOpen, setGateDialogOpen,
    gateBusy, setGateBusy, gateError, setGateError, gateNotice, setGateNotice,
    checkingOrder, setCheckingOrder, entryCheckDraft, setEntryCheckDraft, chartDraftIdRef, preparingEntryCheckRef,
    checkResolverRef, gateSeenRef, measurementArmed, setMeasurementArmed, drawingToolOpen, setDrawingToolOpen,
    drawingTool, setDrawingTool, drawings, setDrawings, clearingDrawings, setClearingDrawings,
    clearingDrawingsRef, drawingError, setDrawingError, selectedDrawingId, setSelectedDrawingId, drawingObjectsOpen,
    setDrawingObjectsOpen, rectangleStyleId, setRectangleStyleId, arrowStyleId, setArrowStyleId, arrowPreferences, setArrowPreferences, abcdPreferences, setAbcdPreferences, styleDrawingId, setStyleDrawingId, styleDraft,
    setStyleDraft, pendingDrawingIds, setPendingDrawingIds, candlestickStyle, setCandlestickStyle, emaEnabled,
    setEmaEnabled, emaIndicators, setEmaIndicators, emaSettingsLoaded, abrEnabled, setAbrEnabled,
    abrLength, setAbrLength, abrSettingsLoaded, gridVisible, setGridVisible, volumeVisible,
    setVolumeVisible, candleCountdownEnabled, setCandleCountdownEnabled, barCountConfig, setBarCountConfig, chartVisibility,
    setChartVisibility, defaultRectangleStyle, setDefaultRectangleStyle, rectangleTemplates, setRectangleTemplates, setDefaultTextStyle,
    textTemplates, setTextTemplates, defaultTrendLineStyle, setDefaultTrendLineStyle, trendLineTemplates, setTrendLineTemplates,
    defaultFibonacciStyle, setDefaultFibonacciStyle, fibonacciTemplates, setFibonacciTemplates, displayUtcOffsetMinutes, setDisplayUtcOffsetMinutes,
    textDrawing, openTextDrawing, finishText, discardText, requestTextSettings, drawingWriteScope,
    drawingScopeGuard, drawingsLive, visibleBarCountConfig, emaWarmupCount, indicatorWarmupCount, indicatorWarmupCountRef,
    previousIndicatorWarmupCountRef, skipNextIndicatorReloadRef, manualStepsRef, stepShortcutRef, marketSession, displayMarketSession, chartMarketSession,
    marketCache, getDisplayCache, windowCache, barsRef, warmupBarsRef, playbackDisplayRef, currentSourceBarRef,
    recoveryRequiredRef, viewChangingRef, windowRequestRef, windowAbortRef, windowPrefetchAbortRef, annotationAbortRef,
    annotationRequestRef, annotationCoverageRef, annotationTimerRef, historyAbortRef, historyLoadingRef, historyHasEarlierRef,
    historyLaterExhaustedThroughRef, historyLastBarsBeforeRef, historyEpochRef, pendingSaveRef, saveTimerRef, lastSaveAtRef,
    saveChainRef, advancingRef, advanceCompletionRef, playbackAccumulatorRef, playbackClockRef, playbackEpochRef,
    initialJournalFocusAppliedRef, beginBuffering, endBuffering, initialJournalFocus,
  };
}
