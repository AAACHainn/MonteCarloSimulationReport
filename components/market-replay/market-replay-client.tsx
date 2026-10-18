"use client";

import { advancedDisplayBars, canReuseAnnotations, manualAdvanceBatchSize, mergeDisplayAdvanceWindow, type AnnotationCoverage } from "@/lib/market-replay/advance-display";
import { createUuid } from "@/lib/uuid";

import { dateTimeLocalValue, selectedTimeToTimestamp } from "@/lib/market-replay/start-time";
import { useReplayFetch, useReplaySession } from "./replay-session-context";
import { useAiPageScope } from "@/components/ai/page-context";
import { useRouter } from "next/navigation";
import { ReplayDateDialog } from "./replay-date-dialog";
import { ReplaySessionSwitch } from "./replay-session-switch";
import { ReplayCorrectionProvider } from "./replay-correction-context";
import { ReplayCorrectionDialog, type CorrectionTarget } from "./replay-correction-dialog";
import Link from "next/link";
import { TrainingGateConfigDialog, EntryCheckDialog } from "./training-gate-dialogs";
import { defaultTrainingGate, isClosingOrder, type TrainingGateState } from "@/lib/paper-trading/training-gate";
import type { GateApprovalInput, PaperOrderInput, OrderSubmitResult } from "@/lib/paper-trading/types";
import { retainEntryCheckDraft, type EntryCheckDraft } from "@/lib/paper-trading/entry-check-draft";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, useId, type ReactNode } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { BookOpen, ListTree, Loader2, Palette, RotateCcw, Ruler, Settings2, Trash2, TrendingUp, WalletCards, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { ReplayChart, type ReplayVisibleSequenceRange } from "@/components/market-replay/replay-chart";
import { ReplayAutoPauseNotice } from "@/components/market-replay/replay-auto-pause-notice";
import { IndicatorSettingsDialog } from "@/components/market-replay/indicator-settings-dialog";
import { DisplayIntervalControls } from "@/components/market-replay/display-interval-controls";
import { ReplayStartDialog } from "@/components/market-replay/replay-start-dialog";
import { ChartVisibilityMenu } from "@/components/market-replay/chart-visibility-menu";
import { DEFAULT_REPLAY_MAX_VISIBLE_BARS } from "@/lib/market-replay/chart-range";
import type { CandlestickStyle } from "@/lib/market-replay/candlestick-style";
import { PaperAccountStrip, PaperTradingPanel } from "@/components/market-replay/paper-trading-panel";
import { ReplayPlaybackBar } from "@/components/market-replay/replay-playback-bar";
import { useReplayShortcuts } from "@/components/market-replay/use-replay-shortcuts";
import { createReplayStepShortcut, isReplayPlaybackShortcut, isReplayShortcutInputTarget, replayDrawingShortcutKey } from "@/lib/market-replay/keyboard-shortcuts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { DateTimePicker, type DateTimePickerHandle } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import {
  createReplayState,
  calculatePlaybackAdvance,
  setDisplayInterval,
  setDisplaySession,
  setPlaybackRate,
} from "@/lib/market-replay/engine";
import { aggregateMarketBars, getAggregationBucket, mergeSourceBarInto } from "@/lib/market-replay/aggregation";
import { calculateLatestAbr } from "@/lib/market-replay/abr";
import { isValidBarCountInterval, isValidBarCountRecentTradingDays } from "@/lib/market-replay/bar-count";
import type { ReplayChartVisibility } from "@/lib/market-replay/chart-visibility";
import { tradingDayForTimestamp } from "@/lib/market-replay/chunks";
import { datasetSession } from "@/lib/market-replay/dataset";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import {
  UTC_OFFSET_OPTIONS,
  formatUtcOffset,
} from "@/lib/market-replay/display-timezone";
import {
  DEFAULT_EMA_LINE_STYLE,
  DEFAULT_EMA_LINE_WIDTH,
} from "@/lib/market-replay/ema-style";
import {
  ABR_LENGTH_MAX,
  ABR_LENGTH_MIN,
  BAR_COUNT_INTERVAL_MAX,
  BAR_COUNT_INTERVAL_MIN,
  BAR_COUNT_RECENT_TRADING_DAYS_MAX,
  BAR_COUNT_RECENT_TRADING_DAYS_MIN,
  EMA_LENGTH_MAX,
  EMA_LENGTH_MIN,
  MAX_EMA_INDICATORS,
  MAX_REPLAY_BULK_SOURCE_BARS,
  REPLAY_HISTORY_BAR_LIMIT,
  REPLAY_HISTORY_COMPACT_TO,
  REPLAY_HISTORY_PREFETCH_THRESHOLD,
  REPLAY_HISTORY_RAW_SOURCE_BUDGET,
  isValidDisplayInterval,
  type AggregatedMarketBarData,
  type DisplaySession,
  type MarketBarData,
  type MarketDatasetSummary,
  type ReplayState,
} from "@/lib/market-replay/types";
import {
  contiguousCachedHistoryBefore,
  mergeReplayHistory,
  nextHistoryEndSequence,
  replayHistoryPageSize,
} from "@/lib/market-replay/history";
import { readLaterHistoryWindow } from "@/lib/market-replay/historical-window";
import type {
  PaperSessionSnapshot,
  ReplayTradeAnnotationData,
} from "@/lib/paper-trading/types";
import { paperOrderUrl } from "@/lib/paper-trading/order-url";
import type { ReplayServerRequest, ReplayServerResult } from "@/lib/market-replay/server-sync-types";
import { requestReplayAdvance, retryReplayOperation, assertForwardReplayResult, ReplayRequestError } from "@/lib/market-replay/server-request";
import { appendContextRun, type ReplayContextRun } from "@/lib/replay-sessions/context-runs";

import { useReplayState } from "@/lib/market-replay/use-replay-state";
import { useReplayPlayback } from "@/lib/market-replay/use-replay-playback";
import {
  type ReplayPlaybackIntent,
  type ReplaySuspension,
} from "@/lib/market-replay/playback-lifecycle";
import { useReplayWindowCaches } from "@/lib/market-replay/use-replay-window-cache";
import { useReplayAccountRuntime } from "@/lib/market-replay/use-replay-account-runtime";
import { createReplayStepQueue } from "@/lib/market-replay/step-queue";
import { HistoryVersionConflict } from "@/lib/market-replay/history-version";
import {
  DRAWING_TYPE_FIB_RETRACEMENT,
  DRAWING_TYPE_TREND_LINE,
  drawingStyleMatchesType,
  hasDuplicateEnabledFibonacciLevels,
  type DrawingTool,
  type FibonacciRetracementStyle,
  type FibonacciRetracementTemplate,
  type MarketDrawing,
  type MarketDrawingStyle,
  type TrendLineGeometry,
  type TrendLineStyle,
  type TrendLineTemplate,
} from "@/lib/market-replay/chart-drawings";
import {
  EMA_COLORS,
  useReplayPreferences,
} from "@/components/market-replay/use-replay-preferences";

import { useDelayedActivity } from "@/lib/use-delayed-activity";
import { replayPlaybackStatusText, type ReplaySaveStatus } from "@/lib/market-replay/playback-status";

type WindowPayload = {
  visibleBars: AggregatedMarketBarData[];
  warmupBars: AggregatedMarketBarData[];
  lastSourceBar: MarketBarData | null;
  focusBarIndex?: number | null;
  nextEndSequence?: number | null;
  hasEarlierBars?: boolean;
};
type ServerAdvancePayload = ReplayServerResult & {
  reachedVisibleBucket?: boolean;
  aggregatedBars?: AggregatedMarketBarData[];
  lastSourceBar?: MarketBarData | null;
};
type TradeAnnotationsPayload = {
  items: ReplayTradeAnnotationData[];
  truncated: boolean;
};

const REPLAY_SYNC_BATCH_SIZE = 100;
let localDrawingSequence = 0;

function replayWindowRequest(
  dataset: Pick<MarketDatasetSummary, "id" | "dataVersion">,
  endSequence: number,
  displayIntervalSeconds: number,
  displaySession: DisplaySession,
  warmupCount: number,
  focusSequence: number | null = null,
) {
  const limitedWarmup = Math.min(EMA_LENGTH_MAX, warmupCount);
  const cacheKey = [
    dataset.id, dataset.dataVersion, endSequence, displayIntervalSeconds, displaySession,
    DEFAULT_REPLAY_MAX_VISIBLE_BARS, limitedWarmup, focusSequence ?? "live",
  ].join(":");
  const params = new URLSearchParams({
    displayIntervalSeconds: String(displayIntervalSeconds), displaySession, endSequence: String(endSequence),
    visibleCount: String(DEFAULT_REPLAY_MAX_VISIBLE_BARS), warmupCount: String(limitedWarmup),
  });
  if (focusSequence !== null) params.set("focusSequence", String(focusSequence));
  return { cacheKey, params };
}

function createLocalDrawingId(prefix: "temporary" | "template") {
  localDrawingSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${localDrawingSequence.toString(36)}`;
}

function cloneFibonacciStyle(style: FibonacciRetracementStyle): FibonacciRetracementStyle {
  return { ...style, levels: style.levels.map((level) => ({ ...level })) };
}

function isValidEmaLength(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= EMA_LENGTH_MIN && Number(value) <= EMA_LENGTH_MAX;
}

function formatDatasetTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

type JournalFocus = { sequence: number; no: number; globalNo: number };

export function MarketReplayClient({ dataset: initialDataset, initialJournalFocus = null }: { dataset: MarketDatasetSummary; initialJournalFocus?: JournalFocus | null }) {
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
    commitConfirmedPaperSnapshot,
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
  const [drawingError, setDrawingError] = useState<string | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [drawingObjectsOpen, setDrawingObjectsOpen] = useState(false);
  const [styleDrawingId, setStyleDrawingId] = useState<string | null>(null);
  const [styleDraft, setStyleDraft] = useState<MarketDrawingStyle | null>(null);
  const [styleDraftError, setStyleDraftError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
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
        || document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-context-menu], [data-radix-popper-content-wrapper]")
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
  const { marketCache, getDisplayCache, windowCache } = useReplayWindowCaches<WindowPayload>(dataset);
  const barsRef = useRef<AggregatedMarketBarData[]>([]);
  const warmupBarsRef = useRef<AggregatedMarketBarData[]>([]);
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

  const setDrawingPending = useCallback((id: string, pending: boolean) => {
    setPendingDrawingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

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
  }, [dataset.id, fetch]);

  const armDrawing = useCallback((tool: DrawingTool) => {
    setMeasurementArmed(false);
    setChartVisibility((current) => current.drawings ? current : { ...current, drawings: true });
    setDrawingTool(tool);
    setDrawingToolOpen(false);
    setSelectedDrawingId(null);
    setDrawingError(null);
  }, [setChartVisibility]);

  const changeChartVisibility = useCallback((next: ReplayChartVisibility) => {
    setChartVisibility(next);
    if (!next.drawings) {
      setDrawingTool(null);
      setDrawingToolOpen(false);
      setDrawingObjectsOpen(false);
      setSelectedDrawingId(null);
    }
  }, [setChartVisibility]);
  const armTrendLine = useCallback(() => armDrawing(DRAWING_TYPE_TREND_LINE), [armDrawing]);
  const armFibonacciRetracement = useCallback(() => armDrawing(DRAWING_TYPE_FIB_RETRACEMENT), [armDrawing]);

  const createDrawing = useCallback(async (type: DrawingTool, geometry: TrendLineGeometry) => {
    const temporaryId = createLocalDrawingId("temporary");
    const now = new Date().toISOString();
    const style = type === DRAWING_TYPE_TREND_LINE
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
  }, [dataset.id, defaultFibonacciStyle, defaultTrendLineStyle, setDrawingPending, fetch]);

  const updateDrawing = useCallback(async (
    id: string,
    patch: { geometry?: TrendLineGeometry; style?: MarketDrawingStyle },
  ) => {
    const previous = drawings.find((drawing) => drawing.id === id);
    if (!previous || id.startsWith("temporary-") || pendingDrawingIds.has(id)) return false;
    if (patch.style && !drawingStyleMatchesType(previous.type, patch.style)) return false;
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
      if (!response.ok || !data.drawing) throw new Error(data.error);
      setDrawings((current) => current.map((drawing) => drawing.id === id ? data.drawing! : drawing));
      setDrawingError(null);
      return true;
    } catch {
      setDrawings((current) => current.map((drawing) => drawing.id === id ? previous : drawing));
      setDrawingError(copy.marketReplay.drawingSaveError);
      return false;
    } finally {
      setDrawingPending(id, false);
    }
  }, [dataset.id, drawings, pendingDrawingIds, setDrawingPending, fetch]);

  const deleteDrawing = useCallback(async (id: string) => {
    const index = drawings.findIndex((drawing) => drawing.id === id);
    if (index < 0 || id.startsWith("temporary-") || pendingDrawingIds.has(id)) return;
    const previous = drawings[index];
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
  }, [dataset.id, drawings, pendingDrawingIds, setDrawingPending, styleDrawingId, fetch]);

  const openDrawingStyle = useCallback((id: string) => {
    const drawing = drawings.find((item) => item.id === id);
    if (!drawing) return;
    setSelectedDrawingId(id);
    setStyleDrawingId(id);
    setStyleDraft(drawing.type === DRAWING_TYPE_TREND_LINE
      ? { ...drawing.style }
      : cloneFibonacciStyle(drawing.style));
    setStyleDraftError(null);
    setSelectedTemplateId("");
  }, [drawings]);

  const saveDrawingTemplate = useCallback(() => {
    const name = templateName.trim();
    if (!name || !styleDraft) return;
    const drawing = drawings.find((item) => item.id === styleDrawingId);
    if (!drawing || !drawingStyleMatchesType(drawing.type, styleDraft)) return;
    const isTrendLine = drawing.type === DRAWING_TYPE_TREND_LINE;
    const templates = isTrendLine ? trendLineTemplates : fibonacciTemplates;
    const existing = templates.find((template) => template.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"));
    if (!existing && templates.length >= 50) {
      setDrawingError(copy.marketReplay.drawingTemplateLimit);
      return;
    }
    const id = existing?.id ?? createLocalDrawingId("template");
    if (isTrendLine) {
      const template: TrendLineTemplate = { id, name, style: { ...styleDraft } as TrendLineStyle };
      setTrendLineTemplates((current) => existing
        ? current.map((item) => item.id === existing.id ? template : item)
        : [...current, template]);
    } else {
      const template: FibonacciRetracementTemplate = { id, name, style: cloneFibonacciStyle(styleDraft as FibonacciRetracementStyle) };
      setFibonacciTemplates((current) => existing
        ? current.map((item) => item.id === existing.id ? template : item)
        : [...current, template]);
    }
    setSelectedTemplateId(id);
    setTemplateName("");
    setTemplateDialogOpen(false);
    setDrawingError(null);
  }, [drawings, fibonacciTemplates, setFibonacciTemplates, setTrendLineTemplates, styleDraft, styleDrawingId, templateName, trendLineTemplates]);

  const deleteSelectedDrawingTemplate = useCallback(() => {
    if (!selectedTemplateId) return;
    const drawing = drawings.find((item) => item.id === styleDrawingId);
    if (drawing?.type === DRAWING_TYPE_FIB_RETRACEMENT) {
      setFibonacciTemplates((current) => current.filter((template) => template.id !== selectedTemplateId));
    } else {
      setTrendLineTemplates((current) => current.filter((template) => template.id !== selectedTemplateId));
    }
    setSelectedTemplateId("");
  }, [drawings, selectedTemplateId, setFibonacciTemplates, setTrendLineTemplates, styleDrawingId]);

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
  }, [dataset.id, fetch, latestReplayRef, confirmedPaperSnapshotRef]);

  const loadWindow = useCallback(async (
    endSequence: number,
    displayIntervalSeconds: number,
    displaySession: DisplaySession,
    warmupCount: number,
    completedDisplayBucketStart: string | null = null,
    focusSequence: number | null = null,
    reviewOnly = false,
    focusJournalNo: number | null = null,
  ) => {
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
        if (controller.signal.aborted) return;
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
    if (requestId !== windowRequestRef.current) return;
    if (!reviewOnly) {
      const live = latestReplayRef.current;
      if (!live
        || live.generation !== expectedGeneration
        || live.currentSequence !== endSequence
        || live.displayIntervalSeconds !== displayIntervalSeconds
        || live.displaySession !== displaySession) return;
    }
    const closeCompletedBucket = (bar: AggregatedMarketBarData) => (
      bar.timestamp === completedDisplayBucketStart
        ? { ...bar, status: bar.sourceCount === bar.expectedCount ? "COMPLETE" as const : "INCOMPLETE" as const }
        : bar
    );
    const visible = data.visibleBars.map(closeCompletedBucket);
    barsRef.current = visible;
    warmupBarsRef.current = data.warmupBars;
    setBars(visible);
    setWarmupBars(data.warmupBars);
    void loadTradeAnnotations(visible, focusJournalNo);
    historyHasEarlierRef.current = data.hasEarlierBars ?? nextHistoryEndSequence(visible) !== null;
    if (!reviewOnly) {
      chartWindowDetachedRef.current = false;
      currentSourceBarRef.current = data.lastSourceBar;
      setCurrentSourceBar(data.lastSourceBar);
      void getDisplayCache(displayIntervalSeconds, displaySession).persist([...data.warmupBars, ...visible]);
    }
    if (dataset.sourceIntervalSeconds) {
      const anchor = tradingDayForTimestamp(data.lastSourceBar?.timestamp ?? dataset.startTime, marketSession);
      marketCache.prefetch(anchor);
    }
  }, [dataset, getDisplayCache, latestReplayRef, loadTradeAnnotations, marketCache, marketSession, windowCache, fetch]);

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
  }, [dataset, windowCache, fetch]);

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
              bars: sourceBars,
              sourceSeconds: dataset.sourceIntervalSeconds,
              displaySeconds: displayIntervalSeconds,
              session,
              currentSequence: cursor,
              finalSequence: dataset.barCount - 1,
            }).map((bar, index, all) => index === all.length - 1 && bar.status === "FORMING"
              ? { ...bar, status: bar.sourceCount === bar.expectedCount ? "COMPLETE" as const : "INCOMPLETE" as const }
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
  }, [dataset, getDisplayCache, latestReplayRef, marketCache, marketSession]);

  const loadEarlierHistory = useCallback(async () => {
    const current = latestReplayRef.current;
    if (!current || historyLoadingRef.current || !historyHasEarlierRef.current
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
  }, [beginBuffering, dataset.id, dataset.sourceIntervalSeconds, endBuffering, getDisplayCache, hydrateCachedHistory, latestReplayRef, fetch]);

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
  }, [beginBuffering, dataset.id, dataset.sourceIntervalSeconds, endBuffering, getDisplayCache, latestReplayRef, fetch]);

  const handleVisibleSequenceRange = useCallback((range: ReplayVisibleSequenceRange) => {
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
  }, [latestReplayRef, loadEarlierHistory, loadLaterHistory, loadTradeAnnotations, registerAiScope, aiChartOwner, replaySession]);

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
  }, [abrSettingsLoaded, commitConfirmedPaperSnapshot, dataset, emaSettingsLoaded, loadWindow, paperSessionLoadedRef, paperSessionLoadRef, primeWindow, setReplay, fetch, replaySession?.activeProjectionId]);

  useEffect(() => {
    if (!emaSettingsLoaded || !abrSettingsLoaded) return;
    const previous = previousIndicatorWarmupCountRef.current;
    previousIndicatorWarmupCountRef.current = indicatorWarmupCount;
    if (previous === null || previous === indicatorWarmupCount) return;
    if (skipNextIndicatorReloadRef.current) {
      skipNextIndicatorReloadRef.current = false;
      return;
    }
    const current = latestReplayRef.current;
    if (!current) return;
    const suspension = suspendPlayback();
    void loadWindow(
      current.currentSequence,
      current.displayIntervalSeconds,
      current.displaySession,
      indicatorWarmupCount,
    ).then(() => {
      restorePlayback(suspension);
    }).catch((error) => {
      setEmaError(error instanceof Error ? error.message : copy.marketReplay.loadError);
      restorePlayback(suspension);
    });
  }, [abrSettingsLoaded, emaSettingsLoaded, indicatorWarmupCount, latestReplayRef, loadWindow, restorePlayback, suspendPlayback]);

  const reloadPaper = useCallback(async () => {
    const response = await fetch(`/api/market-datasets/${dataset.id}/paper-session`);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error ?? copy.paperTrading.requestFailed);
    if (data.projectionId && data.projectionId !== replaySession?.activeProjectionId) { historyConflictRef.current = true; pausePlayback(); throw new Error(copy.replaySessions.projectionChanged); }
    commitConfirmedPaperSnapshot(data.snapshot as PaperSessionSnapshot | null);
    paperSessionLoadedRef.current = true;
    return data.snapshot as PaperSessionSnapshot | null;
  }, [commitConfirmedPaperSnapshot, dataset.id, paperSessionLoadedRef, fetch, pausePlayback, replaySession?.activeProjectionId]);

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
  }, [dataset.id, fetch]);

  const queueSave = useCallback((next: ReplayState, immediate: boolean) => {
    pendingSaveRef.current = next;
    if (immediate) {
      flushSave();
      return;
    }
    if (saveTimerRef.current) return;
    const delay = Math.max(0, 1_000 - (Date.now() - lastSaveAtRef.current));
    saveTimerRef.current = setTimeout(flushSave, delay);
  }, [flushSave]);

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
  }, [restorePlayback, suspendPlayback]);

  const executeServerAdvance = useCallback(async (
    url: string, body: { requestId: string; [key: string]: unknown }, accept: (data: ServerAdvancePayload) => void | Promise<void>,
  ) => {
    const signal = serverLifetimeRef.current?.signal;
    if (!signal || signal.aborted || historyConflictRef.current || recoveryRequiredRef.current) return false;
    let suspension: ReplaySuspension | null = null;
    setSaveStatus("saving");
    try {
      const data = await requestReplayAdvance<ServerAdvancePayload>({ fetch, url, body: JSON.stringify(body), signal,
        onRetry: () => {
          suspension ??= suspendPlayback();
          requestRetryingRef.current = true; setRetrying(true);
          setRecoveryNotice(copy.marketReplay.advanceRetrying);
        },
      });
      if (signal.aborted) return false;
      const current = latestReplayRef.current;
      if (!current) return false;
      assertForwardReplayResult(current, data);
      if (data.requestId !== body.requestId || data.fromSequence !== current.currentSequence
        || data.historyVersion !== (dataset.historyVersion ?? 1)
        || (data.snapshot && data.snapshot.session.lastProcessedSequence !== data.currentSequence)) {
        throw new ReplayRequestError(copy.marketReplay.advanceConflict, 409, "STATE_CONFLICT");
      }
      await accept(data);
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
  }, [autoPausePlayback, dataset.historyVersion, fetch, latestReplayRef, restorePlayback, suspendPlayback]);

  const flushVisible = useCallback(async () => {
    await advanceCompletionRef.current;
    return !historyConflictRef.current && !recoveryRequiredRef.current;
  }, []);

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
        if (next.dataVersion === dataset.dataVersion) return;
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
  }, [autoPausePlayback, dataset, flushVisible, isLoading, paperMutationActiveRef, restorePlayback, setReplay, suspendPlayback, fetch]);

  useEffect(() => {
    const gate = paperSnapshot?.session.trainingGate;
    if (!gate) return;
    const previous = gateSeenRef.current;
    gateSeenRef.current = gate.activationCount;
    if (previous !== null && gate.activationCount > previous && gate.source === "LOSS_STREAK") {
      pausePlayback(); manualStepsRef.current.cancel();
      setGateNotice(`${copy.trainingGate.automatic} ${copy.trainingGate.cancelled(gate.cancelledOrderCount)}`);
    }
  }, [paperSnapshot?.session.trainingGate, pausePlayback]);

  const fastForwardToNextVisibleBar = useCallback(async (
    shouldContinue: () => boolean = () => true,
    playbackIntent?: ReplayPlaybackIntent,
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
      for (let attempt = 0; attempt < 64 && next.currentSequence < next.barCount - 1; attempt += 1) {
        const abrValue = calculateLatestAbr(warmupBarsRef.current, barsRef.current, abrLength);
        const ok = await executeServerAdvance(`/api/market-datasets/${dataset.id}/replay/advance`, {
          requestId: createUuid(), expectedCurrentSequence: next.currentSequence,
          historyVersion: dataset.historyVersion ?? 1, expectedVersion: snapshot?.session.version ?? null,
          count: 1, displayIntervalSeconds: next.displayIntervalSeconds, displaySession: next.displaySession,
          abrValue: abrValue !== null && abrValue > 0 ? abrValue : null, abrLength, displayUtcOffsetMinutes,
        }, async (data) => {
          if (!Array.isArray(data.aggregatedBars) || data.aggregatedBars.some(bar => bar.lastSequence > data.currentSequence)) {
            throw new ReplayRequestError(copy.marketReplay.advanceConflict, 409);
          }
          next = { ...next, currentSequence: data.currentSequence, confirmedSequence: data.currentSequence,
            syncVersion: data.syncVersion, status: data.currentSequence >= next.barCount - 1 ? "finished" : (latestReplayRef.current?.status ?? next.status) };
          snapshot = data.snapshot; lastSourceBar = data.lastSourceBar ?? null;
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
        if (reachedVisibleBucket || !shouldContinue()) break;
      }
      return reachedVisibleBucket;
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
    getDisplayCache, loadTradeAnnotations, paperMutationActiveRef, paperMutationChainRef, setReplay]);

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
      const ok = await executeServerAdvance(`/api/market-datasets/${dataset.id}/replay/sync`, body, (data) => {
        if (data.currentSequence !== lastSourceBar.sequence) throw new ReplayRequestError(copy.marketReplay.advanceConflict, 409);
        barsRef.current = aggregates; warmupBarsRef.current = nextWarmup; currentSourceBarRef.current = lastSourceBar;
        setBars(aggregates); setWarmupBars(nextWarmup); setCurrentSourceBar(lastSourceBar);
        commitConfirmedPaperSnapshot(data.snapshot);
        setReplay(value => value ? { ...value, currentSequence: data.currentSequence, confirmedSequence: data.currentSequence,
          syncVersion: data.syncVersion, status: data.currentSequence >= value.barCount - 1 ? "finished" : value.status } : value);
        getDisplayCache(current!.displayIntervalSeconds, current!.displaySession).schedulePersist(advancedDisplayBars(aggregates, sourceCursor, previousDisplayTail));
        if (data.fills.length) void loadTradeAnnotations(aggregates.slice(-DEFAULT_REPLAY_MAX_VISIBLE_BARS));
      });
      return ok ? sourceBars.length : 0;
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
    dataset.dataVersion, dataset.historyVersion, dataset.id, dataset.priceTickSize, dataset.sourceIntervalSeconds, dataset.startTime,
    displayMarketSession, displayUtcOffsetMinutes, endBuffering, executeServerAdvance, getDisplayCache, latestReplayRef,
    loadTradeAnnotations, marketCache, marketSession, paperMutationActiveRef, paperSessionLoadedRef, paperSessionLoadRef, readReplayData, setReplay]);

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
  }, [autoPausePlayback, beginBuffering, capturePlaybackIntent, dataset.sourceIntervalSeconds, dataset.startTime, displayMarketSession, endBuffering, fastForwardToNextVisibleBar, latestReplayRef, marketCache, marketSession, processServerBars, readReplayData, replayStatus]);

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
  }, [autoPausePlayback, flushVisible, latestReplayRef]);

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
  }, [dataset.id, latestReplayRef, fetch]);

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
  }, [latestReplayRef, loadWindow]);

  const togglePlayback = useCallback(async () => {
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
    returnToLiveWindow, wantsPlayback, correctionPending, dateDialogOpen, dateDialogOpening, dateForwarding]);

  const revealNextBar = useCallback(async (canStart: () => boolean = () => true) => {
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
  }, [checkingOrder, dataset.sourceIntervalSeconds, dataset.startTime, displayMarketSession, fastForwardToNextVisibleBar, flushVisible, journalReview, latestReplayRef, marketCache, marketSession, paperMutationChainRef, processServerBars, returnToLiveWindow, correctionPending, dateDialogOpen, dateDialogOpening, dateForwarding]);

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
  }, [flushVisible, latestReplayRef, loadWindow, pausePlayback]);

  useEffect(() => {
    if (!initialJournalFocus || !replay || initialJournalFocusAppliedRef.current) return;
    initialJournalFocusAppliedRef.current = true;
    void enterJournalReview(initialJournalFocus);
  }, [enterJournalReview, initialJournalFocus, replay]);

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
  }, [confirmAction, gateDialogOpen, checkingOrder, revealNextBar, settingsDialog, shortcuts.platform, startDialogOpen]);

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
      if (!key) return;
      if (
        settingsDialog || gateDialogOpen || checkingOrder || startDialogOpen || confirmAction || styleDrawingId
        || isReplayShortcutInputTarget(event.target)
      ) return;
      event.preventDefault();
      if (key === "f") armFibonacciRetracement(); else armTrendLine();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armFibonacciRetracement, armTrendLine, confirmAction, gateDialogOpen, checkingOrder, settingsDialog, startDialogOpen, styleDrawingId]);

  function changeSpeed(value: number) {
    const current = latestReplayRef.current;
    if (!current) return;
    const next = setPlaybackRate(current, value);
    setReplay(next);
    queueSave(next, true);
  }

  async function changeDisplayInterval(value: number): Promise<boolean> {
    if (!latestReplayRef.current || !dataset.sourceIntervalSeconds || !isValidDisplayInterval(dataset.sourceIntervalSeconds, value)) {
      setEmaError(copy.marketReplay.invalidDisplayInterval); return false;
    }
    if (viewChangingRef.current) return false;
    viewChangingRef.current = true;
    const suspension = suspendPlayback();
    manualStepsRef.current.cancel();
    let previous: ReplayState | null = null;
    try {
      await advanceCompletionRef.current;
      if (!(await flushVisible())) return false;
      const current = latestReplayRef.current;
      if (!current) return false;
      previous = current;
      playbackAccumulatorRef.current = 0;
      playbackClockRef.current = performance.now();
      const next = setDisplayInterval(current, value);
      setReplay(next); setEmaError(null); queueSave(next, true);
      await loadWindow(next.currentSequence, value, next.displaySession, indicatorWarmupCountRef.current);
      return true;
    } catch (error) {
      if (previous) {
        setReplay(previous);
        queueSave(previous, true);
      }
      setPaperError(error instanceof Error ? error.message : copy.marketReplay.loadError);
      return false;
    } finally {
      viewChangingRef.current = false;
      restorePlayback(suspension);
    }
  }

  async function changeChartSession(value: DisplaySession) {
    if (!latestReplayRef.current || !dataset.availableDisplaySessions.includes(value) || viewChangingRef.current) return;
    viewChangingRef.current = true;
    const suspension = suspendPlayback();
    manualStepsRef.current.cancel();
    let previous: ReplayState | null = null;
    try {
      await advanceCompletionRef.current;
      if (!(await flushVisible())) return;
      const current = latestReplayRef.current;
      if (!current) return;
      previous = current;
      playbackAccumulatorRef.current = 0;
      playbackClockRef.current = performance.now();
      const next = setDisplaySession(current, value);
      setReplay(next);
      setEmaError(null);
      queueSave(next, true);
      await saveChainRef.current;
      await loadWindow(next.currentSequence, next.displayIntervalSeconds, value, indicatorWarmupCountRef.current);
    } catch (error) {
      if (previous) {
        setReplay(previous);
        queueSave(previous, true);
      }
      setPaperError(error instanceof Error ? error.message : copy.marketReplay.loadError);
    } finally {
      viewChangingRef.current = false;
      restorePlayback(suspension);
    }
  }

  function setEmaLength(id: string, value: number) {
    if (!isValidEmaLength(value)) {
      setEmaError(copy.marketReplay.emaLengthRange(EMA_LENGTH_MIN, EMA_LENGTH_MAX));
      return false;
    }
    setEmaIndicators((current) => current.map((indicator) => (
      indicator.id === id ? { ...indicator, length: value } : indicator
    )));
    setEmaError(null);
    return true;
  }

  function updateAbrLength(value: number) {
    if (!Number.isInteger(value) || value < ABR_LENGTH_MIN || value > ABR_LENGTH_MAX) {
      setAbrError(copy.marketReplay.abrLengthRange(ABR_LENGTH_MIN, ABR_LENGTH_MAX));
      return false;
    }
    if (value === abrLength) return true;
    setAbrError(null);
    manualStepsRef.current.cancel();
    const suspension = suspendPlayback();
    void (async () => {
      await advanceCompletionRef.current;
      if (!(await flushVisible())) return;
      skipNextIndicatorReloadRef.current = true;
      setAbrLength(value);
      const current = latestReplayRef.current;
      if (current) await loadWindow(current.currentSequence, current.displayIntervalSeconds, current.displaySession, Math.max(emaWarmupCount, value));
    })().catch((error) => {
      skipNextIndicatorReloadRef.current = true;
      setAbrLength(abrLength);
      setAbrError(error instanceof Error ? error.message : copy.marketReplay.loadError);
    }).finally(() => {
      restorePlayback(suspension);
    });
    return true;
  }

  function updateBarCountInterval(value: number) {
    if (!isValidBarCountInterval(value)) {
      setBarCountError(copy.marketReplay.barCountIntervalRange(BAR_COUNT_INTERVAL_MIN, BAR_COUNT_INTERVAL_MAX));
      return false;
    }
    setBarCountConfig((current) => ({ ...current, interval: value }));
    setBarCountError(null);
    return true;
  }

  function updateBarCountRecentTradingDays(value: number) {
    if (!isValidBarCountRecentTradingDays(value)) {
      setBarCountError(copy.marketReplay.barCountRecentTradingDaysRange(
        BAR_COUNT_RECENT_TRADING_DAYS_MIN,
        BAR_COUNT_RECENT_TRADING_DAYS_MAX,
      ));
      return false;
    }
    setBarCountConfig((current) => ({ ...current, recentTradingDays: value }));
    setBarCountError(null);
    return true;
  }

  function addEma() {
    if (emaIndicators.length >= MAX_EMA_INDICATORS) {
      setEmaError(copy.marketReplay.emaLimit(MAX_EMA_INDICATORS));
      return;
    }
    const preferredLengths = [20, 60, 200, 9, 12, 26, 50, 100];
    const length = preferredLengths.find((candidate) => !emaIndicators.some((item) => item.length === candidate)) ?? 20;
    setEmaIndicators((current) => [...current, {
      id: `ema-${Date.now()}`,
      length,
      color: EMA_COLORS[current.length % EMA_COLORS.length],
      lineWidth: DEFAULT_EMA_LINE_WIDTH,
      lineStyle: DEFAULT_EMA_LINE_STYLE,
      visible: true,
    }]);
    setEmaError(null);
  }

  function requestConfirmation(action: "reset" | "paper-clear") {
    const current = latestReplayRef.current;
    if (!current) return;
    confirmationSuspensionRef.current = suspendPlayback();
    setConfirmAction(action);
  }

  function openStartDialog() {
    const current = latestReplayRef.current;
    if (!current) return;
    startDialogSuspensionRef.current = suspendPlayback();
    setStartDialogValue(startValue);
    setStartError(null);
    setStartDialogOpen(true);
  }

  function closeStartDialog() {
    if (startDialogBusy) return;
    setStartDialogOpen(false);
    setStartError(null);
    const suspension = startDialogSuspensionRef.current;
    startDialogSuspensionRef.current = null;
    if (restorePlayback(suspension)) {
      playbackClockRef.current = performance.now();
    }
  }

  async function applyNewReplayStart(value: string) {
    if (!latestReplayRef.current || startDialogBusy) return;
    setStartDialogBusy(true);
    manualStepsRef.current.cancel();
    try {
      await advanceCompletionRef.current;
      if (!(await flushVisible())) return;
      windowRequestRef.current += 1;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pendingSaveRef.current = null;
      await saveChainRef.current.catch(() => undefined);
      if (await startReplayAt(value)) {
        setStartDialogOpen(false);
        setSaveStatus("idle");
      }
    } catch (error) {
      setStartError(error instanceof Error && error.message ? error.message : copy.marketReplay.loadError);
    } finally {
      setStartDialogBusy(false);
    }
  }

  async function applyConfirmedAction() {
    if (!latestReplayRef.current || !confirmAction) return;
    manualStepsRef.current.cancel();
    await advanceCompletionRef.current;
    if (!(await flushVisible())) {
      const suspension = confirmationSuspensionRef.current;
      confirmationSuspensionRef.current = null;
      restorePlayback(suspension);
      setConfirmAction(null);
      return;
    }
    windowRequestRef.current += 1;
    if (confirmAction === "paper-clear") {
      try {
        const response = await fetch(`/api/market-datasets/${dataset.id}/paper-session`, { method: "DELETE" });
        if (!response.ok) throw new Error(copy.paperTrading.requestFailed);
        pausePlayback();
        router.push(`/market-replay/${dataset.id}`);
      } catch {
        setPaperError(copy.paperTrading.requestFailed);
        try {
          await reloadPaper();
          const suspension = confirmationSuspensionRef.current;
          confirmationSuspensionRef.current = null;
          restorePlayback(suspension);
        } catch {
          autoPausePlayback("operation-failed");
          const suspension = confirmationSuspensionRef.current;
          confirmationSuspensionRef.current = null;
          restorePlayback(suspension);
        }
      }
    } else {
      const suspension = confirmationSuspensionRef.current;
      confirmationSuspensionRef.current = null;
      pausePlayback();
      restorePlayback(suspension);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pendingSaveRef.current = null;
      await saveChainRef.current.catch(() => undefined);
      const response = await fetch(`/api/market-datasets/${dataset.id}/replay/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESET" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setSaveStatus("error");
        setConfirmAction(null);
        return;
      }
      router.push(`/market-replay/${dataset.id}?sessionId=${encodeURIComponent(data.replaySessionId)}`);
    }
    setConfirmAction(null);
  }

  async function mutatePaper(url: string, createInit: (version: number | null) => RequestInit) {
    if (correctionPending || dateForwarding) { setPaperError(copy.replaySessions.busy); return false; }
    if (chartWindowDetachedRef.current && !await returnToLiveWindow()) return false;
    pendingPaperMutationsRef.current += 1;
    setPaperBusy(true);
    setPaperError(null);
    const operation = paperMutationChainRef.current.catch(() => undefined).then(async () => {
      const operationIntent = capturePlaybackIntent();
      const suspension = suspendPlayback();
      manualStepsRef.current.cancel();
      paperMutationActiveRef.current = true;
      await advanceCompletionRef.current.catch(() => undefined);
      try {
        if (!(await flushVisible())) return false;
        const version = confirmedPaperSnapshotRef.current?.session.version ?? null;
        const response = await fetch(url, createInit(version));
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 409) await reloadPaper();
          throw new Error(data?.error ?? copy.paperTrading.requestFailed);
        }
        if (data.snapshot !== undefined) {
          const snapshot = data.snapshot as PaperSessionSnapshot | null;
          const previousFillId = confirmedPaperSnapshotRef.current?.recentFills[0]?.id;
          commitConfirmedPaperSnapshot(snapshot);
          if (snapshot?.recentFills[0]?.id && snapshot.recentFills[0].id !== previousFillId) {
            void loadTradeAnnotations(barsRef.current.slice(-DEFAULT_REPLAY_MAX_VISIBLE_BARS));
          }
        }
        return true;
      } catch (error) {
        setPaperError(error instanceof Error ? error.message : copy.paperTrading.requestFailed);
        try {
          await reloadPaper();
        } catch {
          recoveryRequiredRef.current = true;
          autoPausePlayback("operation-failed", operationIntent);
        }
        return false;
      } finally {
        paperMutationActiveRef.current = false;
        if (restorePlayback(suspension)) {
          playbackClockRef.current = performance.now();
        }
      }
    });
    paperMutationChainRef.current = operation.then(() => undefined, () => undefined);
    return operation.finally(() => {
      pendingPaperMutationsRef.current -= 1;
      if (pendingPaperMutationsRef.current === 0) setPaperBusy(false);
    });
  }

  function openCorrectionTarget(target: CorrectionTarget) {
    if (correctionPending) return;
    pausePlayback(); manualStepsRef.current.cancel(); setCorrectionTarget(target);
  }

  async function openDateDialog() {
    if (dateDialogOpening || correctionPending || dateForwarding || viewChangingRef.current) return;
    setDateDialogOpening(true);
    try {
      if (!await prepareSessionSwitch()) return;
      const current = latestReplayRef.current;
      if (!current || !replaySession) return;
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(replaySession.id)}/locate?sequence=${current.currentSequence}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? copy.replaySessions.requestFailed);
      setDateDialogMinimum(data.minTimestamp);
      setDateDialogOpen(true);
    } catch (error) {
      setPaperError(error instanceof Error ? error.message : copy.replaySessions.requestFailed);
    } finally { setDateDialogOpening(false); }
  }

  async function locateReplayDate(timestamp: string, forward: boolean) {
    if (correctionPending || dateForwarding || viewChangingRef.current) return false;
    if (!await prepareSessionSwitch()) return false;
    const response = await fetch(`/api/replay-sessions/${encodeURIComponent(replaySession!.id)}/locate?timestamp=${encodeURIComponent(timestamp)}${forward ? "&direction=FORWARD" : ""}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? copy.replaySessions.requestFailed);
    if (!forward) return locateChartDate(data.sequence);
    setDateDialogOpen(false); setJournalReview(null); setChartFocusSequence(null); setDateForwarding(true); cancelForwardRef.current = false;
    try {
      while ((latestReplayRef.current?.currentSequence ?? data.sequence) < data.sequence && !cancelForwardRef.current) {
        const current = latestReplayRef.current!;
        const processed = await processServerBars(Math.min(MAX_REPLAY_BULK_SOURCE_BARS, data.sequence - current.currentSequence), () => !cancelForwardRef.current, undefined, true);
        if (!processed || !await flushVisible()) return false;
        setForwardProgress({ current: latestReplayRef.current!.currentSequence, target: data.sequence });
      }
      return true;
    } finally { await flushVisible(); setDateForwarding(false); setForwardProgress(null); pausePlayback(); }
  }

  async function prepareSessionSwitch() {
    cancelForwardRef.current = true; pausePlayback(); manualStepsRef.current.cancel();
    await paperMutationChainRef.current; await advanceCompletionRef.current;
    pausePlayback(); return flushVisible();
  }

  async function locateChartDate(sequence: number) {
    if ((journalReview || chartWindowDetachedRef.current) && !await returnToLiveWindow()) return false;
    const current = latestReplayRef.current;
    if (!current || viewChangingRef.current) return false;
    viewChangingRef.current = true;
    historyEpochRef.current += 1;
    historyAbortRef.current?.abort();
    historyAbortRef.current = null;
    historyLoadingRef.current = false;
    try {
      // Keep the current chart and its revealed right edge. Only extend the
      // existing history when the requested candle is not already loaded.
      while ((barsRef.current[0]?.firstSequence ?? 0) > sequence
        && barsRef.current.length < REPLAY_HISTORY_BAR_LIMIT && historyHasEarlierRef.current) {
        const previousFirst = barsRef.current[0].firstSequence;
        await loadEarlierHistory();
        if ((barsRef.current[0]?.firstSequence ?? previousFirst) >= previousFirst) break;
      }
      if ((barsRef.current[0]?.firstSequence ?? 0) > sequence && historyHasEarlierRef.current) {
        // Very distant dates need a bounded window; ordinary navigation keeps
        // its existing candles and does not enter journal review mode.
        await loadWindow(current.currentSequence, current.displayIntervalSeconds, current.displaySession,
          indicatorWarmupCountRef.current, null, sequence, true);
        chartWindowDetachedRef.current = true;
      }
      if (!barsRef.current.length) return false;
      startTransition(() => {
        setBars(barsRef.current);
        setWarmupBars(warmupBarsRef.current);
        setChartFocusSequence(sequence);
      });
      return true;
    } finally { viewChangingRef.current = false; }
  }

  async function createPaperAccount(config: { initialCapital: number; currency: string; commissionBps: number; slippageBps: number }) {
    return mutatePaper(`/api/market-datasets/${dataset.id}/paper-session`, () => ({
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config),
    }));
  }

  async function sendPaperOrder(order: PaperOrderInput, gateApproval?: GateApprovalInput) {
    if (!paperSnapshotRef.current) return false;
    // Capture before mutatePaper temporarily suspends automatic playback.
    const executeAtCurrentClose = order.type === "MARKET" && order.reduceOnly === true && !wantsPlayback();
    return mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders`, (version) => ({
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...order, executeAtCurrentClose, gateApproval, expectedVersion: version }),
    }));
  }

  const onChartDraftChange = useCallback((draftId: string | null) => {
    chartDraftIdRef.current = draftId;
    setEntryCheckDraft((current) => current && current.draftId !== draftId ? null : current);
  }, []);

  async function submitPaperOrder(order: PaperOrderInput, draftId?: string): Promise<OrderSubmitResult> {
    const snapshot = paperSnapshotRef.current;
    if (!snapshot || checkingOrder || checkResolverRef.current || preparingEntryCheckRef.current) return "CANCELLED";
    const closing = order.reduceOnly || isClosingOrder(snapshot.session.netQuantity, order.side, order.quantity);
    if (replaySession?.mode === "TRAINING" && snapshot.session.trainingGate?.active && !closing) {
      const fromChart = draftId !== undefined && chartDraftIdRef.current === draftId;
      preparingEntryCheckRef.current = true;
      try {
        if (!await prepareSessionSwitch()) return "FAILED";
        if (fromChart && chartDraftIdRef.current !== draftId) return "CANCELLED";
      } finally { preparingEntryCheckRef.current = false; }
      setPaperError(null);
      const checkDraftId = draftId ?? createUuid();
      setEntryCheckDraft((current) => retainEntryCheckDraft(current, checkDraftId));
      return new Promise<OrderSubmitResult>((resolve) => { checkResolverRef.current = resolve; setCheckingOrder({ order: { ...order }, draftId: checkDraftId }); });
    }
    return await sendPaperOrder(order) ? "SUCCESS" : "FAILED";
  }

  function cancelEntryCheck() {
    if (paperBusy) return;
    setCheckingOrder(null); setPaperError(null);
    const resolve = checkResolverRef.current; checkResolverRef.current = null; resolve?.("CANCELLED");
  }
  async function confirmEntryCheck(approval: GateApprovalInput) {
    if (!checkingOrder || paperBusy) return false;
    const success = await sendPaperOrder(checkingOrder.order, approval);
    if (success) {
      setCheckingOrder(null);
      setEntryCheckDraft(null);
      const resolve = checkResolverRef.current; checkResolverRef.current = null; resolve?.("SUCCESS");
    }
    return success;
  }

  async function openGateConfig() {
    if (!replaySession || gateBusy || checkingOrder) return;
    setGateBusy(true); setGateError(null);
    try {
      if (!await prepareSessionSwitch()) throw new Error(copy.replaySessions.switchFailed);
      const response = await fetch(`/api/replay-sessions/${replaySession.id}/training-gate`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? copy.trainingGate.failed);
      setGateSettings(data.gate); setGateDialogOpen(true);
    } catch (error) { setGateNotice(error instanceof Error ? error.message : copy.trainingGate.failed); }
    finally { setGateBusy(false); }
  }
  async function saveGateConfig(tradeCount: number, start: boolean) {
    if (!replaySession || gateBusy) return;
    setGateBusy(true); setGateError(null);
    try {
      const current = await fetch(`/api/replay-sessions/${replaySession.id}/training-gate`, { cache: "no-store" });
      const latest = await current.json();
      if (!current.ok) throw new Error(latest.error ?? copy.trainingGate.failed);
      const response = await fetch(`/api/replay-sessions/${replaySession.id}/training-gate`, { method: start ? "POST" : "PUT", headers: { "Content-Type": "application/json", "X-Replay-Projection": replaySession.activeProjectionId }, body: JSON.stringify({ tradeCount, expectedVersion: latest.version }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? copy.trainingGate.failed);
      setGateSettings(data.gate); commitConfirmedPaperSnapshot(data.snapshot);
      setGateNotice(start ? `${copy.trainingGate.manual} · ${copy.trainingGate.cancelled(data.gate.cancelledOrderCount)}` : copy.trainingGate.saved);
      setGateDialogOpen(false);
    } catch (error) { setGateError(error instanceof Error ? error.message : copy.trainingGate.failed); }
    finally { setGateBusy(false); }
  }
  const currentGate = paperSnapshot?.session.trainingGate ?? gateSettings;
  const gateButton = replaySession?.mode === "TRAINING" ? <Button variant="outline" size="sm" className="h-10 md:h-9" disabled={gateBusy || isLoading || Boolean(loadError) || !replay || Boolean(checkingOrder) || Boolean(journalReview)} onClick={() => void openGateConfig()}>{gateBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{currentGate.active ? copy.trainingGate.remaining(currentGate.targetCount - currentGate.completedCount) : copy.trainingGate.title}</Button> : null;

  const gateNoticeBlock = gateNotice ? <div className="flex shrink-0 items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status"><span>{gateNotice}</span><Button variant="ghost" size="icon" aria-label={copy.common.cancel} onClick={() => setGateNotice(null)}><X className="h-4 w-4" /></Button></div> : null;

  async function updatePaperOrder(orderId: string, update: { price?: number; quantity?: number; stopLoss?: number | null; takeProfit?: number | null; riskAmount?: number | null }) {
    if (!paperSnapshotRef.current) return false;
    return mutatePaper(paperOrderUrl(dataset.id, orderId), (version) => ({
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...update, expectedVersion: version }),
    }));
  }

  async function cancelPaperOrder(orderId: string) {
    if (!paperSnapshotRef.current) return false;
    return mutatePaper(paperOrderUrl(dataset.id, orderId), (version) => ({
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version }),
    }));
  }

  async function cancelPaperScope(scope: "ALL" | "BRACKET") {
    if (!paperSnapshotRef.current) return false;
    return mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders`, (version) => ({
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version, scope }),
    }));
  }

  async function closePaperPosition() {
    const quantity = Math.abs(paperSnapshotRef.current?.session.netQuantity ?? 0);
    if (quantity <= 0) return false;
    return await submitPaperOrder({
      side: Number(paperSnapshotRef.current?.session.netQuantity) > 0 ? "SELL" : "BUY",
      type: "MARKET",
      quantity,
      price: null,
      stopLoss: null,
      takeProfit: null,
      reduceOnly: true,
    }) === "SUCCESS";
  }

  const currentBar = replay && replay.currentSequence >= 0 ? currentSourceBar : null;
  const revealedCount = replay ? Math.max(0, replay.currentSequence - replay.startSequence + 1) : 0;
  const replayCount = replay ? replay.barCount - replay.startSequence : 0;
  const activityVisible = useDelayedActivity(saveStatus === "saving" || buffering || pauseReason === "operation");
  const statusText = replayPlaybackStatusText({
    retrying, playbackRequested: wantsPlayback(), recoveryNotice, buffering, saveStatus,
    activityVisible, replayStatus: replay?.status, pauseReason,
  });

  function wrapWorkspace(content: ReactNode) {
    return <div className="flex h-full min-h-0 flex-col gap-2">
      {!webFullscreen ? <header className="shrink-0" data-replay-workspace-header>
        <Breadcrumbs items={[{ label: copy.marketReplay.title, href: "/market-replay" }, { label: dataset.name }]} />
        <div className="mt-1 flex flex-wrap items-center gap-4">
          <h1 className="shrink-0 text-xl font-semibold tracking-tight text-slate-950">{copy.marketReplay.replayTitle(dataset.symbol, dataset.timeframe)}</h1>
          <p className="min-w-0 truncate text-xs text-slate-500">{dataset.name} · {dataset.timezone}</p>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{gateButton}<ReplaySessionSwitch beforeSwitch={prepareSessionSwitch} disabled={isLoading || Boolean(loadError) || !replay || Boolean(checkingOrder)} /></div>
        </div>
      </header> : null}
      {!webFullscreen ? gateNoticeBlock : null}
      {gateDialogOpen ? <TrainingGateConfigDialog gate={currentGate} busy={gateBusy} error={gateError} onClose={() => setGateDialogOpen(false)} onSave={saveGateConfig} /> : null}
      {checkingOrder ? <EntryCheckDialog order={checkingOrder.order} approval={entryCheckDraft?.draftId === checkingOrder.draftId ? entryCheckDraft.approval : null} onApprovalChange={(approval) => setEntryCheckDraft((current) => current?.draftId === checkingOrder.draftId ? { ...current, approval } : current)} busy={paperBusy} error={paperError} onClose={cancelEntryCheck} onConfirm={confirmEntryCheck} /> : null}
      {content}
    </div>;
  }

  if (!dataset.sourceIntervalSeconds) return wrapWorkspace(
    <Card className="max-w-xl"><CardHeader><CardTitle>{copy.marketReplay.repairMetadata}</CardTitle><CardDescription>{copy.marketReplay.repairMetadataDescription}</CardDescription></CardHeader>
      <CardContent className="space-y-3"><Label htmlFor="repair-source-interval">{copy.marketReplay.sourceInterval}</Label><Input id="repair-source-interval" type="number" min="1" max="86400" value={repairInterval} onChange={(event) => setRepairInterval(event.target.value)} />
        <Button type="button" onClick={async () => {
          const response = await fetch(`/api/market-datasets/${dataset.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceIntervalSeconds: Number(repairInterval), sessionMode: "TWENTY_FOUR_SEVEN", sessionOpenMinute: null, sessionCloseMinute: null, tradingWeekdays: [1,2,3,4,5,6,7] }) });
          const data = await response.json().catch(() => null); if (!response.ok) setLoadError(data?.error ?? copy.marketReplay.loadError); else window.location.reload();
        }}>{copy.marketReplay.saveMetadata}</Button>{loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}</CardContent></Card>
  );

  if (isLoading) return wrapWorkspace(
    <div className="space-y-3" aria-busy="true" aria-label={copy.marketReplay.loading}>
      <div className="flex h-12 items-center justify-between rounded-lg border bg-white px-4">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
        <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />{copy.marketReplay.loading}</div>
      </div>
      <div className="h-[min(68vh,44rem)] animate-pulse rounded-lg border bg-slate-100" />
      <div className="h-14 animate-pulse rounded-lg border bg-slate-50" />
    </div>
  );
  if (loadError) return wrapWorkspace(<Alert className="border-red-200 bg-red-50"><AlertTitle>{copy.marketReplay.loadError}</AlertTitle><AlertDescription>{loadError}</AlertDescription></Alert>);

  if (!replay) {
    return wrapWorkspace(
      <Card className="max-w-xl">
        <CardHeader>
          <p className="font-mono text-xs uppercase tracking-wide text-blue-700">{copy.marketReplay.setupEyebrow}</p>
          <CardTitle>{copy.marketReplay.setupTitle}</CardTitle>
          <CardDescription>{copy.marketReplay.setupDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={beginReplay} className="space-y-4">
            <div className="space-y-2">
              <DateTimePicker ref={startPickerRef}
                minimum={dateTimeLocalValue(dataset.startTime, dataset.timezone)}
                maximum={dateTimeLocalValue(dataset.endTime, dataset.timezone)}
                value={startValue} onChange={setStartValue} />
              <p className="text-xs text-slate-500">{dataset.timezone} · {formatDatasetTime(dataset.startTime, dataset.timezone)} – {formatDatasetTime(dataset.endTime, dataset.timezone)}</p>
            </div>
            {startError ? <p className="text-sm text-red-600">{startError}</p> : null}
            <Button type="submit"><Settings2 className="h-4 w-4" />{copy.marketReplay.begin}</Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <ReplayCorrectionProvider pending={correctionPending} onDeleteCycle={(entry) => { if (entry.cycleKey) openCorrectionTarget({ type: "DELETE_CYCLE", cycleKey: entry.cycleKey, no: entry.no }); }}>
    {wrapWorkspace(<>
      <div
        data-web-fullscreen={webFullscreen}
        aria-label={dataset.name}
        className={webFullscreen
          ? "fixed inset-0 z-40 flex h-dvh min-h-0 flex-col overflow-hidden bg-white"
          : "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-white shadow-sm"}
      >
        {webFullscreen ? gateNoticeBlock : null}
        {replaySession?.mode === "LIVE_REPLAY" ? <ReplayCorrectionDialog target={correctionTarget} displayUtcOffsetMinutes={displayUtcOffsetMinutes} beforeCreate={prepareSessionSwitch} onClose={() => setCorrectionTarget(null)} onPendingChange={setCorrectionPending} /> : null}
        <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b px-3 [&>*]:shrink-0">
          {webFullscreen ? gateButton : null}
          <DisplayIntervalControls
            value={replay.displayIntervalSeconds}
            sourceIntervalSeconds={dataset.sourceIntervalSeconds}
            disabled={Boolean(journalReview) || correctionPending}
            onChange={changeDisplayInterval}
          />
          {dataset.availableDisplaySessions.length > 1 ? (
            <>
              <Label htmlFor="display-session" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.displaySession}</Label>
              <Select disabled={Boolean(journalReview) || correctionPending} value={replay.displaySession} onValueChange={(value) => void changeChartSession(value as DisplaySession)}>
                <SelectTrigger id="display-session" className="h-8 w-20" title={copy.marketReplay.displaySessionHint}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ETH">{copy.marketReplay.displaySessionEth}</SelectItem>
                  <SelectItem value="RTH">{copy.marketReplay.displaySessionRth}</SelectItem>
                </SelectContent>
              </Select>
            </>
          ) : null}
          <Label htmlFor="display-timezone" className="whitespace-nowrap text-xs text-slate-500">{copy.marketReplay.displayTimezone}</Label>
          <Select value={String(displayUtcOffsetMinutes)} onValueChange={(value) => setDisplayUtcOffsetMinutes(Number(value))}>
            <SelectTrigger id="display-timezone" className="h-8 w-28" title={copy.marketReplay.displayTimezoneHint}><SelectValue /></SelectTrigger>
            <SelectContent
              position="popper"
              sideOffset={4}
              align="end"
              collisionPadding={8}
              className="max-h-72 w-40"
            >
              {UTC_OFFSET_OPTIONS.map((offset) => <SelectItem key={offset} value={String(offset)}>{formatUtcOffset(offset)}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="mx-1 h-5 w-px bg-slate-200" />
          <Popover.Root open={drawingToolOpen} onOpenChange={setDrawingToolOpen}>
            <Popover.Trigger asChild>
              <Button
                type="button"
                variant={drawingTool ? "secondary" : "ghost"}
                size="sm"
                className="h-8"
                aria-pressed={Boolean(drawingTool)}
                aria-label={copy.marketReplay.drawingToolsHint}
              >
                <TrendingUp className="h-4 w-4" />
                <span className="hidden xl:inline">{copy.marketReplay.drawingTools}</span>
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="start"
                sideOffset={6}
                collisionPadding={8}
                className="z-[80] w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  onClick={armTrendLine}
                  aria-keyshortcuts="Alt+t"
                >
                  <TrendingUp className="h-4 w-4 text-slate-600" />
                  <span className="font-medium">{copy.marketReplay.trendLine}</span>
                  <kbd className="ml-auto whitespace-nowrap font-mono text-[11px] text-slate-400">{shortcuts.trendLine}</kbd>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  onClick={armFibonacciRetracement}
                  aria-keyshortcuts="Alt+f"
                >
                  <span className="flex h-4 w-4 items-center justify-center font-mono text-[10px] font-bold text-slate-600">Fib</span>
                  <span className="font-medium">{copy.marketReplay.fibonacciRetracement}</span>
                  <kbd className="ml-auto whitespace-nowrap font-mono text-[11px] text-slate-400">{shortcuts.fibonacciRetracement}</kbd>
                </button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Button
            type="button"
            variant={drawingObjectsOpen ? "secondary" : "ghost"}
            size="sm"
            className="h-8"
            aria-pressed={drawingObjectsOpen}
            title={`${copy.marketReplay.drawingObjectsHint}\n${copy.marketReplay.drawingDeleteShortcutHint(shortcuts.deleteDrawing)}`}
            onClick={() => setDrawingObjectsOpen((current) => !current)}
          >
            <ListTree className="h-4 w-4" />
            <span className="hidden xl:inline">{copy.marketReplay.drawingObjects}</span>
          </Button>
          <Button
            type="button"
            variant={measurementArmed ? "secondary" : "ghost"}
            size="sm"
            className="group relative h-8"
            aria-pressed={measurementArmed}
            aria-label={copy.marketReplay.measureHint}
            onClick={() => setMeasurementArmed((current) => !current)}
          >
            <Ruler className="h-4 w-4" />
            <span className="hidden xl:inline">{copy.marketReplay.measure}</span>
            <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden -translate-x-1/2 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-normal text-white shadow-lg group-hover:block group-focus-visible:block">
              {copy.marketReplay.measureHint}
            </span>
          </Button>
          <ChartVisibilityMenu value={chartVisibility} onChange={changeChartVisibility} />
          <Button
            type="button"
            variant={settingsDialog === "candlesticks" ? "secondary" : "ghost"}
            size="sm"
            className="h-8"
            onClick={() => {
              setCandlestickStyleDraft({ ...candlestickStyle });
              setSettingsDialog("candlesticks");
            }}
          >
            <Palette className="h-4 w-4" />
            <span className="hidden xl:inline">{copy.marketReplay.candlestickStyle}</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setSettingsDialog("indicators")}><Settings2 className="h-4 w-4" />{copy.marketReplay.indicators}</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setSettingsDialog("paper")}><WalletCards className="h-4 w-4" />{copy.marketReplay.accountSettings}</Button>
          <Button asChild type="button" variant="ghost" size="sm" className="h-8"><Link href={`/market-replay/${dataset.id}/trade-history?sessionId=${encodeURIComponent(replaySession?.id ?? "")}`}><BookOpen className="h-4 w-4" />{copy.paperTrading.openJournalHistory}</Link></Button>
          {paperSnapshot ? <div className="hidden items-center gap-3 text-xs text-slate-500 xl:flex"><span>{copy.paperTrading.equity} <strong className="font-medium text-slate-800">{paperSnapshot.stats.equity.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} {paperSnapshot.session.currency}</strong></span><span>{copy.paperTrading.netPosition} <strong className="font-medium text-slate-800">{paperSnapshot.session.netQuantity}</strong></span></div> : null}
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-8" disabled={draftActive} title={draftActive ? copy.paperTrading.draftLockedReplay : undefined} onClick={() => requestConfirmation("reset")}><RotateCcw className="h-4 w-4" /><span className="hidden xl:inline">{copy.marketReplay.reset}</span></Button>
            <Button type="button" variant="ghost" size="sm" className="h-8" disabled={draftActive} title={draftActive ? copy.paperTrading.draftLockedReplay : undefined} onClick={openStartDialog}><span className="hidden xl:inline">{copy.marketReplay.chooseNewStart}</span><span className="xl:hidden">{copy.marketReplay.startAt}</span></Button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {autoPauseEvent ? (
            <div className="pointer-events-none absolute inset-x-3 top-3 z-[60]">
              <ReplayAutoPauseNotice event={autoPauseEvent} onDismiss={dismissAutoPause} />
            </div>
          ) : null}
          <ReplayChart
            datasetId={dataset.id}
            priceTickSize={dataset.priceTickSize}
            bars={bars}
            warmupBars={warmupBars}
            displayUtcOffsetMinutes={displayUtcOffsetMinutes}
            displayIntervalSeconds={replay.displayIntervalSeconds}
            sourceIntervalSeconds={dataset.sourceIntervalSeconds}
            candleCountdownEnabled={chartVisibility.indicators && candleCountdownEnabled}
            playbackActive={replay.status === "playing"}
            currentSourceTimestamp={currentBar?.timestamp ?? null}
            measurementArmed={measurementArmed}
            candlestickStyle={candlestickStyleDraft ?? candlestickStyle}
            onMeasurementArmedChange={setMeasurementArmed}
            drawingTool={drawingTool}
            onDrawingToolChange={setDrawingTool}
            trendLineDraftStyle={defaultTrendLineStyle}
            fibonacciDraftStyle={defaultFibonacciStyle}
            drawings={visibleDrawings}
            selectedDrawingId={selectedDrawingId}
            onSelectedDrawingIdChange={setSelectedDrawingId}
            onCreateDrawing={(type, geometry) => void createDrawing(type, geometry)}
            onUpdateDrawing={(id, geometry) => void updateDrawing(id, { geometry })}
            onDeleteDrawing={(id) => void deleteDrawing(id)}
            onOpenDrawingStyle={openDrawingStyle}
            emaEnabled={chartVisibility.indicators && emaEnabled}
            emaIndicators={emaIndicators}
            abrEnabled={chartVisibility.indicators && abrEnabled}
            abrLength={abrLength}
            volumeVisible={chartVisibility.indicators && volumeVisible}
            gridVisible={gridVisible}
            onToggleGrid={() => setGridVisible((current) => !current)}
            displaySession={replay.displaySession}
            barCountSession={displayMarketSession}
            barCountConfig={visibleBarCountConfig}
            paperSnapshot={journalReview ? null : paperSnapshot}
            tradeAnnotations={tradeAnnotations}
            tradeAnnotationsTruncated={tradeAnnotationsTruncated}
            tradeAnnotationsVisible={chartVisibility.tradeAnnotations}
            focusSequence={chartFocusSequence}
            onFocusApplied={() => setChartFocusSequence(null)}
            paperBusy={paperBusy || correctionPending || dateForwarding}
            paperError={paperError}
            onSubmitOrder={submitPaperOrder}
            onOrderPriceChange={updatePaperOrder}
            onCancelOrder={cancelPaperOrder}
            onClosePosition={closePaperPosition}
            onDraftActiveChange={setDraftActive}
            onDraftIdentityChange={onChartDraftChange}
            entryCheckOpen={Boolean(checkingOrder)}
            onOpenPaperAccount={() => setSettingsDialog("paper")}
            onVisibleSequenceRangeChange={handleVisibleSequenceRange}
            rewindRange={{ minSequence: replay.startSequence - 1, maxSequence: replay.currentSequence }}
            onRewindToBar={replaySession?.mode === "LIVE_REPLAY" && !replaySession.legacy && !journalReview
              ? (target) => openCorrectionTarget({ type: "REWIND", sequence: target.sequence, chartTimestamp: target.timestamp }) : undefined}
          />
          {journalReview ? <div className="absolute left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md border border-violet-200 bg-white/95 px-3 py-2 text-sm text-violet-800 shadow-lg backdrop-blur"><span className="font-medium">{journalReview.no > 0 ? copy.paperTrading.journalReviewing(journalReview.no) : copy.replaySessions.viewingPast}</span><Button type="button" variant="outline" size="sm" className="h-7" onClick={() => void returnToLiveWindow()}>{copy.paperTrading.returnToLive}</Button></div> : null}
          {drawingError ? (
            <div className="pointer-events-none absolute left-3 top-3 z-40 max-w-sm rounded-md border border-red-200 bg-red-50/95 px-3 py-2 text-xs text-red-700 shadow-sm">
              {drawingError}
            </div>
          ) : null}
          {drawingObjectsOpen ? (
            <aside className="absolute right-3 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-72 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-xl backdrop-blur">
              <header className="flex items-center gap-2 border-b px-3 py-2.5">
                <ListTree className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-950">{copy.marketReplay.drawingObjects}</h3>
                <button
                  type="button"
                  className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label={copy.marketReplay.closeDrawingObjects}
                  onClick={() => setDrawingObjectsOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {drawings.length ? drawings.map((drawing, index) => {
                  const pending = pendingDrawingIds.has(drawing.id);
                  const selected = selectedDrawingId === drawing.id;
                  const drawingColor = drawing.type === DRAWING_TYPE_TREND_LINE
                    ? drawing.style.color
                    : drawing.style.levels.find((level) => level.enabled)?.color ?? "#787B86";
                  return (
                    <div
                      key={drawing.id}
                      role="button"
                      tabIndex={0}
                      className={`group flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none transition-colors ${selected ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"}`}
                      onClick={() => setSelectedDrawingId(drawing.id)}
                      onDoubleClick={() => openDrawingStyle(drawing.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedDrawingId(drawing.id);
                        }
                      }}
                    >
                      {drawing.type === DRAWING_TYPE_TREND_LINE
                        ? <TrendingUp className="h-4 w-4 shrink-0" style={{ color: drawingColor, opacity: drawing.style.opacity / 100 }} />
                        : <span className="flex h-4 w-4 shrink-0 items-center justify-center font-mono text-[9px] font-bold" style={{ color: drawingColor }}>Fib</span>}
                      <span className="min-w-0 flex-1 truncate font-medium">{drawing.type === DRAWING_TYPE_TREND_LINE
                        ? copy.marketReplay.trendLineObjectName(index + 1)
                        : copy.marketReplay.fibonacciObjectName(index + 1)}</span>
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={drawing.type === DRAWING_TYPE_TREND_LINE ? copy.marketReplay.trendLineDelete : copy.marketReplay.fibonacciDelete}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteDrawing(drawing.id);
                        }}
                      >
                        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  );
                }) : <p className="px-3 py-8 text-center text-xs text-slate-500">{copy.marketReplay.drawingObjectsEmpty}</p>}
              </div>
            </aside>
          ) : null}
        </div>
        <ReplayPlaybackBar
          onLocateDate={() => { void openDateDialog(); }}
          dateForwarding={dateForwarding}
          dateForwardStatus={forwardProgress ? copy.replaySessions.forwardProgress(forwardProgress.current, forwardProgress.target) : copy.replaySessions.forwarding}
          onStopDateForward={() => { cancelForwardRef.current = true; }}
          correctionPending={correctionPending || dateForwarding || dateDialogOpen || dateDialogOpening || reviewReturning || Boolean(checkingOrder)}
          replay={replay}
          sourceIntervalSeconds={dataset.sourceIntervalSeconds}
          paperSnapshot={paperSnapshot}
          currentBar={currentBar}
          displayUtcOffsetMinutes={displayUtcOffsetMinutes}
          revealedCount={revealedCount}
          replayCount={replayCount}
          statusText={statusText}
          retrying={retrying}
          playbackRequested={replay.status === "playing" || (retrying && wantsPlayback())}
          webFullscreen={webFullscreen}
          onToggleWebFullscreen={() => setWebFullscreen((current) => !current)}
          onToggle={togglePlayback}
          onNext={() => void revealNextBar()}
          onSpeedChange={changeSpeed}
          onFocusJournalEntry={(entry) => void enterJournalReview({ sequence: entry.openedSequence, no: entry.no, globalNo: entry.globalNo })}
        />
      </div>

      <Dialog
        open={settingsDialog === "candlesticks"}
        title={copy.marketReplay.candlestickSettings}
        description={copy.marketReplay.candlestickSettingsDescription}
        className="max-w-md"
        onClose={() => {
          setCandlestickStyleDraft(null);
          setSettingsDialog(null);
        }}
      >
        {candlestickStyleDraft ? (
          <div className="space-y-5">
            <div className="grid grid-cols-[7rem_1fr_1fr] items-center gap-3 px-1 text-center text-xs font-medium text-slate-500">
              <span />
              <span>{copy.marketReplay.bullishCandle}</span>
              <span>{copy.marketReplay.bearishCandle}</span>
            </div>
            <div className="space-y-2">
              {([
                { visible: "bodyVisible", up: "upColor", down: "downColor", label: copy.marketReplay.candleBody },
                { visible: "borderVisible", up: "borderUpColor", down: "borderDownColor", label: copy.marketReplay.candleBorder },
                { visible: "wickVisible", up: "wickUpColor", down: "wickDownColor", label: copy.marketReplay.candleWick },
              ] as const).map((row) => (
                <div key={row.visible} className="grid grid-cols-[7rem_1fr_1fr] items-center gap-3 rounded-md border px-3 py-2.5">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={candlestickStyleDraft[row.visible]}
                      onChange={(event) => setCandlestickStyleDraft((current) => current ? {
                        ...current,
                        [row.visible]: event.target.checked,
                      } : current)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {row.label}
                  </label>
                  <Input
                    type="color"
                    value={candlestickStyleDraft[row.up]}
                    aria-label={copy.marketReplay.candlestickColorLabel(row.label, copy.marketReplay.bullishCandle)}
                    onChange={(event) => setCandlestickStyleDraft((current) => current ? {
                      ...current,
                      [row.up]: event.target.value.toUpperCase(),
                    } : current)}
                    className="mx-auto h-9 w-12 cursor-pointer p-1"
                  />
                  <Input
                    type="color"
                    value={candlestickStyleDraft[row.down]}
                    aria-label={copy.marketReplay.candlestickColorLabel(row.label, copy.marketReplay.bearishCandle)}
                    onChange={(event) => setCandlestickStyleDraft((current) => current ? {
                      ...current,
                      [row.down]: event.target.value.toUpperCase(),
                    } : current)}
                    className="mx-auto h-9 w-12 cursor-pointer p-1"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => {
                setCandlestickStyleDraft(null);
                setSettingsDialog(null);
              }}>{copy.marketReplay.drawingCancel}</Button>
              <Button type="button" onClick={() => {
                setCandlestickStyle({ ...candlestickStyleDraft });
                setCandlestickStyleDraft(null);
                setSettingsDialog(null);
              }}>{copy.marketReplay.drawingConfirm}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <IndicatorSettingsDialog
        open={settingsDialog === "indicators"}
        onClose={() => setSettingsDialog(null)}
        candleCountdown={{
          enabled: candleCountdownEnabled,
          onChange: setCandleCountdownEnabled,
        }}
        volumeVisible={volumeVisible}
        onVolumeVisibleChange={setVolumeVisible}
        barCountConfig={barCountConfig}
        setBarCountConfig={setBarCountConfig}
        onBarCountRecentTradingDaysChange={updateBarCountRecentTradingDays}
        onBarCountIntervalChange={updateBarCountInterval}
        barCountError={barCountError}
        abrEnabled={abrEnabled}
        onAbrEnabledChange={setAbrEnabled}
        abrLength={abrLength}
        onAbrLengthChange={updateAbrLength}
        abrError={abrError}
        emaEnabled={emaEnabled}
        onEmaEnabledChange={setEmaEnabled}
        emaIndicators={emaIndicators}
        setEmaIndicators={setEmaIndicators}
        onEmaLengthChange={setEmaLength}
        onAddEma={addEma}
        emaError={emaError}
      />
      <Dialog open={settingsDialog === "paper" && !checkingOrder} keepMounted={settingsDialog === "paper"} title={copy.marketReplay.accountSettings} description={copy.marketReplay.accountSettingsDescription} className="max-w-3xl" onClose={() => setSettingsDialog(null)}>
        <div className="space-y-4">
          <PaperAccountStrip snapshot={paperSnapshot} />
          {journalReview ? null : <PaperTradingPanel priceTickSize={dataset.priceTickSize} snapshot={paperSnapshot} currentBar={currentBar} busy={paperBusy || correctionPending || dateForwarding} error={paperError} onCreate={createPaperAccount} onSubmit={submitPaperOrder} onCancel={cancelPaperOrder} onUpdate={updatePaperOrder} onCancelScope={cancelPaperScope} onClear={() => requestConfirmation("paper-clear")} />}
        </div>
      </Dialog>
      <Dialog
        open={Boolean(styleDrawingId && styleDraft && !templateDialogOpen)}
        title={drawings.find((drawing) => drawing.id === styleDrawingId)?.type === DRAWING_TYPE_FIB_RETRACEMENT
          ? copy.marketReplay.fibonacciSettings
          : copy.marketReplay.trendLineSettings}
        description={drawings.find((drawing) => drawing.id === styleDrawingId)?.type === DRAWING_TYPE_FIB_RETRACEMENT
          ? copy.marketReplay.fibonacciSettingsDescription
          : copy.marketReplay.trendLineSettingsDescription}
        className={drawings.find((drawing) => drawing.id === styleDrawingId)?.type === DRAWING_TYPE_FIB_RETRACEMENT ? "max-w-2xl" : "max-w-md"}
        onClose={() => {
          setStyleDrawingId(null);
          setStyleDraft(null);
          setStyleDraftError(null);
          setSelectedTemplateId("");
        }}
      >
        {styleDraft && (() => {
          const styleDrawing = drawings.find((drawing) => drawing.id === styleDrawingId);
          if (!styleDrawing) return null;
          const isFibonacci = styleDrawing.type === DRAWING_TYPE_FIB_RETRACEMENT;
          if (isFibonacci ? !("levels" in styleDraft) : !("color" in styleDraft)) return null;
          const templates = isFibonacci ? fibonacciTemplates : trendLineTemplates;
          return (
          <div className="space-y-5">
            <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
              <Label>{copy.marketReplay.drawingTemplate}</Label>
              <div className="flex min-w-0 gap-2">
                <Select
                  value={selectedTemplateId || "__none"}
                  onValueChange={(value) => {
                    if (value === "__none") return;
                    const template = templates.find((item) => item.id === value);
                    if (!template) return;
                    setSelectedTemplateId(value);
                    setStyleDraftError(null);
                    setStyleDraft(isFibonacci
                      ? cloneFibonacciStyle(template.style as FibonacciRetracementStyle)
                      : { ...template.style as TrendLineStyle });
                  }}
                >
                  <SelectTrigger className="min-w-0 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none" disabled>
                      {templates.length ? copy.marketReplay.chooseDrawingTemplate : copy.marketReplay.noDrawingTemplates}
                    </SelectItem>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!selectedTemplateId}
                  aria-label={copy.marketReplay.deleteDrawingTemplate}
                  onClick={deleteSelectedDrawingTemplate}
                  className="shrink-0 text-slate-500 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {!isFibonacci && "color" in styleDraft ? <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
              <Label htmlFor="trend-line-color">{copy.marketReplay.lineColor}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="trend-line-color"
                  type="color"
                  value={styleDraft.color}
                  onChange={(event) => setStyleDraft((current) => current && "color" in current ? { ...current, color: event.target.value.toUpperCase() } : current)}
                  className="h-9 w-14 cursor-pointer p-1"
                />
                <span className="font-mono text-xs text-slate-500">{styleDraft.color.toUpperCase()}</span>
              </div>
            </div> : null}
            {!isFibonacci && "opacity" in styleDraft ? <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
              <Label htmlFor="trend-line-opacity">{copy.marketReplay.lineOpacity}</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="trend-line-opacity"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={styleDraft.opacity}
                  onChange={(event) => setStyleDraft((current) => current && "opacity" in current ? { ...current, opacity: Number(event.target.value) } : current)}
                  className="h-8 flex-1 border-0 px-0"
                />
                <span className="w-10 text-right text-xs tabular-nums text-slate-500">{styleDraft.opacity}%</span>
              </div>
            </div> : null}
            {isFibonacci ? <p className="text-sm font-medium text-slate-800">{copy.marketReplay.horizontalLineStyle}</p> : null}
            <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
              <Label>{copy.marketReplay.lineWidth}</Label>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((width) => (
                  <button
                    key={width}
                    type="button"
                    aria-pressed={styleDraft.width === width}
                    onClick={() => setStyleDraft((current) => current ? { ...current, width } : current)}
                    className={`flex h-9 w-10 items-center justify-center rounded-md border ${styleDraft.width === width ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}
                  >
                    <span className="block w-5 bg-slate-700" style={{ height: width }} />
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
              <Label>{copy.marketReplay.lineStyle}</Label>
              <div className="grid grid-cols-3 gap-1">
                {([
                  ["SOLID", copy.marketReplay.lineSolid],
                  ["DASHED", copy.marketReplay.lineDashed],
                  ["DOTTED", copy.marketReplay.lineDotted],
                ] as const).map(([lineStyle, label]) => (
                  <button
                    key={lineStyle}
                    type="button"
                    aria-pressed={styleDraft.lineStyle === lineStyle}
                    onClick={() => setStyleDraft((current) => current ? { ...current, lineStyle } : current)}
                    className={`rounded-md border px-2 py-2 text-xs ${styleDraft.lineStyle === lineStyle ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {!isFibonacci && "showStartPrice" in styleDraft ? <div className="space-y-2 rounded-md border bg-slate-50 p-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={styleDraft.showStartPrice}
                  onChange={(event) => setStyleDraft((current) => current && "showStartPrice" in current ? { ...current, showStartPrice: event.target.checked } : current)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                {copy.marketReplay.showStartPrice}
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={styleDraft.showEndPrice}
                  onChange={(event) => setStyleDraft((current) => current && "showEndPrice" in current ? { ...current, showEndPrice: event.target.checked } : current)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                {copy.marketReplay.showEndPrice}
              </label>
            </div> : null}
            {isFibonacci && "levels" in styleDraft ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-800">{copy.marketReplay.fibonacciLevels}</p>
                <div className="grid grid-cols-1 gap-2 rounded-md border bg-slate-50 p-3 sm:grid-cols-2">
                  {styleDraft.levels.map((level, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={level.enabled}
                        aria-label={copy.marketReplay.fibonacciLevelToggle(level.value)}
                        onChange={(event) => {
                          setStyleDraftError(null);
                          setStyleDraft((current) => current && "levels" in current ? {
                            ...current,
                            levels: current.levels.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item),
                          } : current);
                        }}
                        className="h-4 w-4 shrink-0 rounded border-slate-300"
                      />
                      <Input
                        type="number"
                        min="-10"
                        max="10"
                        step="0.001"
                        value={level.value}
                        aria-label={copy.marketReplay.fibonacciLevelValue(index + 1)}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value) || value < -10 || value > 10) return;
                          setStyleDraftError(null);
                          setStyleDraft((current) => current && "levels" in current ? {
                            ...current,
                            levels: current.levels.map((item, itemIndex) => itemIndex === index ? { ...item, value } : item),
                          } : current);
                        }}
                        className="h-9 min-w-0 flex-1 font-mono text-xs"
                      />
                      <Input
                        type="color"
                        value={level.color}
                        aria-label={copy.marketReplay.fibonacciLevelColor(level.value)}
                        onChange={(event) => setStyleDraft((current) => current && "levels" in current ? {
                          ...current,
                          levels: current.levels.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value.toUpperCase() } : item),
                        } : current)}
                        className="h-9 w-11 shrink-0 cursor-pointer p-1"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {styleDraftError ? <p role="alert" className="text-sm text-red-600">{styleDraftError}</p> : null}
            <p className="text-xs text-slate-500">{isFibonacci ? copy.marketReplay.nextFibonacciStyleHint : copy.marketReplay.nextTrendLineStyleHint}</p>
            <div className="flex items-center justify-between gap-3 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => {
                setTemplateName("");
                setTemplateDialogOpen(true);
              }}>{copy.marketReplay.saveDrawingTemplate}</Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => {
                  setStyleDrawingId(null);
                  setStyleDraft(null);
                  setStyleDraftError(null);
                  setSelectedTemplateId("");
                }}>{copy.marketReplay.drawingCancel}</Button>
                <Button type="button" onClick={() => {
                  if (!styleDrawingId) return;
                  const id = styleDrawingId;
                  const drawing = drawings.find((item) => item.id === id);
                  if (drawing?.type === DRAWING_TYPE_FIB_RETRACEMENT && "levels" in styleDraft
                    && hasDuplicateEnabledFibonacciLevels(styleDraft)) {
                    setStyleDraftError(copy.marketReplay.fibonacciDuplicateEnabledLevels);
                    return;
                  }
                  if (!drawing || !drawingStyleMatchesType(drawing.type, styleDraft)) return;
                  const style = drawing.type === DRAWING_TYPE_FIB_RETRACEMENT
                    ? cloneFibonacciStyle(styleDraft as FibonacciRetracementStyle)
                    : { ...styleDraft as TrendLineStyle };
                  if (drawing.type === DRAWING_TYPE_FIB_RETRACEMENT) {
                    setDefaultFibonacciStyle(cloneFibonacciStyle(style as FibonacciRetracementStyle));
                  } else {
                    setDefaultTrendLineStyle({ ...style as TrendLineStyle });
                  }
                  void updateDrawing(id, { style });
                  setStyleDrawingId(null);
                  setStyleDraft(null);
                  setStyleDraftError(null);
                  setSelectedTemplateId("");
                }}>{copy.marketReplay.drawingConfirm}</Button>
              </div>
            </div>
          </div>
        ); })()}
      </Dialog>
      <Dialog
        open={templateDialogOpen}
        title={copy.marketReplay.saveDrawingTemplateTitle}
        className="max-w-md"
        onClose={() => {
          setTemplateDialogOpen(false);
          setTemplateName("");
        }}
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="trend-line-template-name">{copy.marketReplay.drawingTemplateName}</Label>
            <Input
              id="trend-line-template-name"
              value={templateName}
              maxLength={50}
              autoFocus
              placeholder={copy.marketReplay.drawingTemplateNamePlaceholder}
              onChange={(event) => setTemplateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && templateName.trim()) {
                  event.preventDefault();
                  saveDrawingTemplate();
                }
              }}
            />
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => {
              setTemplateDialogOpen(false);
              setTemplateName("");
            }}>{copy.marketReplay.drawingCancel}</Button>
            <Button type="button" disabled={!templateName.trim()} onClick={saveDrawingTemplate}>
              {copy.marketReplay.saveDrawingTemplate}
            </Button>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction === "paper-clear" ? copy.replaySessions.archiveTitle : copy.replaySessions.restartTitle}
        description={confirmAction === "paper-clear" ? copy.replaySessions.archiveDescription : copy.replaySessions.restartDescription}
        onCancel={() => {
          const suspension = confirmationSuspensionRef.current;
          confirmationSuspensionRef.current = null;
          setConfirmAction(null);
          restorePlayback(suspension);
        }}
        onConfirm={applyConfirmedAction}
      />
      {dateDialogOpen ? <ReplayDateDialog key={displayUtcOffsetMinutes} open currentTime={currentSourceBar?.timestamp ?? dataset.startTime} minimum={dateDialogMinimum} maximum={dataset.endTime} displayUtcOffsetMinutes={displayUtcOffsetMinutes} allowForward={replaySession?.mode === "LIVE_REPLAY"} onClose={() => setDateDialogOpen(false)} onLocate={locateReplayDate} /> : null}
      <ReplayStartDialog
        open={startDialogOpen}
        value={startDialogValue}
        minimum={dateTimeLocalValue(dataset.startTime, dataset.timezone)}
        maximum={dateTimeLocalValue(dataset.endTime, dataset.timezone)}
        timezone={dataset.timezone}
        busy={startDialogBusy}
        error={startError}
        onChange={setStartDialogValue}
        onCancel={closeStartDialog}
        onConfirm={(value) => void applyNewReplayStart(value)}
      />
    </>)}
    </ReplayCorrectionProvider>
  );
}
